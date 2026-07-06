-- =====================================================================
-- 0037: Store Performance — Shopee "Order.completed" (order-level) export
--
-- One row per order line-item (an order can span several rows, one per
-- SKU/variant) — verified against a real June 2026 export: 1665 rows /
-- 1290 distinct orders. Every order-level KPI counts DISTINCT order_no,
-- never row count, or it double-counts multi-item orders.
--
-- Column-letter checkpoints (verified against the real header row):
--   ship_deadline  = "Pesanan Harus Dikirimkan Sebelum..." = column I
--   paid_at        = "Waktu Pembayaran Dilakukan"          = column L
--   completed_at   = "Waktu Pesanan Selesai"                = column AX (last)
-- =====================================================================

alter type data_source add value if not exists 'orders';

create table if not exists order_rows (
  id                    bigint generated always as identity primary key,
  client_id             uuid not null references clients(id) on delete cascade,
  upload_id             uuid references uploads(id) on delete cascade,

  -- manual dimensions, same convention as every other upload in this app
  year                  int,
  month                 text,
  week                  text,
  store_name            text,
  pic_client            text,   -- owner
  brand                 text,

  order_no              text,
  order_type            text,
  order_status          text,             -- Status Pesanan
  cancel_return_status  text,             -- Status Pembatalan/ Pengembalian
  tracking_no           text,
  shipping_option       text,             -- Opsi Pengiriman
  ship_deadline         timestamp,        -- Pesanan Harus Dikirimkan Sebelum (I)
  order_created_at      timestamp,
  paid_at               timestamp,        -- Waktu Pembayaran Dilakukan (L)
  payment_method        text,
  product_name          text,
  variant_name          text,
  qty                   numeric,          -- Jumlah
  returned_qty          numeric,
  total_payment         numeric,          -- Total Pembayaran (order-level GMV, repeated per line)
  buyer_username        text,
  city                  text,             -- Kota/Kabupaten
  province              text,
  completed_at          timestamp,        -- Waktu Pesanan Selesai (AX) — anchors the daily table

  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists order_rows_dims_idx
  on order_rows (client_id, year, month, week, store_name);
create index if not exists order_rows_completed_idx
  on order_rows (client_id, completed_at);
create index if not exists order_rows_upload_idx on order_rows (upload_id);
create index if not exists order_rows_year_only_idx  on order_rows (year)  where year  is not null;
create index if not exists order_rows_month_only_idx on order_rows (month) where month is not null;

alter table order_rows enable row level security;

drop policy if exists order_rows_super_all on order_rows;
create policy order_rows_super_all on order_rows
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

-- Store Performance is superadmin-only in the nav — one policy is enough
-- today; widen this if the page is ever opened to other roles.

create or replace function store_perf_filters() returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'years',  (select coalesce(jsonb_agg(distinct year order by year desc), '[]') from order_rows where year  is not null),
    'months', (select coalesce(jsonb_agg(distinct month), '[]')                  from order_rows where month is not null)
  );
$$;

-- ── store_perf_summary RPC (single scan) ─────────────────────────────────────
create or replace function store_perf_summary(
  p_year  int  default null,
  p_month text default null,
  p_week  text default null,
  p_owner text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with f as (
    select r.*, date(r.completed_at) as tx_date
    from order_rows r
    where (p_year  is null or r.year        = p_year)
      and (p_month is null or r.month       = p_month)
      and (p_week  is null or r.week        = p_week)
      and (p_owner is null or r.pic_client  = p_owner)
      and (p_store is null or r.store_name  = p_store)
  ),
  orders as (
    -- one row per distinct order — order-level numbers (counts, SLA, GMV)
    -- must never be computed against the line-item-level `f` directly
    select order_no, max(order_status) order_status, max(cancel_return_status) cancel_return_status,
           max(paid_at) paid_at, max(ship_deadline) ship_deadline, max(completed_at) completed_at,
           max(total_payment) total_payment, max(province) province, max(city) city,
           max(payment_method) payment_method, max(shipping_option) shipping_option,
           max(tx_date) tx_date
    from f
    where order_no is not null
    group by order_no
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'total_transaksi',   count(*),
        'total_produk',      coalesce((select sum(qty) from f), 0),
        'total_pembatalan',  count(*) filter (where order_status ilike '%batal%'),
        'total_return',      coalesce((select sum(returned_qty) from f), 0),
        'sla_pay_to_deadline_hours', (select avg(extract(epoch from (ship_deadline - paid_at)) / 3600)
                                        from orders where ship_deadline is not null and paid_at is not null),
        'sla_deadline_to_done_days', (select avg(extract(epoch from (completed_at - ship_deadline)) / 86400)
                                        from orders where completed_at is not null and ship_deadline is not null),
        'sla_pay_to_done_days',      (select avg(extract(epoch from (completed_at - paid_at)) / 86400)
                                        from orders where completed_at is not null and paid_at is not null)
      ) from orders
    ),
    'province_gmv', (select coalesce(jsonb_agg(x order by x.gmv desc),'[]') from (
        select province, sum(total_payment) gmv from orders
        where province is not null group by province) x),
    'city_gmv', (select coalesce(jsonb_agg(x order by x.gmv desc),'[]') from (
        select city, province, sum(total_payment) gmv from orders
        where city is not null group by city, province) x),
    'payment_method', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(payment_method,'Lainnya') method, count(*) cnt from orders
        group by payment_method) x),
    'sla_buckets', (select coalesce(jsonb_agg(x),'[]') from (
        select bucket, count(*) cnt from (
          select case
            when completed_at is null or paid_at is null then null
            when extract(epoch from (completed_at - paid_at)) / 86400 <= 3  then '0-3 hari'
            when extract(epoch from (completed_at - paid_at)) / 86400 <= 7  then '4-7 hari'
            when extract(epoch from (completed_at - paid_at)) / 86400 <= 14 then '7-14 hari'
            else '>14 hari'
          end as bucket
          from orders
        ) b where bucket is not null group by bucket) x),
    'cancel_status', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select cancel_return_status status, count(*) cnt from orders
        where cancel_return_status is not null group by cancel_return_status) x),
    'shipping_option', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(shipping_option,'Lainnya') option, count(*) cnt from orders
        group by shipping_option) x),
    'daily', (select coalesce(jsonb_agg(x order by x.tx_date),'[]') from (
        select tx_date, count(*) orders, sum(total_payment) gmv
        from orders where tx_date is not null group by tx_date) x)
  );
$$;

notify pgrst, 'reload config';
