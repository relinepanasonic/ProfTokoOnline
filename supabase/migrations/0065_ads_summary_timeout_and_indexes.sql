-- =====================================================================
-- 0065: ads_dashboard_summary() hits the role-level 20s statement_timeout
-- (57014) — same failure mode already fixed once for refresh_dashboard_
-- rollup() in migration 0060. Two contributing gaps:
--
--   1. No function-level statement_timeout override, so it's stuck on the
--      20s role limit tuned for light read queries, not this function's
--      several CTEs scanning sales_rows/ad_groups plus RLS's own
--      store_links subquery on every row.
--   2. No index supports its actual filter shape: sales_rows has
--      (client_id, year, month, city, store_name, source) — source is the
--      LAST column, not great for "just filter by source" — and ad_groups
--      has no index touching `level` at all, so `where level = 'group'`
--      and `where level = 'product'` are both sequential scans.
--
-- Fix: give the function its own longer timeout (same technique as 0060)
-- and add two lean indexes matching this function's actual access
-- pattern. Function body is otherwise identical to 0063 — no logic change.
-- =====================================================================

create index if not exists sales_rows_client_source_idx on sales_rows (client_id, source);
create index if not exists ad_groups_client_level_idx on ad_groups (client_id, level);

create or replace function ads_dashboard_summary(
  p_year  int  default null,
  p_month text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable set statement_timeout = '60s'
as $$
  with ads_base as (
    select year, month, store_name, item_name, kode_produk,
           sales_idr, ad_cost, visitors, clicks, orders, units
    from sales_rows
    where source = 'ads'
      and (p_year  is null or year  = p_year)
      and (p_month is null or month = p_month)
      and (p_store is null or store_name = p_store)
      and (p_owner is null or store_name in (select sl.store_name from store_links sl where sl.owner = p_owner and sl.store_name is not null))
      and (p_brand is null or store_name in (select sl.store_name from store_links sl where sl.brand = p_brand and sl.store_name is not null))
  ),
  grp_totals as (
    select year, month, store_name, item_name, ads_level,
           omzet, biaya, dilihat, klik, konversi, produk_terjual
    from ad_groups
    where level = 'group'
      and (p_year  is null or year  = p_year)
      and (p_month is null or month = p_month)
      and (p_store is null or store_name = p_store)
      and (p_owner is null or store_name in (select sl.store_name from store_links sl where sl.owner = p_owner and sl.store_name is not null))
      and (p_brand is null or store_name in (select sl.store_name from store_links sl where sl.brand = p_brand and sl.store_name is not null))
  ),
  grp_products as (
    select year, month, store_name, item_name, kode_produk,
           omzet, biaya, dilihat, klik, konversi, produk_terjual
    from ad_groups
    where level = 'product'
      and (p_year  is null or year  = p_year)
      and (p_month is null or month = p_month)
      and (p_store is null or store_name = p_store)
      and (p_owner is null or store_name in (select sl.store_name from store_links sl where sl.owner = p_owner and sl.store_name is not null))
      and (p_brand is null or store_name in (select sl.store_name from store_links sl where sl.brand = p_brand and sl.store_name is not null))
  ),
  gmv_rows   as (select * from grp_totals where ads_level = 'incubation' or item_name = 'Shop GMV Max'),
  group_rows as (select * from grp_totals where not (ads_level = 'incubation' or item_name = 'Shop GMV Max')),

  t_total as (
    select coalesce(sum(ad_cost),0) ads_cost, coalesce(sum(sales_idr),0) omzet,
           coalesce(sum(visitors),0) view, coalesce(sum(clicks),0) click,
           coalesce(sum(orders),0) orders, coalesce(sum(units),0) item_sold
    from ads_base
  ),
  t_gmv as (
    select coalesce(sum(biaya),0) ads_cost, coalesce(sum(omzet),0) omzet,
           coalesce(sum(dilihat),0) view, coalesce(sum(klik),0) click,
           coalesce(sum(konversi),0) orders, coalesce(sum(produk_terjual),0) item_sold
    from gmv_rows
  ),
  t_group as (
    select coalesce(sum(biaya),0) ads_cost, coalesce(sum(omzet),0) omzet,
           coalesce(sum(dilihat),0) view, coalesce(sum(klik),0) click,
           coalesce(sum(konversi),0) orders, coalesce(sum(produk_terjual),0) item_sold
    from group_rows
  ),

  products_ads as (
    select kode_produk, item_name as nama_produk, ad_cost as ads_cost, sales_idr as omzet,
           visitors as view, clicks as click, orders, units as item_sold
    from ads_base where kode_produk is not null
  ),
  products_grp as (
    select kode_produk, item_name as nama_produk, biaya as ads_cost, omzet,
           dilihat as view, klik as click, konversi as orders, produk_terjual as item_sold
    from grp_products where kode_produk is not null and kode_produk <> '-' and kode_produk <> ''
  ),
  products_all as (select * from products_ads union all select * from products_grp)

  select jsonb_build_object(
    'totals', jsonb_build_object(
      'total', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'omzet', t.omzet, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.omzet / nullif(t.ads_cost,0)
      ) from t_total t),
      'gmv_max', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'omzet', t.omzet, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.omzet / nullif(t.ads_cost,0)
      ) from t_gmv t),
      'group_ads', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'omzet', t.omzet, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.omzet / nullif(t.ads_cost,0)
      ) from t_group t),
      'independent', (select jsonb_build_object(
        'ads_cost', tot.ads_cost - g.ads_cost - grp.ads_cost,
        'omzet',    tot.omzet    - g.omzet    - grp.omzet,
        'view',     tot.view     - g.view     - grp.view,
        'click',    tot.click    - g.click    - grp.click,
        'orders',   tot.orders   - g.orders   - grp.orders,
        'item_sold',tot.item_sold- g.item_sold- grp.item_sold,
        'roas',     (tot.omzet - g.omzet - grp.omzet)
                    / nullif(tot.ads_cost - g.ads_cost - grp.ads_cost, 0)
      ) from t_total tot, t_gmv g, t_group grp)
    ),
    'monthly', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      with months as (
        select distinct month from ads_base   where month is not null
        union select distinct month from gmv_rows   where month is not null
        union select distinct month from group_rows where month is not null
      ),
      a  as (select month, sum(sales_idr) omzet, sum(ad_cost) ad_cost from ads_base   group by month),
      gm as (select month, sum(omzet) omzet                          from gmv_rows   group by month),
      gr as (select month, sum(omzet) omzet                          from group_rows group by month)
      select
        m.month,
        coalesce(gm.omzet,0) gmv_max_omzet,
        coalesce(gr.omzet,0) group_omzet,
        coalesce(a.omzet,0) - coalesce(gm.omzet,0) - coalesce(gr.omzet,0) as independent_omzet,
        coalesce(a.omzet,0) / nullif(coalesce(a.ad_cost,0),0) as roas
      from months m
      left join a  on a.month  = m.month
      left join gm on gm.month = m.month
      left join gr on gr.month = m.month
    ) x),
    'view_click_trend', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      select month, sum(visitors) view, sum(clicks) click from ads_base
      where month is not null group by month
    ) x),
    'sold_omzet_trend', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      select month, sum(units) item_sold, sum(sales_idr) omzet from ads_base
      where month is not null group by month
    ) x),
    'products', (select coalesce(jsonb_agg(x order by x.omzet desc nulls last), '[]') from (
      select kode_produk,
             (array_agg(nama_produk) filter (where nama_produk is not null))[1] as nama_produk,
             sum(ads_cost) ads_cost, sum(omzet) omzet,
             sum(omzet) / nullif(sum(ads_cost),0) roas,
             sum(view) view, sum(click) click, sum(orders) orders, sum(item_sold) item_sold
      from products_all
      group by kode_produk
    ) x)
  );
$$;

notify pgrst, 'reload config';
