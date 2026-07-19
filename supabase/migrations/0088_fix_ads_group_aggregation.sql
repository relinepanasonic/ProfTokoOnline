-- =====================================================================
-- 0088: Fix "Ads Group Performance" duplicate-campaign-row bug.
--
-- ads_dashboard_summary()'s 'groups' output did NO aggregation — it
-- selected straight from grp_totals (a pass-through of ads_rollup rows)
-- with no GROUP BY. ads_rollup's grain includes year/month/store_name/
-- ads_level, so selecting "All Months" surfaced one row PER MONTH for the
-- same campaign name instead of one collapsed row — exactly the reported
-- "duplicate Grup Iklan 1 / Shop GMV Max rows with different (or
-- coincidentally identical) metrics" bug. ads_rollup itself and the
-- sibling 'products' block were already correct (proper GROUP BY + SUM);
-- 'groups' was the one outlier missing it.
--
-- Fix: group strictly by LOWER(TRIM(item_name)) — no time dimension, no
-- ads_level — SUM every numeric metric, and recompute ROAS from the
-- summed totals (not an average of per-month ratios). Nothing else in
-- the function changes.
-- =====================================================================

create or replace function ads_dashboard_summary(
  p_year  int  default null,
  p_month text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with base as (
    select source, year, month, store_name, item_name, kode_produk, ads_level,
           ads_cost, sales, view, click, add_to_cart, orders, item_sold
    from ads_rollup
    where (p_year  is null or year  = p_year)
      and (p_month is null or month = p_month)
      and (p_store is null or store_name = p_store)
      and (p_owner is null or store_name in (select sl.store_name from store_links sl where sl.owner = p_owner and sl.store_name is not null))
      and (p_brand is null or store_name in (select sl.store_name from store_links sl where sl.brand = p_brand and sl.store_name is not null))
  ),
  ads_base    as (select * from base where source = 'total'),
  grp_totals  as (select * from base where source = 'group'),
  grp_products as (select * from base where source = 'product'),
  gmv_rows   as (select * from grp_totals where ads_level = 'incubation' or item_name = 'Shop GMV Max'),
  group_rows as (select * from grp_totals where not (ads_level = 'incubation' or item_name = 'Shop GMV Max')),

  t_total as (
    select coalesce(sum(ads_cost),0) ads_cost, coalesce(sum(sales),0) sales,
           coalesce(sum(view),0) view, coalesce(sum(click),0) click,
           coalesce(sum(add_to_cart),0) add_to_cart,
           coalesce(sum(orders),0) orders, coalesce(sum(item_sold),0) item_sold
    from ads_base
  ),
  t_gmv as (
    select coalesce(sum(ads_cost),0) ads_cost, coalesce(sum(sales),0) sales,
           coalesce(sum(view),0) view, coalesce(sum(click),0) click,
           coalesce(sum(orders),0) orders, coalesce(sum(item_sold),0) item_sold
    from gmv_rows
  ),
  t_group as (
    select coalesce(sum(ads_cost),0) ads_cost, coalesce(sum(sales),0) sales,
           coalesce(sum(view),0) view, coalesce(sum(click),0) click,
           coalesce(sum(orders),0) orders, coalesce(sum(item_sold),0) item_sold
    from group_rows
  ),

  products_ads as (
    select kode_produk, item_name as nama_produk, ads_cost, sales, view, click, orders, item_sold
    from ads_base where kode_produk is not null
  ),
  products_grp as (
    select kode_produk, item_name as nama_produk, ads_cost, sales, view, click, orders, item_sold
    from grp_products where kode_produk is not null
  ),
  products_all as (select * from products_ads union all select * from products_grp)

  select jsonb_build_object(
    'totals', jsonb_build_object(
      'total', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'sales', t.sales, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.sales / nullif(t.ads_cost,0)
      ) from t_total t),
      'gmv_max', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'sales', t.sales, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.sales / nullif(t.ads_cost,0)
      ) from t_gmv t),
      'group_ads', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'sales', t.sales, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.sales / nullif(t.ads_cost,0)
      ) from t_group t),
      'independent', (select jsonb_build_object(
        'ads_cost', tot.ads_cost - g.ads_cost - grp.ads_cost,
        'sales',    tot.sales    - g.sales    - grp.sales,
        'view',     tot.view     - g.view     - grp.view,
        'click',    tot.click    - g.click    - grp.click,
        'orders',   tot.orders   - g.orders   - grp.orders,
        'item_sold',tot.item_sold- g.item_sold- grp.item_sold,
        'roas',     (tot.sales - g.sales - grp.sales)
                    / nullif(tot.ads_cost - g.ads_cost - grp.ads_cost, 0)
      ) from t_total tot, t_gmv g, t_group grp)
    ),
    'funnel', (select jsonb_build_object(
      'view', t.view, 'click', t.click, 'add_to_cart', t.add_to_cart, 'orders', t.orders
    ) from t_total t),
    'monthly', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      with months as (
        select distinct month from ads_base   where month is not null
        union select distinct month from gmv_rows   where month is not null
        union select distinct month from group_rows where month is not null
      ),
      a  as (select month, sum(sales) sales, sum(ads_cost) ads_cost from ads_base   group by month),
      gm as (select month, sum(sales) sales                        from gmv_rows   group by month),
      gr as (select month, sum(sales) sales                        from group_rows group by month)
      select
        m.month,
        coalesce(gm.sales,0) gmv_max_sales,
        coalesce(gr.sales,0) group_sales,
        coalesce(a.sales,0) - coalesce(gm.sales,0) - coalesce(gr.sales,0) as independent_sales,
        coalesce(a.sales,0) / nullif(coalesce(a.ads_cost,0),0) as roas
      from months m
      left join a  on a.month  = m.month
      left join gm on gm.month = m.month
      left join gr on gr.month = m.month
    ) x),
    'sold_sales_trend', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      select month, sum(item_sold) item_sold, sum(sales) sales from ads_base
      where month is not null group by month
    ) x),
    -- Fixed: strictly grouped by normalized campaign name (no year/month/
    -- ads_level in the GROUP BY) so "All Months" collapses to one row per
    -- campaign instead of one row per month. ROAS recomputed from summed
    -- totals, not averaged per-row ratios.
    'groups', (select coalesce(jsonb_agg(x order by x.sales desc nulls last), '[]') from (
        select
          (array_agg(item_name order by item_name))[1] as nama_iklan,
          sum(ads_cost) ads_cost, sum(sales) sales,
          sum(sales) / nullif(sum(ads_cost),0) roas,
          sum(view) view, sum(click) click, sum(orders) orders, sum(item_sold) item_sold
        from grp_totals
        where item_name is not null
        group by lower(trim(item_name))
    ) x),
    'products', (select coalesce(jsonb_agg(x order by x.sales desc nulls last), '[]') from (
      select kode_produk,
             (array_agg(nama_produk) filter (where nama_produk is not null))[1] as nama_produk,
             sum(ads_cost) ads_cost, sum(sales) sales,
             sum(sales) / nullif(sum(ads_cost),0) roas,
             sum(view) view, sum(click) click, sum(orders) orders, sum(item_sold) item_sold
      from products_all
      group by kode_produk
    ) x)
  );
$$;

notify pgrst, 'reload config';
