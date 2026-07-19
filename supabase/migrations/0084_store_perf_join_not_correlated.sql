-- =====================================================================
-- 0084: Fix the remaining Operational Performance timeout.
--
-- 0083 scoped store_perf_summary() to client_id and added a supporting
-- index, but "All Months" for a store with a wide province/city spread
-- was still hitting 57014. Root cause: province_gmv and city_detail each
-- ran a CORRELATED SUBQUERY per output row —
--   coalesce((select cl.qty from city_lines cl where cl.city = o.city
--             and cl.province = o.province), 0)
-- — re-scanning city_lines/province_lines from scratch for every distinct
-- city/province in the result. That's O(cities × city_lines rows) instead
-- of a single join, and blows up fast once a store has many distinct
-- cities across a full order history.
--
-- Fix: aggregate `orders` grouped by city/province first (each group
-- computed once), then LEFT JOIN the already-aggregated city_lines /
-- province_lines sets — one hash join instead of N re-scans.
-- =====================================================================

-- 0083 added p_client_id as a new leading parameter — Postgres resolves
-- functions by name + argument types, so that created a SECOND overload
-- rather than replacing the original 5-arg one. Drop the orphaned old
-- signature so only the client-scoped version can ever be called.
drop function if exists store_perf_summary(int, text, text, text, text);

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
  ),
  province_orders as (
    select province, sum(total_payment) gmv, count(*) transactions
    from orders where province is not null group by province
  ),
  city_orders as (
    select city, province, sum(total_payment) gmv, count(*) transactions,
           avg(extract(epoch from (completed_at - paid_at)) / 86400)
             filter (where completed_at is not null and paid_at is not null) sla_days,
           count(*) filter (where order_status ilike '%batal%') cancellations
    from orders where city is not null group by city, province
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
        select po.province, po.gmv, po.transactions, coalesce(pl.qty, 0) product_sold
        from province_orders po
        left join province_lines pl on pl.province = po.province
    ) x),
    'city_detail', (select coalesce(jsonb_agg(x order by x.province, x.city),'[]') from (
        select co.city, co.province, co.gmv, co.transactions,
               coalesce(cl.qty, 0) product_sold, co.sla_days, co.cancellations,
               coalesce(cl.returned_qty, 0) returns
        from city_orders co
        left join city_lines cl on cl.city = co.city and cl.province = co.province
    ) x),
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
