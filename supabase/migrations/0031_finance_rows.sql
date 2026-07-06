-- =====================================================================
-- 0031: "Detail Keuangan" — Shopee Income (Laporan Penghasilan) report
--
-- Categorisation mirrors Shopee's own Summary sheet exactly:
--   Total Sales            = Harga Asli Produk
--   Discount/Voucher       = Total Diskon Produk + Diskon dari Shopee +
--                             Voucher (+co-fund) Penjual + Cashback Koin (+co-fund)
--   Marketplace Fee        = "Biaya Admin & Layanan" bucket (AMS, Admin,
--                             Layanan, Proses Pesanan, Premi, Hemat Kirim,
--                             Transaksi, Kampanye, Isi Saldo Otomatis)
--   Gross Profit (no COGS) = Total Penghasilan (Shopee's own net figure —
--                             "Total yang Dilepas": revenue minus every
--                             marketplace-side cost, but not the seller's
--                             own product cost)
--   Refund                 = Jumlah Pengembalian Dana ke Pembeli
--   Shipping net           = kept for reference only, not a headline KPI
-- =====================================================================

alter type data_source add value if not exists 'finance';

create table if not exists finance_rows (
  id                bigint generated always as identity primary key,
  client_id         uuid not null references clients(id) on delete cascade,
  upload_id         uuid references uploads(id) on delete cascade,

  -- manual dimensions, same convention as every other upload in this app
  year              int,
  month             text,
  week              text,
  store_name        text,
  pic_client        text,   -- owner
  brand             text,

  -- per-order identifiers
  order_no          text,
  buyer_username    text,
  payment_method    text,
  order_date        date,   -- Waktu Pesanan Dibuat
  release_date      date,   -- Tanggal Dana Dilepaskan (drives the daily table)

  -- the 5 KPI components (stored as positive magnitudes, except net_income
  -- which keeps its real sign)
  sales             numeric,  -- Harga Asli Produk
  discount_voucher  numeric,
  refund            numeric,
  shipping_net      numeric,  -- informational only
  marketplace_fee   numeric,
  net_income        numeric,  -- Total Penghasilan

  jasa_kirim        text,
  nama_kurir        text,

  raw               jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists finance_rows_dims_idx
  on finance_rows (client_id, year, month, week, store_name);
create index if not exists finance_rows_release_date_idx
  on finance_rows (client_id, release_date);
create index if not exists finance_rows_upload_idx on finance_rows (upload_id);

alter table finance_rows enable row level security;

drop policy if exists finance_rows_super_all on finance_rows;
create policy finance_rows_super_all on finance_rows
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

-- Detail Keuangan is currently superadmin-only in the nav — one policy is
-- enough today; widen this if the page is ever opened to other roles.

-- ── finance_summary RPC (single scan, mirrors dashboard_summary's design) ────
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
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'sales',            coalesce(sum(sales),0),
        'discount_voucher', coalesce(sum(discount_voucher),0),
        'marketplace_fee',  coalesce(sum(marketplace_fee),0),
        'gross_profit',     coalesce(sum(net_income),0),
        'refund',           coalesce(sum(refund),0)
      ) from f
    ),
    'monthly', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(sales) sales, sum(net_income) profit
        from f where month is not null group by month) x),
    'monthly_fee', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(marketplace_fee) fee
        from f where month is not null group by month) x),
    'monthly_discount', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(discount_voucher) discount
        from f where month is not null group by month) x),
    'payment_method', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(payment_method,'Lainnya') method, count(*) cnt
        from f group by payment_method) x),
    'jasa_kirim', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(jasa_kirim,'Lainnya') service, count(*) cnt
        from f group by jasa_kirim) x),
    'daily', (select coalesce(jsonb_agg(x order by x.tx_date),'[]') from (
        select release_date as tx_date, count(*) orders,
               sum(sales) sales, sum(discount_voucher) discount_voucher,
               sum(marketplace_fee) marketplace_fee, sum(net_income) net_income,
               sum(refund) refund
        from f where release_date is not null group by release_date) x)
  );
$$;

alter role authenticated set statement_timeout = '20s';
notify pgrst, 'reload config';
