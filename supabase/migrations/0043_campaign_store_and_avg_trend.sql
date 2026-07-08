-- =====================================================================
-- 0043: Fix top_campaigns cross-store merge bug + add avg_store_trend
--
-- top_campaigns was grouped by item_name ONLY. Shopee often reuses the
-- same default campaign name (e.g. "Shop GMV Max") across different
-- stores, so two unrelated stores' numbers were being silently summed
-- into one row with no way to tell them apart. Now grouped by
-- (item_name, store_name), with store_name returned so the UI can show
-- which store a campaign belongs to.
--
-- avg_store_trend: per month, the average of each active store's own
-- monthly SPOS sales (not total sales) — "AVG Store Sales Performa".
-- =====================================================================

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
    select s.*
    from sales_rows s
    where (p_year  is null or s.year       = p_year)
      and (p_city  is null or s.city       = p_city)
      and (p_store is null or s.store_name = p_store)
      and (p_owner is null or s.store_name in (
            select sl.store_name from store_links sl where sl.owner = p_owner and sl.store_name is not null))
      and (p_brand is null or s.store_name in (
            select sl.store_name from store_links sl where sl.brand = p_brand and sl.store_name is not null))
      and (s.source <> 'spos' or s.is_parent)
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
               coalesce(sum(orders_ready) filter (where source='spos'),0) transactions
        from f_real where month is not null group by month) x),
    'avg_store_trend', (select coalesce(jsonb_agg(x),'[]') from (
        select month, avg(store_sales) avg_sales
        from (
          select store_name, month, sum(sales_idr) store_sales
          from base
          where source='spos' and store_name is not null
            and coalesce(lower(trim(month)),'') <> 'baseline'
          group by store_name, month
        ) y
        group by month) x),
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

notify pgrst, 'reload config';
