-- =====================================================================
-- 0075: Detail Product Profit — replace the OrderCompleted proration
-- bridge (migration 0073) with a simple store-wide coefficient model,
-- per the user's own spec:
--
--   Coefficient(cost type) = Total [cost type] for the store/period
--                             (from finance_rows, same buckets as
--                             finance_summary()'s KPIs)
--                           ÷ Total ProductPerforma Sales for the SAME
--                             store/period (sum of every row's own Sales
--                             in this table — NOT finance_rows' own sales
--                             figure, so the rows always reconcile exactly
--                             back to the store total by construction).
--
--   Row cost = Coefficient × that row's own Sales.
--
-- This drops finance_rows<->order_rows joins, No.Pesanan matching, and
-- Subtotal Pesanan proration entirely — no OrderCompleted upload is
-- needed anymore for these 5 columns. Also removes the query's biggest
-- cost (the unindexed-feeling multi-way join across ~1700+order_rows
-- rows that made this RPC take 13.5s even with RLS bypassed) — now it's
-- one cheap store-wide SUM per cost bucket plus the existing small spos
-- aggregation.
--
-- Also adds units_sold (Produk (Pesanan Siap Dikirim)) as its own column
-- per the user's spec, and drops the has_orders flag (no longer
-- meaningful — nothing on this table depends on order_rows anymore).
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
  agg as (
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

  -- ── Ads Cost: unchanged from 0073 — real kode_produk-level data
  -- (same source Ads Product Performance is built from), distributed to
  -- variants by within-product sales share. ──
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

  -- ── Store-wide coefficient model — replaces the OrderCompleted bridge.
  -- fin_totals: the same 5 buckets finance_summary() already computes,
  -- for this exact store/period scope.
  fin_totals as (
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
  -- store_sales: the denominator — total of THIS table's own Sales
  -- column across every row, so per-row costs always sum back exactly
  -- to fin_totals (the whole point of a constant coefficient).
  store_sales as (
    select coalesce(sum(total_sales), 0) as total from agg
  ),
  coeffs as (
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

notify pgrst, 'reload config';
