-- =====================================================================
-- 0131: Units sold in the Finance page's Detail Product Profit, from the
-- Order Completed upload (order_rows) — no SPOS / Product Performance.
--
-- The income report has no quantity, but Order Completed has it per order
-- line (qty, returned_qty). The two are joined on ORDER NUMBER + PRODUCT
-- NAME (Order Completed has no product ID). Tested on Feb 2026: every
-- finance line whose order is in the Order Completed file matched by name.
--
--   units = sum(qty - returned_qty) for the (order, product name) pairs found
--
-- Notes
--  * An income report lists one line per variant (same product ID and name);
--    Order Completed's lines for that order+name are summed once, so units
--    are never double counted.
--  * If two different product IDs share a name inside one order, that
--    order+name's units are split by their share of Sales.
--  * Orders created in an earlier month than the Order Completed file(s) you
--    uploaded have no units; sales_with_units says how much of a product's
--    Sales has units, so partial coverage is visible (NULL units = none).
-- =====================================================================

create index if not exists order_rows_client_order_idx on order_rows (client_id, order_no);

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
      sum(sales) as sales,
      case when sum(sum(sales)) over w <> 0 then sum(sales) / sum(sum(sales)) over w
           else 1.0 / count(*) over w end as share
    from lines
    group by kode_produk, client_id, order_no, lower(btrim(nama_produk))
    window w as (partition by client_id, order_no, lower(btrim(nama_produk)))
  ),
  ord_units as (
    select o.client_id, o.order_no, lower(btrim(o.product_name)) as pname,
           sum(coalesce(o.qty, 0) - coalesce(o.returned_qty, 0)) as units
    from order_rows o
    where exists (select 1 from pairs p where p.client_id = o.client_id and p.order_no = o.order_no)
    group by o.client_id, o.order_no, lower(btrim(o.product_name))
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
    'orders_total', (select orders_total from coverage),
    'orders_with_detail', (select orders_with_detail from coverage)
  );
$$;

notify pgrst, 'reload config';
