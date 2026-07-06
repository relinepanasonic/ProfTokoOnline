-- =====================================================================
-- 0035: "Modal Product" — manually-entered per-product/variant cost price
--
-- product_costs: one row per (kode_produk, kode_variasi), harga_modal is
-- entered by hand and survives re-upload (same pattern as ad_modals/0019).
--
-- Leaf-row rule for SPOS (verified against a real 1031-row parentskudetail
-- export, Node script comparing "parent-only" totals vs this "leaf" grouping
-- — both sum to identical totals, 350,739,000 / 71 units):
--   Shopee's parent row (Kode Variasi='-', traffic present, is_parent=true)
--   already equals the sum of its own variant child rows (Kode Variasi
--   real, traffic='-', is_parent=false) when a product has variants. So per
--   (upload, Kode Produk): if any child row exists, use the children only;
--   otherwise use the parent row. This gives per-variant granularity
--   without double-counting — see [[spos-parent-row-rule]].
--
-- Kode Produk / Kode Variasi / Nama Variasi are pulled from sales_rows.raw
-- (jsonb) since they were never promoted to typed columns — no re-upload
-- needed, `raw` already captured them for every historical SPOS upload.
-- =====================================================================

create table if not exists product_costs (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references clients(id) on delete cascade,
  kode_produk  text not null,
  kode_variasi text not null default '-',
  nama_produk  text,
  nama_variasi text,
  harga_modal  numeric,
  updated_at   timestamptz not null default now(),
  unique (client_id, kode_produk, kode_variasi)
);

alter table product_costs enable row level security;

drop policy if exists product_costs_super_all on product_costs;
create policy product_costs_super_all on product_costs
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

-- ── product_avg_price() — global (no period filter), for the Modal Product entry table ──
create or replace function product_avg_price()
returns jsonb
language sql stable
as $$
  with base as (
    select
      id, upload_id,
      nullif(trim(raw->>'Kode Produk'), '') as kode_produk,
      item_name as nama_produk,
      nullif(nullif(trim(raw->>'Kode Variasi'), '-'), '') as kode_variasi,
      nullif(trim(raw->>'Nama Variasi'), '-') as nama_variasi_raw,
      is_parent, sales_idr, units
    from sales_rows
    where source = 'spos'
  ),
  flagged as (
    select *,
      bool_or(kode_variasi is not null) over (partition by upload_id, kode_produk) as has_children
    from base
  ),
  leaf as (
    select * from flagged
    where kode_produk is not null
      and ((has_children and kode_variasi is not null)
        or (not has_children and kode_variasi is null and is_parent))
  )
  select coalesce(jsonb_agg(x), '[]') from (
    select
      kode_produk,
      coalesce(kode_variasi, '-') as kode_variasi,
      max(nama_produk) as nama_produk,
      max(nama_variasi_raw) as nama_variasi,
      coalesce(sum(sales_idr), 0) as total_sales,
      coalesce(sum(units), 0) as total_units,
      case when sum(units) > 0 then sum(sales_idr) / sum(units) else null end as avg_price
    from leaf
    group by kode_produk, coalesce(kode_variasi, '-')
    order by max(nama_produk), coalesce(kode_variasi, '-')
  ) x;
$$;

-- ── product_profit_detail() — period-filtered, for the Dashboard's Total
--    Modal Product KPI, its monthly stacked-chart series, and the "Detail
--    Product Profit" table ──
create or replace function product_profit_detail(
  p_year  int  default null,
  p_month text default null,
  p_week  text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with base as (
    select
      id, upload_id, month,
      nullif(trim(raw->>'Kode Produk'), '') as kode_produk,
      item_name as nama_produk,
      nullif(nullif(trim(raw->>'Kode Variasi'), '-'), '') as kode_variasi,
      nullif(trim(raw->>'Nama Variasi'), '-') as nama_variasi_raw,
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
      bool_or(kode_variasi is not null) over (partition by upload_id, kode_produk) as has_children
    from base
  ),
  leaf as (
    select * from flagged
    where kode_produk is not null
      and ((has_children and kode_variasi is not null)
        or (not has_children and kode_variasi is null and is_parent))
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
  )
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'kode_produk', kode_produk, 'nama_produk', nama_produk,
        'kode_variasi', kode_variasi, 'nama_variasi', nama_variasi,
        'total_sales', total_sales, 'total_modal', total_modal,
        'profit', total_sales - total_modal
      )), '[]') from agg_costed),
    'total_modal', (select coalesce(sum(total_modal), 0) from agg_costed),
    'monthly_modal', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'modal', modal)), '[]') from monthly_costed)
  );
