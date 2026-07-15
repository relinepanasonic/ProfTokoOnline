-- =====================================================================
-- 0058: Don't plot partial months in the Store Data per Store trend line.
--
-- The mini sales/ROAS trend (dealers[].trend, used by the Sparkline in the
-- dealer table) reads from dashboard_rollup, which sums away week-level
-- detail for performance (migration 0052). A month with only 1 of its
-- ~4-5 weeks uploaded so far (e.g. July with just Week 1) shows a real
-- sales figure that's a fraction of a full month, making every store's
-- trend line look like it's declining even when nothing is actually wrong.
--
-- Fix: a small companion table tracks distinct week-count per
-- (store_name, month), computed straight from sales_rows (which still has
-- week-level detail) and refreshed alongside the main rollup. Only months
-- with >= 4 weeks are included in the trend. This does NOT touch KPIs,
-- monthly_sales, or any other chart — those intentionally show partial
-- current-month data as it comes in; only this specific trend line, whose
-- whole purpose is a shape-over-time comparison, is affected.
-- =====================================================================

create table if not exists dashboard_month_completeness (
  client_id  uuid not null references clients(id) on delete cascade,
  store_name text not null,
  month      text not null,
  week_count int not null,
  primary key (client_id, store_name, month)
);

alter table dashboard_month_completeness enable row level security;

-- Mirror dashboard_rollup's three read policies exactly (dashboard_summary()
-- runs as the caller, not security definer, so RLS here matters).
drop policy if exists completeness_admin_read on dashboard_month_completeness;
create policy completeness_admin_read on dashboard_month_completeness
  for select using (my_role()::text in ('superadmin','client_admin'));

drop policy if exists completeness_advertiser_read on dashboard_month_completeness;
create policy completeness_advertiser_read on dashboard_month_completeness
  for select using (client_id = my_client_id() and my_role()::text = 'advertiser');

drop policy if exists completeness_owner_scoped_read on dashboard_month_completeness;
create policy completeness_owner_scoped_read on dashboard_month_completeness
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

-- ── refresh function: rebuild both tables together ────────────────────────────
create or replace function refresh_dashboard_rollup() returns void
  language plpgsql security definer set search_path = public as $$
begin
  truncate dashboard_rollup;
  insert into dashboard_rollup (
    client_id, year, month, city, store_name, brand, product_type, item_name, source, ad_type,
    sales_idr, visitors, in_cart, orders, orders_ready, orders_created,
    product_views, visitor_cart_adds, ad_cost, clicks, add_to_cart
  )
  select
    client_id, year, month, city, store_name, brand, product_type, item_name, source, ad_type,
    sum(sales_idr), sum(visitors), sum(in_cart), sum(orders), sum(orders_ready),
    sum(orders_created), sum(product_views), sum(visitor_cart_adds),
    sum(ad_cost), sum(clicks), sum(add_to_cart)
  from sales_rows
  where source <> 'spos' or is_parent           -- SPOS parent-row rule, baked in
  group by client_id, year, month, city, store_name, brand, product_type, item_name, source, ad_type;

  truncate dashboard_month_completeness;
  insert into dashboard_month_completeness (client_id, store_name, month, week_count)
  select client_id, store_name, month, count(distinct week)
  from sales_rows
  where source = 'spos' and store_name is not null and month is not null
    and coalesce(lower(trim(month)), '') <> 'baseline'
  group by client_id, store_name, month;
end $$;

-- ── dashboard_summary: trend_by_store now requires >= 4 weeks ────────────────
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
    select r.year, r.city, r.store_name, r.source, r.month, r.ad_type,
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
      select b.store_name, b.month,
             sum(b.sales_idr)   filter (where b.source='spos') as sales,
             sum(b.ad_cost)     filter (where b.source='ads')  as ad_cost
      from base b
      join dashboard_month_completeness c
        on c.store_name = b.store_name and c.month = b.month and c.week_count >= 4
      where b.store_name is not null
        and b.source in ('spos','ads')
        and coalesce(lower(trim(b.month)), '') <> 'baseline'
      group by b.store_name, b.month
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
          and item_name <> 'Shop GMV Max' and ad_type is not null
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

select refresh_dashboard_rollup();

notify pgrst, 'reload config';
