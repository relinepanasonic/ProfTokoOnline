-- =====================================================================
-- 0110: Product Funnel — switch the Dashboard's Shopping Funnel from the
-- traffic/orders fields to the Product Performance (SPOS) export's own
-- Impression → Click → In Cart → Sales columns.
--
-- Requested mapping (SPOS "Performa Produk" export columns):
--   K  "Jumlah Produk Dilihat"              -> Impression  (already
--                                              captured as product_views)
--   L  "Produk Diklik"                      -> Click        (NEW — this
--                                              column was never read for
--                                              spos rows; `clicks` only
--                                              existed for the Ads export,
--                                              which happens to also use
--                                              column L but for a
--                                              different field, "Jumlah
--                                              Klik")
--   AI "Dimasukkan ke Keranjang (Produk)"   -> In Cart      (already
--                                              captured as in_cart)
--   S  "Produk (Pesanan Siap Dikirim)"      -> Sales        (already
--                                              captured as `units` on
--                                              sales_rows, but dashboard_
--                                              rollup never carried a
--                                              units column, so it never
--                                              reached dashboard_summary)
--
-- Two of the four fields already exist end-to-end (product_views, in_cart).
-- The other two need: (a) parse.ts capturing spos clicks — done in the same
-- commit as this migration; (b) a `units` column threaded through
-- dashboard_rollup, its refresh functions, and dashboard_summary's kpis.
--
-- clicks was NEVER summed for spos rows before (only ads rows populate it),
-- so historical rows will show 0 there until re-uploaded — same "0 until
-- next upload" caveat every prior funnel-field addition (0042, 0049) has
-- had. units, by contrast, has always been parsed for spos
-- ("Produk Terjual (Pesanan Siap Dikirim)"/col S) — it just never made it
-- into the rollup — so the backfill at the bottom of this migration gives
-- it real historical values immediately.
-- =====================================================================

alter table dashboard_rollup add column if not exists units numeric;

-- ── refresh_dashboard_rollup(p_client_id) — same shape as 0104, +units ──
create or replace function refresh_dashboard_rollup(p_client_id uuid default null) returns void
  language plpgsql security definer set search_path = public set statement_timeout = '180s' as $$
begin
  if p_client_id is null then
    delete from dashboard_rollup;
    insert into dashboard_rollup (
      client_id, year, month, week, city, store_name, owner, brand, product_type, item_name, source, ad_type,
      sales_idr, visitors, in_cart, orders, orders_ready, orders_created,
      product_views, visitor_cart_adds, ad_cost, clicks, add_to_cart, units
    )
    select
      s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
      s.brand, s.product_type, s.item_name, s.source, s.ad_type,
      sum(s.sales_idr), sum(s.visitors), sum(s.in_cart), sum(s.orders), sum(s.orders_ready),
      sum(s.orders_created), sum(s.product_views), sum(s.visitor_cart_adds),
      sum(s.ad_cost), sum(s.clicks), sum(s.add_to_cart), sum(s.units)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.source <> 'spos' or s.is_parent
    group by s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
             s.brand, s.product_type, s.item_name, s.source, s.ad_type;

    delete from dashboard_month_completeness;
    insert into dashboard_month_completeness (client_id, store_name, owner, month, week_count)
    select s.client_id, s.store_name, so.owner, s.month, count(distinct s.week)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.source = 'spos' and s.store_name is not null and s.month is not null
      and coalesce(lower(trim(s.month)), '') <> 'baseline'
    group by s.client_id, s.store_name, so.owner, s.month;

  else
    delete from dashboard_rollup where client_id = p_client_id;
    insert into dashboard_rollup (
      client_id, year, month, week, city, store_name, owner, brand, product_type, item_name, source, ad_type,
      sales_idr, visitors, in_cart, orders, orders_ready, orders_created,
      product_views, visitor_cart_adds, ad_cost, clicks, add_to_cart, units
    )
    select
      s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
      s.brand, s.product_type, s.item_name, s.source, s.ad_type,
      sum(s.sales_idr), sum(s.visitors), sum(s.in_cart), sum(s.orders), sum(s.orders_ready),
      sum(s.orders_created), sum(s.product_views), sum(s.visitor_cart_adds),
      sum(s.ad_cost), sum(s.clicks), sum(s.add_to_cart), sum(s.units)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.client_id = p_client_id
      and (s.source <> 'spos' or s.is_parent)
    group by s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
             s.brand, s.product_type, s.item_name, s.source, s.ad_type;

    delete from dashboard_month_completeness where client_id = p_client_id;
    insert into dashboard_month_completeness (client_id, store_name, owner, month, week_count)
    select s.client_id, s.store_name, so.owner, s.month, count(distinct s.week)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.client_id = p_client_id
      and s.source = 'spos' and s.store_name is not null and s.month is not null
      and coalesce(lower(trim(s.month)), '') <> 'baseline'
    group by s.client_id, s.store_name, so.owner, s.month;
  end if;
end $$;

-- ── refresh_dashboard_rollup_slice(...) — same shape as 0109, +units ────
create or replace function refresh_dashboard_rollup_slice(
  p_client_id  uuid,
  p_source     text,
  p_year       int,
  p_month      text,
  p_week       text,
  p_store_name text
) returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
  delete from dashboard_rollup r
  where r.client_id = p_client_id
    and r.source     is not distinct from p_source
    and r.year       is not distinct from p_year
    and r.month      is not distinct from p_month
    and r.week       is not distinct from p_week
    and r.store_name is not distinct from p_store_name;

  insert into dashboard_rollup (
    client_id, year, month, week, city, store_name, owner, brand, product_type, item_name, source, ad_type,
    sales_idr, visitors, in_cart, orders, orders_ready, orders_created,
    product_views, visitor_cart_adds, ad_cost, clicks, add_to_cart, units
  )
  select
    s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
    s.brand, s.product_type, s.item_name, s.source, s.ad_type,
    sum(s.sales_idr), sum(s.visitors), sum(s.in_cart), sum(s.orders), sum(s.orders_ready),
    sum(s.orders_created), sum(s.product_views), sum(s.visitor_cart_adds),
    sum(s.ad_cost), sum(s.clicks), sum(s.add_to_cart), sum(s.units)
  from sales_rows s
  left join lateral (
    select sl.owner from store_links sl
    where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
    order by sl.owner limit 1
  ) so on true
  where s.client_id = p_client_id
    and s.source     = p_source::data_source
    and s.year       is not distinct from p_year
    and s.month      is not distinct from p_month
    and s.week       is not distinct from p_week
    and s.store_name is not distinct from p_store_name
    and (s.source <> 'spos' or s.is_parent)
  group by s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
           s.brand, s.product_type, s.item_name, s.source, s.ad_type;

  if p_source = 'spos' and p_store_name is not null and p_month is not null
     and coalesce(lower(trim(p_month)), '') <> 'baseline' then
    delete from dashboard_month_completeness c
    where c.client_id = p_client_id
      and c.store_name is not distinct from p_store_name
      and c.month      is not distinct from p_month;

    insert into dashboard_month_completeness (client_id, store_name, owner, month, week_count)
    select s.client_id, s.store_name, so.owner, s.month, count(distinct s.week)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.client_id = p_client_id
      and s.store_name is not distinct from p_store_name
      and s.month      is not distinct from p_month
      and s.source = 'spos' and s.store_name is not null and s.month is not null
    group by s.client_id, s.store_name, so.owner, s.month;
  end if;
end $$;

-- ── dashboard_summary — same as 0099, +units in base, +clicks/units_sold
-- in kpis (both spos-filtered, matching product_views' existing pattern) ──
create or replace function dashboard_summary(
  p_client_id uuid,
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
    select r.year, r.city, r.store_name, r.source, r.month, r.week, r.ad_type,
           r.sales_idr, r.visitors, r.in_cart, r.orders, r.orders_ready, r.orders_created,
           r.product_views, r.visitor_cart_adds, r.ad_cost, r.clicks, r.add_to_cart, r.units,
           r.item_name, r.brand, r.product_type
    from dashboard_rollup r
    where r.client_id = p_client_id
      and (p_year  is null or r.year       = p_year)
      and (p_city  is null or r.city       = p_city)
      and (p_store is null or r.store_name = p_store)
      and (p_owner is null or r.owner      = p_owner)
      and (p_brand is null or r.store_name in (
            select sl.store_name from store_links sl where sl.client_id = p_client_id and sl.brand = p_brand and sl.store_name is not null))
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
        on c.client_id = p_client_id and c.store_name = b.store_name and c.month = b.month and c.week_count >= 4
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
                          / nullif(sum(ad_cost) filter (where source='ads'),0),
        -- ── Product Funnel (0110): Impression=product_views (above),
        -- Click=clicks, In Cart=in_cart (above), Sales=units — all SPOS-only,
        -- matching the "Performa Produk" export's own K/L/AI/S columns.
        'clicks',         coalesce(sum(clicks)    filter (where source='spos'),0),
        'units_sold',     coalesce(sum(units)     filter (where source='spos'),0)
      ) from f_real
    ),
    'perf_trend', (select coalesce(jsonb_agg(x),'[]') from (
        select (case when p_month is null then month else week end) as bucket,
               coalesce(sum(sales_idr) filter (where source='spos'),0) sales,
               coalesce(sum(visitors)  filter (where source='spos'),0) traffic,
               coalesce(sum(in_cart)   filter (where source='spos'),0) in_cart
        from f_real
        where (case when p_month is null then month else week end) is not null
        group by (case when p_month is null then month else week end)) x),
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

-- Backfill immediately: `units` has always been parsed for spos rows (just
-- never carried by the rollup), so this gives it real historical values
-- right away. `clicks` will stay 0 for spos on historical rows until
-- re-uploaded — the raw column position was simply never read before.
select refresh_dashboard_rollup();

notify pgrst, 'reload config';
