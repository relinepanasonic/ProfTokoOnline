-- =====================================================================
-- 0132: Detail Product Profit units — two refinements to 0131.
--
-- 1. Finance is the base and the join is by ORDER NUMBER only, in any month:
--    a February finance line whose order was created in January finds its
--    units in the JANUARY Order Completed upload (and a late upload fills
--    units in automatically, nothing to re-upload on the finance side).
--
-- 2. 'missing' tells the page WHICH Order Completed months are needed. A
--    Shopee order number starts with its creation date (YYMMDD, e.g.
--    260120GW3XRPFU = 20 Jan 2026), so finance lines with no units are
--    grouped by that YYMM -> "upload Order Completed for Januari 2026".
--
-- 3. If the same order sits in more than one Order Completed upload (a month
--    uploaded twice, overlapping exports), only its most recent upload is
--    counted, so units are never doubled.
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
      case when p.order_no ~ '^[0-9]{4}' then left(p.order_no, 4) else 'other' end as ym,
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

notify pgrst, 'reload config';
