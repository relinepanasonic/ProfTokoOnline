-- =====================================================================
-- 0086: Fix the Operational Performance CTE materialization barrier.
--
-- Even after 0085 dropped `raw`, store_perf_summary() still referenced the
-- base CTE `f` 5 times (orders, the two qty/returned_qty KPI sums,
-- city_lines, province_lines). A CTE referenced more than once is
-- MATERIALIZED into a temp table with no indexes, so those 5 references
-- became 5 unindexed sequential scans + hash aggregations over the whole
-- filtered set — guaranteeing the 57014 timeout on "All Months".
--
-- Naively adding `NOT MATERIALIZED` would only trade that for re-running
-- the base scan 5 times. The real fix is to make the base table get
-- scanned ONCE, by folding the line-item sums into the order-level dedup:
--
--   * qty / returned_qty are line-level, but every line of an order shares
--     the same order_no / province / city / status. So SUM(qty) and
--     SUM(returned_qty) are computed INSIDE the `orders` GROUP BY order_no
--     (as order_qty / order_returned_qty) — no need to re-join `f`.
--   * That eliminates city_lines, province_lines, and both KPI-sum
--     subqueries. `f` is now referenced exactly once (inside orders) →
--     inlined, base-table index pushed down.
--   * province/city "product sold" become SUM(order_qty) GROUP BY dim,
--     read straight from the small `orders` set.
--   * Top-level KPIs collapse into a SINGLE pass over `orders` with FILTER.
--
-- `orders` (one row per order — small) is the only multiply-referenced
-- CTE now; materializing it once and scanning it per dimensional GROUP BY
-- is cheap. Every jsonb_agg still wraps an already-grouped tiny result.
--
-- Semantics preserved vs 0085, with one intentional tightening:
-- total_produk / total_return now sum only over rows with a non-null
-- order_no (matched to total_transaksi's own `where order_no is not null`
-- dedup) instead of over every base row — a completed-orders export
-- should have no null-order_no rows, so displayed numbers are unchanged.
-- =====================================================================

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
  with orders as (
    -- One row per distinct order. Line-item sums (qty / returned_qty) are
    -- folded in here so the base table (`f` subquery) is scanned ONCE and
    -- nothing downstream needs to re-join it.
    select
      order_no,
      max(order_status)          order_status,
      max(cancel_return_status)  cancel_return_status,
      max(paid_at)               paid_at,
      max(ship_deadline)         ship_deadline,
      max(completed_at)          completed_at,
      max(total_payment)         total_payment,   -- order-level (repeated per line) → max de-dups
      max(province)              province,
      max(city)                  city,
      max(payment_method)        payment_method,
      max(shipping_option)       shipping_option,
      max(tx_date)               tx_date,
      sum(qty)                   order_qty,           -- line-level → summed within the order
      sum(returned_qty)          order_returned_qty
    from (
      -- explicit projection — never `raw jsonb`; index-friendly single scan
      select r.order_no, r.order_status, r.cancel_return_status,
             r.paid_at, r.ship_deadline, r.completed_at,
             r.total_payment, r.province, r.city,
             r.payment_method, r.shipping_option,
             r.qty, r.returned_qty,
             date(r.completed_at) as tx_date
      from order_rows r
      where r.client_id = p_client_id
        and (p_year  is null or r.year        = p_year)
        and (p_month is null or r.month       = p_month)
        and (p_week  is null or r.week        = p_week)
        and (p_owner is null or r.pic_client  = p_owner)
        and (p_store is null or r.store_name  = p_store)
    ) f
    where order_no is not null
    group by order_no
  )
  select jsonb_build_object(
    -- single pass over `orders` for every scalar KPI
    'kpis', (
      select jsonb_build_object(
        'total_transaksi',   count(*),
        'total_produk',      coalesce(sum(order_qty), 0),
        'total_pembatalan',  count(*) filter (where order_status ilike '%batal%'),
        'total_return',      coalesce(sum(order_returned_qty), 0),
        'sla_pay_to_deadline_hours', avg(extract(epoch from (ship_deadline - paid_at)) / 3600)
                                       filter (where ship_deadline is not null and paid_at is not null),
        'sla_deadline_to_done_days', avg(extract(epoch from (completed_at - ship_deadline)) / 86400)
                                       filter (where completed_at is not null and ship_deadline is not null),
        'sla_pay_to_done_days',      avg(extract(epoch from (completed_at - paid_at)) / 86400)
                                       filter (where completed_at is not null and paid_at is not null)
      ) from orders
    ),
    'province_gmv', (select coalesce(jsonb_agg(x order by x.gmv desc),'[]') from (
        select province, sum(total_payment) gmv, count(*) transactions, sum(order_qty) product_sold
        from orders where province is not null group by province) x),
    'city_detail', (select coalesce(jsonb_agg(x order by x.province, x.city),'[]') from (
        select city, province, sum(total_payment) gmv, count(*) transactions,
               sum(order_qty) product_sold,
               avg(extract(epoch from (completed_at - paid_at)) / 86400)
                 filter (where completed_at is not null and paid_at is not null) sla_days,
               count(*) filter (where order_status ilike '%batal%') cancellations,
               sum(order_returned_qty) returns
        from orders where city is not null group by city, province) x),
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
