-- =====================================================================
-- 0090: Weekly drilldown for Ads Performance's "Sales by Ads Type" and
-- "Item Sold vs Sales" charts.
--
-- Same shape as 0089 for the Dashboard: ads_rollup gains `week`, its
-- refresh includes it, and ads_dashboard_summary's `monthly` +
-- `sold_sales_trend` series bucket dynamically — by month when p_month
-- IS NULL, by week when a specific month is selected. ad_groups/sales_rows
-- carry a manually-entered `week` but no true daily date, so WEEK is the
-- finest honest granularity (not day). Output field name stays `month`
-- (value = month or week label) so the frontend contract is unchanged;
-- only the two target charts read these series.
-- =====================================================================

alter table ads_rollup add column if not exists week text;
create index if not exists ads_rollup_month_week_idx on ads_rollup (client_id, month, week);

create or replace function refresh_ads_rollup() returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
  truncate ads_rollup;
  insert into ads_rollup (client_id, source, year, month, week, store_name, item_name, kode_produk, ads_level,
                           ads_cost, sales, view, click, add_to_cart, orders, item_sold)
  select client_id, 'total', year, month, week, store_name, item_name,
         nullif(nullif(trim(kode_produk), ''), '-') as kode_produk,
         null,
         sum(ad_cost), sum(sales_idr), sum(visitors), sum(clicks), sum(add_to_cart), sum(orders), sum(units)
  from sales_rows
  where source = 'ads'
  group by client_id, year, month, week, store_name, item_name, nullif(nullif(trim(kode_produk), ''), '-');

  insert into ads_rollup (client_id, source, year, month, week, store_name, item_name, kode_produk, ads_level,
                           ads_cost, sales, view, click, add_to_cart, orders, item_sold)
  select client_id, 'group', year, month, week, store_name, item_name,
         null, ads_level,
         sum(biaya), sum(omzet), sum(dilihat), sum(klik), null, sum(konversi), sum(produk_terjual)
  from ad_groups
  where level = 'group'
  group by client_id, year, month, week, store_name, item_name, ads_level;

  insert into ads_rollup (client_id, source, year, month, week, store_name, item_name, kode_produk, ads_level,
                           ads_cost, sales, view, click, add_to_cart, orders, item_sold)
  select client_id, 'product', year, month, week, store_name, item_name,
         nullif(nullif(trim(kode_produk), ''), '-') as kode_produk, ads_level,
         sum(biaya), sum(omzet), sum(dilihat), sum(klik), null, sum(konversi), sum(produk_terjual)
  from ad_groups
  where level = 'product'
  group by client_id, year, month, week, store_name, item_name, nullif(nullif(trim(kode_produk), ''), '-'), ads_level;
end $$;

grant execute on function refresh_ads_rollup() to authenticated, service_role;

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
    select source, year, month, week, store_name, item_name, kode_produk, ads_level,
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
    -- Dynamic bucket: month when All Months, week when a month is picked.
    -- Output key stays `month` (value = bucket) so the frontend contract
    -- is unchanged; the "Sales by Ads Type" chart reads this.
    'monthly', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      with buckets as (
        select distinct (case when p_month is null then month else week end) as b from ads_base   where (case when p_month is null then month else week end) is not null
        union select distinct (case when p_month is null then month else week end) from gmv_rows   where (case when p_month is null then month else week end) is not null
        union select distinct (case when p_month is null then month else week end) from group_rows where (case when p_month is null then month else week end) is not null
      ),
      a  as (select (case when p_month is null then month else week end) as b, sum(sales) sales, sum(ads_cost) ads_cost from ads_base   group by 1),
      gm as (select (case when p_month is null then month else week end) as b, sum(sales) sales                        from gmv_rows   group by 1),
      gr as (select (case when p_month is null then month else week end) as b, sum(sales) sales                        from group_rows group by 1)
      select
        bk.b as month,
        coalesce(gm.sales,0) gmv_max_sales,
        coalesce(gr.sales,0) group_sales,
        coalesce(a.sales,0) - coalesce(gm.sales,0) - coalesce(gr.sales,0) as independent_sales,
        coalesce(a.sales,0) / nullif(coalesce(a.ads_cost,0),0) as roas
      from buckets bk
      left join a  on a.b  = bk.b
      left join gm on gm.b = bk.b
      left join gr on gr.b = bk.b
    ) x),
    'sold_sales_trend', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      select (case when p_month is null then month else week end) as month,
             sum(item_sold) item_sold, sum(sales) sales
      from ads_base
      where (case when p_month is null then month else week end) is not null
      group by (case when p_month is null then month else week end)
    ) x),
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

select refresh_ads_rollup();

notify pgrst, 'reload config';
