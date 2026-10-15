-- =====================================================================
-- 0135: "Not Paid Order" — orders that are COMPLETED (Order Completed /
-- Order Selesai) but whose earning is not in Earning yet.
--
-- Earning (finance_rows) is the core. An order is "not paid" when its order
-- number (No. Pesanan) is in an Order Completed upload and in NO finance
-- upload, of any month. The moment its earning is uploaded it drops off.
--
-- What is deliberately ignored, because we cannot tell "not paid" from "not
-- uploaded" there:
--   * orders created BEFORE the earliest earning uploaded for the store
--     (e.g. December when Earning starts in January), and
--   * orders created AFTER the last earning uploaded for the store.
-- So only orders created inside the period the Earning uploads cover count.
--
-- p_year / p_month / p_week / p_owner / p_brand / p_store filter the ORDER
-- COMPLETED side (its upload dimensions = the month the order was created);
-- the coverage window always comes from the store's whole Earning data.
-- If the same order sits in several Order Completed uploads only the newest
-- upload is used. Returns at most 5000 rows, oldest completion first.
-- =====================================================================

create or replace function finance_not_paid_orders(
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
  with coverage as (
    select client_id, store_name, min(release_date) as first_rel, max(release_date) as last_rel
    from finance_rows
    where release_date is not null and (p_store is null or store_name = p_store)
    group by client_id, store_name
  ),
  ord_src as (
    select o.*,
           o.upload_id is not distinct from
             first_value(o.upload_id) over (partition by o.client_id, o.order_no order by o.created_at desc) as is_latest
    from order_rows o
    where (p_year  is null or o.year        = p_year)
      and (p_month is null or o.month       = p_month)
      and (p_week  is null or o.week        = p_week)
      and (p_owner is null or o.pic_client  = p_owner)
      and (p_brand is null or o.brand       = p_brand)
      and (p_store is null or o.store_name  = p_store)
  ),
  ord as (
    select
      client_id, store_name, order_no,
      min(order_created_at)  as created_at,
      max(completed_at)      as completed_at,
      max(payment_method)    as payment_method,
      max(total_payment)     as total_payment,
      max(cancel_return_status) as cancel_return,
      sum(coalesce(qty, 0) - coalesce(returned_qty, 0)) as units,
      string_agg(distinct product_name, ' · ' order by product_name) as products
    from ord_src
    where is_latest
    group by client_id, store_name, order_no
  ),
  scoped as (
    select o.*, c.first_rel, c.last_rel
    from ord o
    join coverage c on c.client_id = o.client_id and c.store_name is not distinct from o.store_name
    where o.created_at is not null
      and o.created_at::date between c.first_rel and c.last_rel
  ),
  unpaid as (
    select s.* from scoped s
    where not exists (select 1 from finance_rows f where f.client_id = s.client_id and f.order_no = s.order_no)
  )
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'order_no', order_no, 'created_at', created_at::date, 'completed_at', completed_at::date,
        'days_waiting', case when completed_at is null then null else (current_date - completed_at::date) end,
        'payment_method', payment_method, 'order_value', total_payment, 'units', units,
        'return_status', cancel_return, 'products', products
      ) order by completed_at nulls last, order_no), '[]'::jsonb)
      from (select * from unpaid order by completed_at nulls last, order_no limit 5000) u),
    'not_paid_orders', (select count(*) from unpaid),
    'not_paid_value',  (select coalesce(sum(total_payment), 0) from unpaid),
    'orders_checked',  (select count(*) from scoped),
    'window_from',     (select min(first_rel) from coverage),
    'window_to',       (select max(last_rel) from coverage)
  );
$$;

notify pgrst, 'reload config';
