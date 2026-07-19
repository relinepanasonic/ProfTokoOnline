-- =====================================================================
-- 0083: Fix Operational Performance "All Months" timeout.
--
-- store_perf_summary() had no client_id filter at all — it relied
-- entirely on RLS, and order_rows' only policy (order_rows_super_all)
-- grants superadmin unrestricted access across EVERY tenant. Any query
-- from this page was already scanning all clients' rows, not just the
-- current one.
--
-- With a specific Year+Month selected, the standalone partial indexes
-- (order_rows_year_only_idx / order_rows_month_only_idx) narrowed the
-- scan enough to stay fast. With "All Months" (p_year/p_month both
-- null), neither index applies — the query degrades to a full sequential
-- scan across every tenant's order_rows, filtered only by store_name
-- (no index on that column alone), then does the city_detail join/group
-- on top. That's enough to blow the statement timeout (57014) or
-- Vercel's function timeout (504).
--
-- Fix: add p_client_id, enforce it in the WHERE clause (stops
-- cross-tenant scanning entirely — also a real security tightening, not
-- just perf), and add a composite index leading with (client_id,
-- store_name, year, month) so an "All Months" query for one store can
-- seek directly instead of scanning.
-- =====================================================================

create index if not exists order_rows_client_store_ym_idx
  on order_rows (client_id, store_name, year, month);

create or replace function store_perf_summary(
  p_client_id uuid,
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
    where r.client_id = p_client_id
      and (p_year  is null or r.year        = p_year)
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
  ),
  -- line-item sums (qty / returned_qty) rolled up to each order's city —
  -- city/province are uniform across an order's lines, so this join is safe
  city_lines as (
    select o.province, o.city, sum(f.qty) qty, sum(f.returned_qty) returned_qty
    from f join orders o on o.order_no = f.order_no
    where o.city is not null
    group by o.province, o.city
  ),
  province_lines as (
    select o.province, sum(f.qty) qty
    from f join orders o on o.order_no = f.order_no
    where o.province is not null
    group by o.province
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
        select o.province, sum(o.total_payment) gmv, count(*) transactions,
               coalesce((select pl.qty from province_lines pl where pl.province = o.province), 0) product_sold
        from orders o
        where o.province is not null group by o.province) x),
    'city_detail', (select coalesce(jsonb_agg(x order by x.province, x.city),'[]') from (
        select o.city, o.province, sum(o.total_payment) gmv, count(*) transactions,
               coalesce((select cl.qty from city_lines cl where cl.city = o.city and cl.province = o.province), 0) product_sold,
               avg(extract(epoch from (o.completed_at - o.paid_at)) / 86400)
                 filter (where o.completed_at is not null and o.paid_at is not null) sla_days,
               count(*) filter (where o.order_status ilike '%batal%') cancellations,
               coalesce((select cl.returned_qty from city_lines cl where cl.city = o.city and cl.province = o.province), 0) returns
        from orders o
        where o.city is not null group by o.city, o.province) x),
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

-- store_perf_filters() has the same cross-tenant gap — scope it too.
create or replace function store_perf_filters(p_client_id uuid default null) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'years',  (select coalesce(jsonb_agg(distinct year order by year desc), '[]') from order_rows where year  is not null and (p_client_id is null or client_id = p_client_id)),
    'months', (select coalesce(jsonb_agg(distinct month), '[]')                  from order_rows where month is not null and (p_client_id is null or client_id = p_client_id))
  );
$$;

notify pgrst, 'reload config';
