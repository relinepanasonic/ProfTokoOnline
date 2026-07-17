-- =====================================================================
-- 0078: Found the real bottleneck via 0077's EXPLAIN ANALYZE plan —
-- fin_totals (the finance_rows aggregate) was being re-executed 178
-- times (once per output row) instead of once. Postgres inlines a CTE
-- that's referenced in exactly one place (default behavior since PG12)
-- when it decides that's cheaper — here it inlined fin_totals/
-- store_sales/coeffs into the `cross join coeffs c` position and
-- re-evaluated the whole chain per outer row of agg_costed, even though
-- none of them depend on the outer row at all. 178 loops x a ~1302-row
-- bitmap heap scan of finance_rows = the entire ~950ms-10s cost
-- (60,000+ buffer hits on that one node alone in the captured plan).
--
-- Fix: `as materialized` on the 3 CTEs in that chain forces Postgres to
-- compute each exactly once into a temp result and reuse it — this is
-- the standard, correct fix for this well-known CTE-inlining pitfall,
-- not a workaround. No formula/logic changes from 0075.
--
-- Also drops 0077's temporary diagnostic function now that it's served
-- its purpose.
-- =====================================================================

create or replace function product_profit_detail(
  p_year  int  default null,
  p_month text default null,
  p_week  text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
set statement_timeout = '30s'
as $$
  with base as (
    select
      id, upload_id, month,
      nullif(trim(raw->>'Kode Produk'), '') as kode_produk,
      item_name as nama_produk,
      coalesce(nullif(trim(raw->>'__COL_D'), '-'), nullif(trim(raw->>'Kode Variasi'), '-')) as kode_variasi,
      coalesce(nullif(trim(raw->>'__COL_E'), '-'), nullif(trim(raw->>'Nama Variasi'), '-')) as nama_variasi_raw,
      is_parent, sales_idr, units
    from sales_rows
    where source = 'spos'
      and (p_year  is null or year        = p_year)
      and (p_month is null or month       = p_month)
      and (p_week  is null or week        = p_week)
      and (p_owner is null or pic_client  = p_owner)
      and (p_brand is null or brand       = p_brand)
      and (p_store is null or store_name  = p_store)
  ),
  flagged as (
    select *,
      bool_or(kode_variasi is not null) over (partition by kode_produk) as has_children
    from base
    where kode_produk is not null
  ),
  leaf as (
    select * from flagged
    where (has_children and kode_variasi is not null)
       or (not has_children and kode_variasi is null and is_parent)
  ),
  agg as materialized (
    select
      kode_produk,
      coalesce(kode_variasi, '-') as kode_variasi,
      max(nama_produk) as nama_produk,
      max(nama_variasi_raw) as nama_variasi,
      coalesce(sum(sales_idr), 0) as total_sales,
      coalesce(sum(units), 0) as total_units
    from leaf
    group by kode_produk, coalesce(kode_variasi, '-')
  ),
  agg_costed as (
    select a.*, coalesce(a.total_units * pc.harga_modal, 0) as total_modal
    from agg a
    left join product_costs pc
      on pc.kode_produk = a.kode_produk and pc.kode_variasi = a.kode_variasi
  ),
  monthly_leaf as (
    select month, kode_produk, coalesce(kode_variasi, '-') as kode_variasi, sum(units) as units
    from leaf
    where month is not null
    group by month, kode_produk, coalesce(kode_variasi, '-')
  ),
  monthly_costed as (
    select ml.month, coalesce(sum(ml.units * pc.harga_modal), 0) as modal
    from monthly_leaf ml
    left join product_costs pc
      on pc.kode_produk = ml.kode_produk and pc.kode_variasi = ml.kode_variasi
    group by ml.month
  ),

  ads_by_product as (
    select kode_produk, coalesce(sum(ad_cost), 0) as ads_cost
    from sales_rows
    where source = 'ads' and kode_produk is not null
      and (p_year  is null or year        = p_year)
      and (p_month is null or month       = p_month)
      and (p_week  is null or week        = p_week)
      and (p_owner is null or pic_client  = p_owner)
      and (p_brand is null or brand       = p_brand)
      and (p_store is null or store_name  = p_store)
    group by kode_produk
  ),
  ads_distributed as (
    select
      a.kode_produk, a.kode_variasi,
      coalesce(ap.ads_cost * (a.total_sales / nullif(sum(a.total_sales) over (partition by a.kode_produk), 0)), 0) as ads_cost
    from agg a
    left join ads_by_product ap on ap.kode_produk = a.kode_produk
  ),

  -- `materialized` is the actual fix here (see migration header) — these
  -- 3 CTEs must each compute exactly once, not once per output row.
  fin_totals as materialized (
    select
      coalesce(abs(sum(promotion_cost)), 0)  as total_promotion,
      coalesce(abs(sum(refund)), 0)          as total_refund,
      coalesce(abs(sum(delivery_cost)), 0)   as total_delivery,
      coalesce(abs(sum(affiliate_cost)), 0)  as total_affiliate,
      coalesce(abs(sum(marketplace_fee)), 0) as total_marketplace_fee
    from finance_rows
    where (p_year  is null or year        = p_year)
      and (p_month is null or month       = p_month)
      and (p_week  is null or week        = p_week)
      and (p_owner is null or pic_client  = p_owner)
      and (p_brand is null or brand       = p_brand)
      and (p_store is null or store_name  = p_store)
  ),
  store_sales as materialized (
    select coalesce(sum(total_sales), 0) as total from agg
  ),
  coeffs as materialized (
    select
      case when s.total > 0 then f.total_promotion / s.total else 0 end       as coef_promotion,
      case when s.total > 0 then f.total_refund / s.total else 0 end         as coef_refund,
      case when s.total > 0 then f.total_delivery / s.total else 0 end       as coef_delivery,
      case when s.total > 0 then f.total_affiliate / s.total else 0 end      as coef_affiliate,
      case when s.total > 0 then f.total_marketplace_fee / s.total else 0 end as coef_marketplace_fee
    from fin_totals f, store_sales s
  ),

  agg_full as (
    select
      ac.*,
      coalesce(ad.ads_cost, 0) as ads_cost,
      ac.total_sales * c.coef_promotion       as promotion_cost,
      ac.total_sales * c.coef_refund          as refund,
      ac.total_sales * c.coef_delivery        as delivery_cost,
      ac.total_sales * c.coef_affiliate       as affiliate_cost,
      ac.total_sales * c.coef_marketplace_fee as marketplace_fee
    from agg_costed ac
    cross join coeffs c
    left join ads_distributed ad
      on ad.kode_produk = ac.kode_produk and ad.kode_variasi = ac.kode_variasi
  )

  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'kode_produk', kode_produk, 'nama_produk', nama_produk,
        'kode_variasi', kode_variasi, 'nama_variasi', nama_variasi,
        'units_sold', total_units,
        'total_sales', total_sales, 'total_modal', total_modal,
        'promotion_cost', promotion_cost, 'refund', refund,
        'delivery_cost', delivery_cost, 'affiliate_cost', affiliate_cost,
        'marketplace_fee', marketplace_fee, 'ads_cost', ads_cost,
        'nett_profit', total_sales - (total_modal + promotion_cost + refund
          + delivery_cost + affiliate_cost + marketplace_fee + ads_cost)
      ) order by nama_produk, kode_produk, kode_variasi), '[]') from agg_full),
    'total_modal', (select coalesce(sum(total_modal), 0) from agg_costed),
    'monthly_modal', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'modal', modal)), '[]') from monthly_costed)
  );
$$;

drop function if exists debug_product_profit_detail_explain(int, text, text, text, text, text);

notify pgrst, 'reload config';
