-- =====================================================================
-- 0052: Pre-aggregated dashboard rollup — the permanent fix for the
-- 3-12s dashboard load + recurring 57014 timeouts.
--
-- ARCHITECTURE (see also the chat explanation):
--   * A regular TABLE (not a materialized view) so it can carry the same
--     RLS owner-scoping as sales_rows — matviews don't support RLS.
--   * Refreshed on demand: the upload API calls refresh_dashboard_rollup()
--     once after each upload (NOT per-row triggers, which would fire
--     thousands of times per bulk insert), plus an hourly pg_cron safety
--     net for deletes / manual edits.
--   * TRUNCATE + repopulate each refresh, so the rollup never accumulates
--     dead tuples — the dashboard's speed is decoupled from sales_rows bloat.
--
--   Grain: (client_id, year, month, city, store_name, brand, product_type,
--   item_name, source) with every measure pre-summed and the SPOS
--   parent-row rule (source<>'spos' or is_parent) baked in. dashboard_summary
--   keeps its exact output shape — only its base CTE now reads this table.
-- =====================================================================

create table if not exists dashboard_rollup (
  client_id         uuid not null references clients(id) on delete cascade,
  year              int,
  month             text,
  city              text,
  store_name        text,
  brand             text,
  product_type      text,
  item_name         text,
  source            text,
  -- measures (all pre-summed at refresh time)
  sales_idr         numeric,
  visitors          numeric,
  in_cart           numeric,
  orders            numeric,
  orders_ready      numeric,
  orders_created    numeric,
  product_views     numeric,
  visitor_cart_adds numeric,
  ad_cost           numeric,
  clicks            numeric,
  add_to_cart       numeric
);

create index if not exists dashboard_rollup_client_idx on dashboard_rollup (client_id, source, month);
create index if not exists dashboard_rollup_store_idx  on dashboard_rollup (client_id, store_name);
create index if not exists dashboard_rollup_item_idx   on dashboard_rollup (client_id, item_name);

-- ── RLS: mirror the three sales_rows read policies exactly ───────────────────
alter table dashboard_rollup enable row level security;

drop policy if exists rollup_admin_read on dashboard_rollup;
create policy rollup_admin_read on dashboard_rollup
  for select using (my_role()::text in ('superadmin','client_admin'));

drop policy if exists rollup_advertiser_read on dashboard_rollup;
create policy rollup_advertiser_read on dashboard_rollup
  for select using (client_id = my_client_id() and my_role()::text = 'advertiser');

drop policy if exists rollup_owner_scoped_read on dashboard_rollup;
create policy rollup_owner_scoped_read on dashboard_rollup
  for select using (
    client_id = my_client_id()
    and (
      (my_role()::text = 'branch_manager' and store_name in (
        select sl.store_name from store_links sl
        where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
      ))
      or (my_role()::text = 'store_user' and store_name = my_scope_store())
    )
  );

-- ── refresh function ─────────────────────────────────────────────────────────
-- SECURITY DEFINER so the upload API (authenticated) / pg_cron can rebuild the
-- rollup without direct write grants. TRUNCATE is transactional in Postgres, so
-- readers see either the whole old set or the whole new set — never a partial.
create or replace function refresh_dashboard_rollup() returns void
  language plpgsql security definer set search_path = public as $$
begin
  truncate dashboard_rollup;
  insert into dashboard_rollup (
    client_id, year, month, city, store_name, brand, product_type, item_name, source,
    sales_idr, visitors, in_cart, orders, orders_ready, orders_created,
    product_views, visitor_cart_adds, ad_cost, clicks, add_to_cart
  )
  select
    client_id, year, month, city, store_name, brand, product_type, item_name, source,
    sum(sales_idr), sum(visitors), sum(in_cart), sum(orders), sum(orders_ready),
    sum(orders_created), sum(product_views), sum(visitor_cart_adds),
    sum(ad_cost), sum(clicks), sum(add_to_cart)
  from sales_rows
  where source <> 'spos' or is_parent           -- SPOS parent-row rule, baked in
  group by client_id, year, month, city, store_name, brand, product_type, item_name, source;
end $$;

grant execute on function refresh_dashboard_rollup() to authenticated, service_role;

-- Populate immediately so the dashboard has data the moment this ships.
select refresh_dashboard_rollup();

