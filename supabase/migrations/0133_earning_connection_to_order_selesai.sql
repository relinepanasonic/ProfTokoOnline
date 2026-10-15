-- =====================================================================
-- 0133: Earning <-> Order Selesai (Order Completed) connection.
--
-- Finance (Earning) is the base. An earning is "connected" when its order
-- number (No. Pesanan) exists in an Order Completed upload, whichever month
-- that upload is for.
--
-- 1. finance_product_profit(): the 'missing' months are now grouped by the
--    REAL order-created date from the finance file (Waktu Pesanan Dibuat),
--    not the date inside the order number — Shopee's order-number date is
--    off by one day for ~2.7% of orders (260101... was created 31 Dec), which
--    named the wrong month near month boundaries. Order-number prefix is only
--    the fallback when the created date is empty.
--
-- 2. finance_unconnected_orders(): the list of earnings with no Order
--    Selesai row, each with a reason:
--      month_missing  - no Order Completed is uploaded for the month the order
--                       was created (upload that month and it connects)
--      not_in_file    - that month IS uploaded but the order is not in it
--                       (e.g. cancelled / returned / never reached "Selesai")
--      unknown        - the finance file has no created date for the order
-- =====================================================================

create or replace function finance_product_profit(
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
  with lines as (
    select s.*
    from finance_sku_rows s
    where (p_year  is null or s.year        = p_year)
      and (p_month is null or s.month       = p_month)
      and (p_week  is null or s.week        = p_week)
      and (p_owner is null or s.pic_client  = p_owner)
      and (p_brand is null or s.brand       = p_brand)
      and (p_store is null or s.store_name  = p_store)
  ),
  by_product as (
    select
      kode_produk,
      max(nama_produk)                   as nama_produk,
      count(distinct order_no)           as orders,
      coalesce(sum(sales), 0)            as sales,
      coalesce(-sum(promotion_cost), 0)  as promotion_cost,
      coalesce(-sum(refund), 0)          as refund,
      coalesce(-sum(delivery_cost), 0)   as delivery_cost,
      coalesce(-sum(affiliate_cost), 0)  as affiliate_cost,
      coalesce(-sum(marketplace_fee), 0) as marketplace_fee,
      coalesce(-sum(pajak), 0)           as pajak,
      coalesce(-sum(misc), 0)            as other,
      coalesce(sum(net_income), 0)       as net_income
    from lines
    group by kode_produk
  ),
  -- one row per (product, order, product name); an order+name's sales share
  -- among the product IDs that carry that name (normally exactly 1.0)
  pairs as (
    select
      kode_produk, client_id, order_no,
      lower(btrim(nama_produk)) as pname,
      min(order_date)           as order_date,
      sum(sales) as sales,
      case when sum(sum(sales)) over w <> 0 then sum(sales) / sum(sum(sales)) over w
           else 1.0 / count(*) over w end as share
    from lines
    group by kode_produk, client_id, order_no, lower(btrim(nama_produk))
    window w as (partition by client_id, order_no, lower(btrim(nama_produk)))
  ),
  -- Order Completed lines for the orders we need, newest upload only per order
  ord_src as (
    select o.client_id, o.order_no, o.product_name, o.qty, o.returned_qty,
           o.upload_id is not distinct from
             first_value(o.upload_id) over (partition by o.client_id, o.order_no order by o.created_at desc) as is_latest
    from order_rows o
    where exists (select 1 from pairs p where p.client_id = o.client_id and p.order_no = o.order_no)
  ),
  ord_units as (
    select client_id, order_no, lower(btrim(product_name)) as pname,
           sum(coalesce(qty, 0) - coalesce(returned_qty, 0)) as units
    from ord_src
    where is_latest
    group by client_id, order_no, lower(btrim(product_name))
  ),
  units_by_product as (
    select
      p.kode_produk,
      sum(u.units * p.share) as units,
      count(*)               as units_orders,
      sum(p.sales)           as sales_with_units
    from pairs p
    join ord_units u on u.client_id = p.client_id and u.order_no = p.order_no and u.pname = p.pname
    group by p.kode_produk
  ),
  -- finance lines with no Order Completed match, grouped by the month the order was CREATED
  missing as (
    select
      coalesce(to_char(p.order_date, 'YYMM'),
               case when p.order_no ~ '^[0-9]{4}' then left(p.order_no, 4) else 'other' end) as ym,
      count(distinct p.order_no) as orders,
      sum(p.sales)               as sales
    from pairs p
    where not exists (
      select 1 from ord_units u
      where u.client_id = p.client_id and u.order_no = p.order_no and u.pname = p.pname
    )
    group by 1
  ),
  coverage as (
    select
      count(distinct f.order_no) as orders_total,
      count(distinct f.order_no) filter (where exists (
        select 1 from finance_sku_rows s where s.client_id = f.client_id and s.order_no = f.order_no
      )) as orders_with_detail
    from finance_rows f
    where (p_year  is null or f.year        = p_year)
      and (p_month is null or f.month       = p_month)
      and (p_week  is null or f.week        = p_week)
      and (p_owner is null or f.pic_client  = p_owner)
      and (p_brand is null or f.brand       = p_brand)
      and (p_store is null or f.store_name  = p_store)
  )
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'kode_produk', b.kode_produk, 'nama_produk', b.nama_produk, 'orders', b.orders,
        'sales', b.sales, 'promotion_cost', b.promotion_cost, 'refund', b.refund,
        'delivery_cost', b.delivery_cost, 'affiliate_cost', b.affiliate_cost,
        'marketplace_fee', b.marketplace_fee, 'pajak', b.pajak, 'other', b.other,
        'net_income', b.net_income,
        'units', u.units,                                -- null = no Order Completed data for this product
        'units_orders', coalesce(u.units_orders, 0),
        'sales_with_units', coalesce(u.sales_with_units, 0)
      ) order by b.sales desc, b.kode_produk), '[]'::jsonb)
      from by_product b left join units_by_product u on u.kode_produk = b.kode_produk),
    'missing', (select coalesce(jsonb_agg(jsonb_build_object('ym', ym, 'orders', orders, 'sales', sales) order by ym), '[]'::jsonb) from missing),
    'orders_total', (select orders_total from coverage),
    'orders_with_detail', (select orders_with_detail from coverage)
  );
