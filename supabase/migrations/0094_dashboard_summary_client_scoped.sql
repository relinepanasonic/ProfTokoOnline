-- =====================================================================
-- 0094: Fix dashboard_summary() 57014 timeout from the week-grain
-- expansion (migration 0089).
--
-- The `base` CTE scanned dashboard_rollup with NO explicit client_id
-- predicate — client scoping came only from RLS. Without a
-- `client_id = <const>` in the query, the planner won't seek the
-- (client_id, year, month) index (0092); it scans the now-4-5x-larger
-- table and evaluates RLS's `store_name in (store_links subquery)` per
-- candidate row. Adding an explicit p_client_id lets the index seek and
-- shrinks the row set RLS must then re-check.
--
-- Materialization is deliberately LEFT ALONE: f_real is referenced ~11x,
-- but once base is client-scoped it's a few-thousand-row temp buffer, so
-- materializing once and scanning 11x is cheap. NOT MATERIALIZED here
-- would re-run the base scan + RLS subquery 11 times — strictly worse.
-- The KPI block is already single-pass FILTER aggregation.
--
-- Signature changes (p_client_id added), so the old 6-arg overload is
-- dropped to avoid PGRST203 (same fix as 0093/0084). page.tsx must pass
-- p_client_id.
-- =====================================================================

drop function if exists public.dashboard_summary(int, text, text, text, text, text);

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
           r.product_views, r.visitor_cart_adds, r.ad_cost, r.clicks, r.add_to_cart,
           r.item_name, r.brand, r.product_type
    from dashboard_rollup r
    where r.client_id = p_client_id
      and (p_year  is null or r.year       = p_year)
      and (p_city  is null or r.city       = p_city)
      and (p_store is null or r.store_name = p_store)
      and (p_owner is null or r.store_name in (
            select sl.store_name from store_links sl where sl.client_id = p_client_id and sl.owner = p_owner and sl.store_name is not null))
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

notify pgrst, 'reload config';
