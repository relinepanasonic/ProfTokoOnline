-- =====================================================================
-- 0130: Finance page "Detail Product Profit" strictly from the finance
-- upload (Shopee "Penghasilan" report). One row per Shopee product ID,
-- everything straight from finance_sku_rows — no SPOS / Product
-- Performance, no Modal, no Ads (those are not in the income report).
--
-- Costs are returned as positive amounts (cost = -sum), signed so that
--   net_income = sales - promotion - refund - delivery - affiliate
--                - marketplace_fee - pajak - other
-- holds EXACTLY for every row (delivery can be negative = net subsidy).
-- Also returns how many orders have product detail, because uploads in the
-- older Income layout have no per-product lines.
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
    select
      s.kode_produk,
      max(s.nama_produk)                  as nama_produk,
      count(distinct s.order_no)          as orders,
      coalesce(sum(s.sales), 0)           as sales,
      coalesce(-sum(s.promotion_cost), 0) as promotion_cost,
      coalesce(-sum(s.refund), 0)         as refund,
      coalesce(-sum(s.delivery_cost), 0)  as delivery_cost,
      coalesce(-sum(s.affiliate_cost), 0) as affiliate_cost,
      coalesce(-sum(s.marketplace_fee), 0) as marketplace_fee,
      coalesce(-sum(s.pajak), 0)          as pajak,
      coalesce(-sum(s.misc), 0)           as other,
      coalesce(sum(s.net_income), 0)      as net_income
    from finance_sku_rows s
    where (p_year  is null or s.year        = p_year)
      and (p_month is null or s.month       = p_month)
      and (p_week  is null or s.week        = p_week)
      and (p_owner is null or s.pic_client  = p_owner)
      and (p_brand is null or s.brand       = p_brand)
      and (p_store is null or s.store_name  = p_store)
    group by s.kode_produk
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
        'kode_produk', kode_produk, 'nama_produk', nama_produk, 'orders', orders,
        'sales', sales, 'promotion_cost', promotion_cost, 'refund', refund,
        'delivery_cost', delivery_cost, 'affiliate_cost', affiliate_cost,
        'marketplace_fee', marketplace_fee, 'pajak', pajak, 'other', other,
        'net_income', net_income
      ) order by sales desc, kode_produk), '[]'::jsonb) from lines),
    'orders_total', (select orders_total from coverage),
    'orders_with_detail', (select orders_with_detail from coverage)
  );
$$;

notify pgrst, 'reload config';