$$;

-- ── Earnings that are NOT connected to an Order Selesai row ──────────────────
create or replace function finance_unconnected_orders(
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
  with f as (
    select r.client_id, r.store_name, r.order_no, r.order_date, r.release_date, r.sales, r.net_income
    from finance_rows r
    where (p_year  is null or r.year        = p_year)
      and (p_month is null or r.month       = p_month)
      and (p_week  is null or r.week        = p_week)
      and (p_owner is null or r.pic_client  = p_owner)
      and (p_brand is null or r.brand       = p_brand)
      and (p_store is null or r.store_name  = p_store)
  ),
  linked as (
    select distinct o.client_id, o.order_no
    from order_rows o
    where exists (select 1 from f where f.client_id = o.client_id and f.order_no = o.order_no)
  ),
  open_orders as (
    select f.* from f
    where not exists (select 1 from linked l where l.client_id = f.client_id and l.order_no = f.order_no)
  ),
  -- months (by order-created date) for which ANY Order Completed is uploaded
  uploaded_months as (
    select distinct o.client_id, o.store_name, date_trunc('month', o.order_created_at)::date as m
    from order_rows o
    where o.order_created_at is not null and (p_store is null or o.store_name = p_store)
  ),
  detail as (
    select
      f.order_no, f.order_date, f.release_date, f.sales, f.net_income,
      (select string_agg(distinct s.nama_produk, ' · ' order by s.nama_produk)
         from finance_sku_rows s where s.client_id = f.client_id and s.order_no = f.order_no) as products,
      case
        when f.order_date is null then 'unknown'
        when exists (select 1 from uploaded_months u
                     where u.client_id = f.client_id and u.store_name is not distinct from f.store_name
                       and u.m = date_trunc('month', f.order_date)::date) then 'not_in_file'
        else 'month_missing'
      end as reason
    from open_orders f
  )
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'order_no', order_no, 'order_date', order_date, 'release_date', release_date,
        'products', products, 'sales', sales, 'net_income', net_income, 'reason', reason
      ) order by order_date nulls last, order_no), '[]'::jsonb)
      from (select * from detail order by order_date nulls last, order_no limit 5000) d),
    'orders_total',       (select count(distinct order_no) from f),
    'orders_connected',   (select count(*) from linked),
    'unconnected_orders', (select count(*) from open_orders),
    'unconnected_net',    (select coalesce(sum(net_income), 0) from open_orders),
    'by_reason', (select coalesce(jsonb_object_agg(reason, jsonb_build_object('orders', n, 'net', net)), '{}'::jsonb)
                  from (select reason, count(*) as n, coalesce(sum(net_income), 0) as net from detail group by reason) g)
  );
$$;

notify pgrst, 'reload config';
