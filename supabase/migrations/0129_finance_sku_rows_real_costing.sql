-- =====================================================================
-- 0129: REAL per-product costing from Shopee's newer "Laporan Penghasilan"
-- (sheet "Penghasilan": an Order row + one Sku row per product, with
-- Shopee's own per-product split of every fee) + a Pajak (tax) column.
--
-- 1. finance_rows.pajak           — PPh 22 per order (informational; it is
--                                   ALSO inside marketplace_fee, exactly like
--                                   the old "Bea Masuk, PPN & PPh", so
--                                   finance_summary keeps reconciling).
--                                   Older uploads have no Pajak -> 0.
-- 2. finance_sku_rows             — one row per product line of an order.
-- 3. product_profit_detail()      — now uses the real per-product costs.
--
-- How Product Profit costs a product now:
--   * Orders that HAVE per-product lines (new report): each product gets its
--     own real Promo / Refund / Delivery / Affiliate / Marketplace Fee / Pajak
--     (Shopee's numbers; a product's cost is spread over its variants by
--     their sales share only because the report is per product, not variant).
--   * Orders that do NOT (older uploads, orders without lines): same
--     estimate as before — that remainder spread across products by their
--     share of Sales. Pajak for those = 0 (the tax only exists in the new
--     report, i.e. from October 2026).
--   * A fully new-format month therefore has no estimated part at all; an
--     older month is identical to the previous behaviour.
--   Each row says which it was: costing = 'real' | 'mixed' | 'estimated'.
--   Products that appear in the finance report but have no sales row in the
--   Product Performance upload are listed too (variant '-', units 0) so the
--   real costs never silently disappear from the total.
-- =====================================================================

alter table finance_rows add column if not exists pajak numeric not null default 0;

create table if not exists finance_sku_rows (
  id               bigint generated always as identity primary key,
  client_id        uuid not null references clients(id) on delete cascade,
  upload_id        uuid references uploads(id) on delete cascade,

  year             int,
  month            text,
  week             text,
  store_name       text,
  pic_client       text,
  brand            text,

  order_no         text not null,
  kode_produk      text not null,      -- Shopee "ID Produk"
  nama_produk      text,
  order_date       date,
  release_date     date,

  -- signed like finance_rows (costs are negative); marketplace_fee EXCLUDES pajak
  sales            numeric not null default 0,
  refund           numeric not null default 0,
  promotion_cost   numeric not null default 0,
  delivery_cost    numeric not null default 0,
  affiliate_cost   numeric not null default 0,
  marketplace_fee  numeric not null default 0,
  misc             numeric not null default 0,
  pajak            numeric not null default 0,
  net_income       numeric not null default 0,

  created_at       timestamptz not null default now()
);

create index if not exists finance_sku_rows_order_idx on finance_sku_rows (client_id, order_no);
create index if not exists finance_sku_rows_dims_idx  on finance_sku_rows (client_id, year, month, week, store_name);
create index if not exists finance_sku_rows_upload_idx on finance_sku_rows (upload_id);
create index if not exists finance_sku_rows_product_idx on finance_sku_rows (client_id, kode_produk);

alter table finance_sku_rows enable row level security;

-- Same access as finance_rows (0031 / 0051 / 0059), helper calls wrapped in
-- (select ...) so they are evaluated once per statement, not per row.
drop policy if exists finance_sku_rows_super_all on finance_sku_rows;
create policy finance_sku_rows_super_all on finance_sku_rows
  for all using ((select my_role())::text = 'superadmin')
  with check ((select my_role())::text = 'superadmin');

drop policy if exists finance_sku_rows_owner_scoped_read on finance_sku_rows;
create policy finance_sku_rows_owner_scoped_read on finance_sku_rows
  for select using (
    client_id = (select my_client_id())
    and (select my_role())::text = 'branch_manager'
    and store_name in (
      select sl.store_name from store_links sl
      where sl.client_id = (select my_client_id()) and sl.owner = (select my_scope_owner()) and sl.store_name is not null
    )
  );

drop policy if exists finance_sku_rows_staff_read on finance_sku_rows;
create policy finance_sku_rows_staff_read on finance_sku_rows
  for select using (
    client_id = (select my_client_id())
    and (select my_role())::text in ('client_admin', 'advertiser')
  );

-- ── product_profit_detail ────────────────────────────────────────────────────
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

  -- ── REAL per-product costs (new report: Shopee's own split per product) ──
  sku_by_product as materialized (
    select
      s.kode_produk,
      max(s.nama_produk) as nama_produk,
      coalesce(sum(s.sales), 0)                  as sales,
      coalesce(abs(sum(s.promotion_cost)), 0)    as promotion_cost,
      coalesce(abs(sum(s.refund)), 0)            as refund,
      coalesce(abs(sum(s.delivery_cost)), 0)     as delivery_cost,
      coalesce(abs(sum(s.affiliate_cost)), 0)    as affiliate_cost,
      coalesce(abs(sum(s.marketplace_fee)), 0)   as marketplace_fee,
      coalesce(abs(sum(s.pajak)), 0)             as pajak
    from finance_sku_rows s
    where (p_year  is null or s.year        = p_year)
      and (p_month is null or s.month       = p_month)
      and (p_week  is null or s.week        = p_week)
      and (p_owner is null or s.pic_client  = p_owner)
      and (p_brand is null or s.brand       = p_brand)
      and (p_store is null or s.store_name  = p_store)
    group by s.kode_produk
  ),
  -- a product's real cost is per PRODUCT; spread it over its variants by sales share
  sku_distributed as (
    select
      a.kode_produk, a.kode_variasi,
      coalesce(a.total_sales / nullif(sum(a.total_sales) over (partition by a.kode_produk), 0),
               1.0 / count(*) over (partition by a.kode_produk)) as share,
      sp.promotion_cost, sp.refund, sp.delivery_cost, sp.affiliate_cost, sp.marketplace_fee, sp.pajak
    from agg a
    join sku_by_product sp on sp.kode_produk = a.kode_produk
  ),

  -- ── ESTIMATE for orders WITHOUT per-product lines (older uploads), as before.
  -- `materialized` is required (see migration 0078): each must compute once.
  -- marketplace_fee includes pajak on new-format orders; pajak is split out here.
  fin_totals as materialized (
    select
      coalesce(abs(sum(f.promotion_cost)), 0)                as total_promotion,
      coalesce(abs(sum(f.refund)), 0)                        as total_refund,
      coalesce(abs(sum(f.delivery_cost)), 0)                 as total_delivery,
      coalesce(abs(sum(f.affiliate_cost)), 0)                as total_affiliate,
      coalesce(abs(sum(f.marketplace_fee - f.pajak)), 0)     as total_marketplace_fee,
      coalesce(abs(sum(f.pajak)), 0)                         as total_pajak
    from finance_rows f
    where (p_year  is null or f.year        = p_year)
      and (p_month is null or f.month       = p_month)
      and (p_week  is null or f.week        = p_week)
      and (p_owner is null or f.pic_client  = p_owner)
      and (p_brand is null or f.brand       = p_brand)
      and (p_store is null or f.store_name  = p_store)
      and not exists (
        select 1 from finance_sku_rows s
        where s.client_id = f.client_id and s.order_no = f.order_no
      )
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
      case when s.total > 0 then f.total_marketplace_fee / s.total else 0 end as coef_marketplace_fee,
      case when s.total > 0 then f.total_pajak / s.total else 0 end          as coef_pajak,
      (f.total_promotion + f.total_refund + f.total_delivery + f.total_affiliate
         + f.total_marketplace_fee + f.total_pajak) > 0                       as has_estimated
    from fin_totals f, store_sales s
  ),

  agg_full as (
    select
      ac.kode_produk, ac.kode_variasi, ac.nama_produk, ac.nama_variasi,
      ac.total_units, ac.total_sales, ac.total_modal,
      coalesce(ad.ads_cost, 0) as ads_cost,
      coalesce(sd.promotion_cost  * sd.share, 0) + ac.total_sales * c.coef_promotion        as promotion_cost,
      coalesce(sd.refund          * sd.share, 0) + ac.total_sales * c.coef_refund           as refund,
      coalesce(sd.delivery_cost   * sd.share, 0) + ac.total_sales * c.coef_delivery         as delivery_cost,
      coalesce(sd.affiliate_cost  * sd.share, 0) + ac.total_sales * c.coef_affiliate        as affiliate_cost,
      coalesce(sd.marketplace_fee * sd.share, 0) + ac.total_sales * c.coef_marketplace_fee  as marketplace_fee,
      coalesce(sd.pajak           * sd.share, 0) + ac.total_sales * c.coef_pajak            as pajak,
      case
        when sd.kode_produk is not null and c.has_estimated then 'mixed'
        when sd.kode_produk is not null then 'real'
        when c.has_estimated then 'estimated'
        else 'real'
      end as costing
    from agg_costed ac
    cross join coeffs c
    left join ads_distributed ad
      on ad.kode_produk = ac.kode_produk and ad.kode_variasi = ac.kode_variasi
    left join sku_distributed sd
      on sd.kode_produk = ac.kode_produk and sd.kode_variasi = ac.kode_variasi
  ),
  -- products in the finance report with no Product Performance sales row
  fin_only as (
    select
      sp.kode_produk, '-'::text as kode_variasi, sp.nama_produk, null::text as nama_variasi,
      0::numeric as total_units, sp.sales as total_sales, 0::numeric as total_modal,
      coalesce(ap.ads_cost, 0) as ads_cost,
      sp.promotion_cost, sp.refund, sp.delivery_cost, sp.affiliate_cost, sp.marketplace_fee, sp.pajak,
      'real'::text as costing
    from sku_by_product sp
    left join ads_by_product ap on ap.kode_produk = sp.kode_produk
    where not exists (select 1 from agg a where a.kode_produk = sp.kode_produk)
  ),
  all_rows as (
    select * from agg_full
    union all
    select * from fin_only
  )

  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'kode_produk', kode_produk, 'nama_produk', nama_produk,
        'kode_variasi', kode_variasi, 'nama_variasi', nama_variasi,
        'units_sold', total_units,
        'total_sales', total_sales, 'total_modal', total_modal,
        'promotion_cost', promotion_cost, 'refund', refund,
        'delivery_cost', delivery_cost, 'affiliate_cost', affiliate_cost,
        'marketplace_fee', marketplace_fee, 'pajak', pajak, 'ads_cost', ads_cost,
        'costing', costing,
        'nett_profit', total_sales - (total_modal + promotion_cost + refund
          + delivery_cost + affiliate_cost + marketplace_fee + pajak + ads_cost)
      ) order by nama_produk, kode_produk, kode_variasi), '[]') from all_rows),
    'total_modal', (select coalesce(sum(total_modal), 0) from agg_costed),
    'monthly_modal', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'modal', modal)), '[]') from monthly_costed)
  );
$$;

notify pgrst, 'reload config';