-- ── dashboard_summary: identical output, base CTE now reads the rollup ───────
create or replace function dashboard_summary(
  p_year  int  default null,
  p_month text default null,
  p_city  text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with base as (
    select r.year, r.city, r.store_name, r.source, r.month,
           r.sales_idr, r.visitors, r.in_cart, r.orders, r.orders_ready, r.orders_created,
           r.product_views, r.visitor_cart_adds, r.ad_cost, r.clicks, r.add_to_cart,
           r.item_name, r.brand, r.product_type
    from dashboard_rollup r
    where (p_year  is null or r.year       = p_year)
      and (p_city  is null or r.city       = p_city)
      and (p_store is null or r.store_name = p_store)
      and (p_owner is null or r.store_name in (
            select sl.store_name from store_links sl where sl.owner = p_owner and sl.store_name is not null))
      and (p_brand is null or r.store_name in (
            select sl.store_name from store_links sl where sl.brand = p_brand and sl.store_name is not null))
  ),
  f_real as (
    select * from base
    where (p_month is null or month = p_month)
      and (p_month is not null or coalesce(lower(trim(month)), '') <> 'baseline')
  ),
  trend_by_store as (
    select store_name,
           coalesce(jsonb_agg(x order by array_position(
             array['Januari','Februari','Maret','April','Mei','Juni','Juli',
                   'Agustus','September','Oktober','November','Desember'], x.month)), '[]') as trend
    from (
      select store_name, month,
             sum(sales_idr)   filter (where source='spos') as sales,
             sum(ad_cost)     filter (where source='ads')  as ad_cost
      from base
      where store_name is not null
        and source in ('spos','ads')
        and coalesce(lower(trim(month)), '') <> 'baseline'
      group by store_name, month
    ) x
    group by store_name
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'sales',          coalesce(sum(sales_idr) filter (where source='spos'),0),
        'gmv',            coalesce(sum(sales_idr) filter (where source='perf'),0),
        'traffic',        coalesce(sum(visitors)  filter (where source='spos'),0),
        'in_cart',        coalesce(sum(in_cart)   filter (where source='spos'),0),
        'orders',         coalesce(sum(orders)    filter (where source='spos'),0),
        'transactions',   coalesce(sum(orders_ready)      filter (where source='spos'),0),
        'orders_created', coalesce(sum(orders_created)    filter (where source='spos'),0),
        'product_views',  coalesce(sum(product_views)     filter (where source='spos'),0),
        'visitor_cart_adds', coalesce(sum(visitor_cart_adds) filter (where source='spos'),0),
        'ad_cost',        coalesce(sum(ad_cost)   filter (where source='ads'),0),
        'roas',           coalesce(sum(sales_idr) filter (where source='spos'),0)
                          / nullif(sum(ad_cost) filter (where source='ads'),0)
      ) from f_real
    ),
    'monthly_sales', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(sales_idr) sales
        from f_real where source='spos' and month is not null
        group by month) x),
    'store_monthly', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(sales_idr) gmv
        from f_real where source='perf' and month is not null
        group by month) x),
    'top_products', (select coalesce(jsonb_agg(x),'[]') from (
        select item_name name, sum(sales_idr) sales
        from f_real where source='spos' and item_name is not null
        group by item_name order by sum(sales_idr) desc nulls last limit 10) x),
    'brand_share', (select coalesce(jsonb_agg(x order by x.sales desc),'[]') from (
        select brand, sum(sales_idr) sales
        from f_real where source='spos' and brand is not null
        group by brand) x),
    'by_category', (select coalesce(jsonb_agg(x order by x.sales desc),'[]') from (
        select coalesce(product_type,'Others') category, sum(sales_idr) sales
        from f_real where source='spos'
        group by product_type) x),
    'cost_roas', (select coalesce(jsonb_agg(x),'[]') from (
        select month,
               coalesce(sum(ad_cost) filter (where source='ads'),0) cost,
               coalesce(sum(sales_idr) filter (where source='spos'),0)
                 / nullif(sum(ad_cost) filter (where source='ads'),0) roas
        from f_real where month is not null group by month) x),
    'traffic_trend', (select coalesce(jsonb_agg(x),'[]') from (
        select month,
               coalesce(sum(visitors) filter (where source='spos'),0) traffic,
               coalesce(sum(in_cart)  filter (where source='spos'),0) in_cart,
               coalesce(sum(orders_ready) filter (where source='spos'),0) transactions,
               coalesce(sum(visitor_cart_adds) filter (where source='spos'),0) visitor_cart_adds
        from f_real where month is not null group by month) x),
    'avg_store_trend', (select coalesce(jsonb_agg(x order by x.avg_sales desc),'[]') from (
        select store_name, sum(store_sales) / count(distinct month) avg_sales
        from (
          select store_name, month, sum(sales_idr) store_sales
          from base
          where source='spos' and store_name is not null
            and coalesce(lower(trim(month)),'') <> 'baseline'
          group by store_name, month
        ) y
        group by store_name) x),
    'top_campaigns', (select coalesce(jsonb_agg(x),'[]') from (
        select item_name name, store_name,
               sum(visitors) views, sum(clicks) clicks, sum(add_to_cart) add_to_cart,
               sum(orders) orders, sum(sales_idr) sales, sum(ad_cost) ad_cost
        from f_real
        where source='ads' and item_name is not null and sales_idr is not null
        group by item_name, store_name order by sum(sales_idr) desc nulls last limit 8) x),
    'dealers', (select coalesce(jsonb_agg(y order by y.sales desc nulls last),'[]') from (
        select x.*, coalesce(tbs.trend, '[]') as trend
        from (
          select
            d.store_name, d.city,
            coalesce(sum(d.sales_idr) filter (where d.source='spos'),0) sales,
            coalesce(sum(d.visitors)  filter (where d.source='spos'),0) traffic,
            coalesce(sum(d.in_cart)   filter (where d.source='spos'),0) in_cart,
            coalesce(sum(d.orders)    filter (where d.source='spos'),0) orders,
            coalesce(sum(d.ad_cost)   filter (where d.source='ads'),0)  ad_cost,
            coalesce(sum(d.sales_idr) filter (where d.source='spos'),0)
              / nullif(sum(d.ad_cost) filter (where d.source='ads'),0)  roas
          from f_real d
          where d.store_name is not null
          group by d.store_name, d.city
        ) x
        left join trend_by_store tbs on tbs.store_name = x.store_name
      ) y)
  );
$$;

-- ── hourly safety-net refresh via pg_cron (optional — never fails migration) ─
-- Primary freshness is upload-triggered; this catches deletes / manual edits.
-- If pg_cron isn't enabled on the project, enable it in Supabase Dashboard →
-- Database → Extensions; the upload-triggered refresh works regardless.
do $$ begin
  perform cron.schedule('refresh-dashboard-rollup', '7 * * * *', 'select refresh_dashboard_rollup()');
exception when others then
  raise notice 'pg_cron not available — scheduled refresh skipped. Upload-triggered refresh still active.';
end $$;

notify pgrst, 'reload config';
