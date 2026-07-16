-- =====================================================================
-- 0063: ads_dashboard_summary() KPI totals showed Rp 0 for GMV Max even
-- with real uploaded data — reproduced live against production.
--
-- Root cause: migration 0062 filtered ad_groups to level='product' for
-- BOTH the KPI/chart totals AND the unified product table. But this
-- codebase's existing convention (see the "Grup Iklan Performance" table,
-- ads/page.tsx:196) treats the level='group' row as the authoritative
-- total for that ad group — Shopee's own pre-computed rollup — while
-- level='product' rows are just the per-item breakdown underneath it, not
-- meant to be re-summed into a grand total (summing them can double-count
-- against the group row, or under-count if the export's breakdown is
-- incomplete). For an account whose GMV Max upload only ever produced the
-- group-total row with no product breakdown, filtering to level='product'
-- silently excluded that row entirely — hence Rp 0 despite real data.
--
-- Fix: totals/charts now aggregate level='group' rows (matching the
-- existing convention); the unified product table still correctly uses
-- level='product' rows only (that part was right — it's a per-product
-- table, using the group row there WOULD double-count).
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
  -- level='group' rows: Shopee's own pre-computed per-group total — used
  -- for KPI totals and the trend charts (no double-counting risk).
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
  -- level='product' rows: the per-item breakdown — used ONLY for the
  -- unified product table.
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
