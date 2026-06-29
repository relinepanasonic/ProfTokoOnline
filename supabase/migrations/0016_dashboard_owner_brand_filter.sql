-- 0016_dashboard_owner_brand_filter.sql
-- Add p_owner and p_brand params to dashboard_summary so the Owner/Brand
-- dropdowns in the UI actually filter KPIs and charts.
-- Owner and Brand are stored in store_links; we resolve to store_name set.

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
  with f as (
    select s.*
    from sales_rows s
    where (p_year  is null or s.year       = p_year)
      and (p_month is null or s.month      = p_month)
      and (p_city  is null or s.city       = p_city)
      and (p_store is null or s.store_name = p_store)
      and (p_owner is null or s.store_name in (
            select sl.store_name from store_links sl where sl.owner = p_owner and sl.store_name is not null))
      and (p_brand is null or s.store_name in (
            select sl.store_name from store_links sl where sl.brand = p_brand and sl.store_name is not null))
      and (s.source <> 'spos' or s.is_parent)
  ),
  f_real as (
    select * from f
    where coalesce(lower(trim(month)), '') <> 'baseline'
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'sales',   coalesce(sum(sales_idr) filter (where source='spos'),0),
        'gmv',     coalesce(sum(sales_idr) filter (where source='perf'),0),
        'traffic', coalesce(sum(visitors)  filter (where source='spos'),0),
        'in_cart', coalesce(sum(in_cart)   filter (where source='spos'),0),
        'ad_cost', coalesce(sum(ad_cost)   filter (where source='ads'),0),
        'roas',    coalesce(sum(sales_idr) filter (where source='spos'),0)
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
               coalesce(sum(in_cart)  filter (where source='spos'),0) in_cart
        from f_real where month is not null group by month) x),
    'dealers', (select coalesce(jsonb_agg(x order by x.sales desc nulls last),'[]') from (
        select store_name, city,
               coalesce(sum(sales_idr) filter (where source='spos'),0) sales,
               coalesce(sum(visitors)  filter (where source='spos'),0) traffic,
               coalesce(sum(in_cart)   filter (where source='spos'),0) in_cart,
               coalesce(sum(ad_cost)   filter (where source='ads'),0)  ad_cost,
               coalesce(sum(sales_idr) filter (where source='spos'),0)
                 / nullif(sum(ad_cost) filter (where source='ads'),0)  roas
        from f_real where store_name is not null group by store_name, city) x)
  );
$$;