$$;

-- ── finance_summary(): add Ads Spent (same source/mechanism as the main
--    Dashboard's "Ads Cost" KPI — sales_rows where source='ads') ──
create or replace function finance_summary(
  p_year  int  default null,
  p_month text default null,
  p_week  text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with f as (
    select r.*
    from finance_rows r
    where (p_year  is null or r.year        = p_year)
      and (p_month is null or r.month       = p_month)
      and (p_week  is null or r.week        = p_week)
      and (p_owner is null or r.pic_client  = p_owner)
      and (p_brand is null or r.brand       = p_brand)
      and (p_store is null or r.store_name  = p_store)
  ),
  ads as (
    select s.*
    from sales_rows s
    where s.source = 'ads'
      and (p_year  is null or s.year        = p_year)
      and (p_month is null or s.month       = p_month)
      and (p_week  is null or s.week        = p_week)
      and (p_owner is null or s.pic_client  = p_owner)
      and (p_brand is null or s.brand       = p_brand)
      and (p_store is null or s.store_name  = p_store)
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'sales',            coalesce(sum(sales),0),
        'promotion_cost',   coalesce(abs(sum(promotion_cost)),0),
        'refund',           coalesce(abs(sum(refund)),0),
        'delivery_cost',    coalesce(abs(sum(delivery_cost)),0),
        'affiliate_cost',   coalesce(abs(sum(affiliate_cost)),0),
        'marketplace_fee',  coalesce(abs(sum(marketplace_fee)),0),
        'misc',             coalesce(abs(sum(misc)),0),
        'gross_profit',     coalesce(sum(net_income),0),
        'ads_cost',         (select coalesce(sum(ad_cost),0) from ads)
      ) from f
    ),
    'monthly', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(sales) sales, sum(net_income) profit
        from f where month is not null group by month) x),
    'monthly_fee', (select coalesce(jsonb_agg(x),'[]') from (
        select month, abs(sum(marketplace_fee)) fee
        from f where month is not null group by month) x),
    'monthly_discount', (select coalesce(jsonb_agg(x),'[]') from (
        select month, abs(sum(promotion_cost)) discount
        from f where month is not null group by month) x),
    'monthly_ads_cost', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(ad_cost) ad_cost from ads
        where month is not null group by month) x),
    'monthly_costs', (select coalesce(jsonb_agg(x),'[]') from (
        select month,
               abs(sum(promotion_cost)) promotion_cost,
               abs(sum(refund)) refund,
               abs(sum(delivery_cost)) delivery_cost,
               abs(sum(affiliate_cost)) affiliate_cost,
               abs(sum(marketplace_fee)) marketplace_fee,
               abs(sum(misc)) misc
        from f where month is not null group by month) x),
    'payment_method', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(payment_method,'Lainnya') method, count(*) cnt
        from f group by payment_method) x),
    'jasa_kirim', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(jasa_kirim,'Lainnya') service, count(*) cnt
        from f group by jasa_kirim) x),
    'daily', (select coalesce(jsonb_agg(x order by x.tx_date),'[]') from (
        select release_date as tx_date, count(*) orders,
               sum(sales) sales, abs(sum(promotion_cost)) promotion_cost,
               abs(sum(marketplace_fee)) marketplace_fee, sum(net_income) net_income,
               abs(sum(refund)) refund
        from f where release_date is not null group by release_date) x)
  );
$$;

notify pgrst, 'reload config';
