-- =====================================================================
-- 0073: "Detail Product Profit" → full 13-column variant-level P&L
--
-- Adds Ads Cost and 5 Finance-cost columns to what was previously just
-- Sales/Modal/Profit, via two different join strategies:
--
--   Ads Cost: REAL product-level data — sales_rows(source='ads').kode_produk
--   (migration 0061) is a genuine Shopee field, no bridging needed. Summed
--   per kode_produk for the filtered period, then split across that
--   product's own variant rows weighted by each variant's OWN-PERIOD sales
--   share — not "first variant only", which would arbitrarily dump the
--   whole cost on one row and zero every sibling variant's ad exposure.
--
--   Finance costs (Promo/Refund/Delivery/Affiliate/MP Fee): finance_rows
--   (Shopee's Income export) has NO product/variant identifier at all —
--   it's one row per ORDER. order_rows (OrderCompleted export) shares
--   `order_no` with finance_rows AND carries product_name/variant_name
--   PLUS a real per-line-item "Subtotal Pesanan" (not yet a typed column,
--   read from raw). Bridge: join finance_rows -> order_rows on order_no,
--   prorate each order's finance costs across its line items by each
--   line's share of that order's total Subtotal Pesanan, then group by
--   normalized (product_name, variant_name) text — order_rows has no
--   reliable Kode Produk/Kode Variasi either (SKU Induk/Nomor Referensi SKU
--   are blank on the real export), so the final join back to the product
--   catalog is by lower(trim(name)) text match, not code. Any name that
--   doesn't match lands as 0 finance cost for that row rather than a wrong
--   number — not silently distributed elsewhere.
--
-- Also fixes the SAME "Kode Variasi" header-collision bug patched in
-- migration 0072 for product_catalog — this RPC was still reading
-- raw->>'Kode Variasi' directly (always "-", see 0072's comment), so
-- every SPOS variant here was invisible too until now.
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

  -- ── Ads Cost: real kode_produk data, distributed by within-product sales share ──
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

  -- ── Finance costs: bridge finance_rows -> order_rows on order_no, prorate ──
  -- Step A + B: each order's finance costs split across its line items by
  -- that line's share of the order's total "Subtotal Pesanan".
  fin as (
    select order_no, promotion_cost, refund, delivery_cost, affiliate_cost, marketplace_fee
    from finance_rows
    where order_no is not null
      and (p_year  is null or year        = p_year)
      and (p_month is null or month       = p_month)
      and (p_week  is null or week        = p_week)
      and (p_owner is null or pic_client  = p_owner)
      and (p_brand is null or brand       = p_brand)
      and (p_store is null or store_name  = p_store)
  ),
  ord_items as (
    select
      order_no,
      nullif(trim(product_name), '') as product_name,
      coalesce(nullif(trim(variant_name), ''), '-') as variant_name,
      nullif(regexp_replace(coalesce(raw->>'Subtotal Pesanan', ''), '[^0-9-]', '', 'g'), '')::numeric as item_subtotal
    from order_rows
    where order_no is not null
      and (p_year  is null or year        = p_year)
      and (p_month is null or month       = p_month)
      and (p_week  is null or week        = p_week)
      and (p_owner is null or pic_client  = p_owner)
      and (p_brand is null or brand       = p_brand)
      and (p_store is null or store_name  = p_store)
  ),
  order_totals as (
    select order_no, sum(item_subtotal) as order_subtotal_sum
    from ord_items
    group by order_no
  ),
  prorated as (
    select
      oi.product_name, oi.variant_name,
      coalesce(f.promotion_cost, 0)  * (oi.item_subtotal / nullif(ot.order_subtotal_sum, 0)) as promo_alloc,
      coalesce(f.refund, 0)          * (oi.item_subtotal / nullif(ot.order_subtotal_sum, 0)) as refund_alloc,
      coalesce(f.delivery_cost, 0)   * (oi.item_subtotal / nullif(ot.order_subtotal_sum, 0)) as delivery_alloc,
      coalesce(f.affiliate_cost, 0)  * (oi.item_subtotal / nullif(ot.order_subtotal_sum, 0)) as affiliate_alloc,
      coalesce(f.marketplace_fee, 0) * (oi.item_subtotal / nullif(ot.order_subtotal_sum, 0)) as mp_fee_alloc
    from ord_items oi
    join order_totals ot on ot.order_no = oi.order_no
    join fin f on f.order_no = oi.order_no
    where oi.product_name is not null and oi.item_subtotal is not null
  ),
  -- Step C: group the prorated allocations by normalized product+variant name.
  fin_by_variant as (
    select
      lower(trim(product_name)) as name_key,
      lower(trim(variant_name)) as variant_key,
      coalesce(sum(abs(promo_alloc)), 0)     as promotion_cost,
      coalesce(sum(abs(refund_alloc)), 0)    as refund,
      coalesce(sum(abs(delivery_alloc)), 0)  as delivery_cost,
      coalesce(sum(abs(affiliate_alloc)), 0) as affiliate_cost,
      coalesce(sum(abs(mp_fee_alloc)), 0)    as marketplace_fee
    from prorated
    group by 1, 2
  ),

  agg_full as (
    select
      ac.*,
      coalesce(ad.ads_cost, 0) as ads_cost,
      coalesce(fv.promotion_cost, 0)  as promotion_cost,
      coalesce(fv.refund, 0)          as refund,
      coalesce(fv.delivery_cost, 0)   as delivery_cost,
      coalesce(fv.affiliate_cost, 0)  as affiliate_cost,
      coalesce(fv.marketplace_fee, 0) as marketplace_fee
    from agg_costed ac
    left join ads_distributed ad
      on ad.kode_produk = ac.kode_produk and ad.kode_variasi = ac.kode_variasi
    left join fin_by_variant fv
      on fv.name_key = lower(trim(ac.nama_produk))
      and fv.variant_key = lower(trim(coalesce(ac.nama_variasi, '-')))
  )

  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'kode_produk', kode_produk, 'nama_produk', nama_produk,
        'kode_variasi', kode_variasi, 'nama_variasi', nama_variasi,
        'total_sales', total_sales, 'total_modal', total_modal,
        'promotion_cost', promotion_cost, 'refund', refund,
        'delivery_cost', delivery_cost, 'affiliate_cost', affiliate_cost,
        'marketplace_fee', marketplace_fee, 'ads_cost', ads_cost,
        'nett_profit', total_sales - (total_modal + promotion_cost + refund
          + delivery_cost + affiliate_cost + marketplace_fee + ads_cost)
      ) order by nama_produk, kode_produk, kode_variasi), '[]') from agg_full),
    'total_modal', (select coalesce(sum(total_modal), 0) from agg_costed),
    'monthly_modal', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'modal', modal)), '[]') from monthly_costed),
    -- UI lock: the Finance-cost columns are meaningless without an
    -- OrderCompleted upload to bridge through, for THIS filter scope.
    'has_orders', (select exists(
      select 1 from order_rows
      where order_no is not null
        and (p_year  is null or year        = p_year)
        and (p_month is null or month       = p_month)
        and (p_week  is null or week        = p_week)
        and (p_owner is null or pic_client  = p_owner)
        and (p_brand is null or brand       = p_brand)
        and (p_store is null or store_name  = p_store)
    ))
  );
$$;

notify pgrst, 'reload config';
