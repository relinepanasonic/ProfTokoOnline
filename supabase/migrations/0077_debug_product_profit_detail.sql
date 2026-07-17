-- =====================================================================
-- 0077: TEMPORARY diagnostic function — product_profit_detail() is still
-- ~10s even though every underlying table scan it depends on is
-- individually fast (200-450ms) and product_costs is tiny (3 rows
-- total). Need the real query plan to find the actual bottleneck instead
-- of guessing further. Will be dropped in a follow-up migration once the
-- real fix lands.
-- =====================================================================

create or replace function debug_product_profit_detail_explain(
  p_year  int  default null,
  p_month text default null,
  p_week  text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns setof text
language plpgsql
as $$
begin
  return query execute
  'explain (analyze, buffers, format text)
   with base as (
      select
        id, upload_id, month,
        nullif(trim(raw->>''Kode Produk''), '''') as kode_produk,
        item_name as nama_produk,
        coalesce(nullif(trim(raw->>''__COL_D''), ''-''), nullif(trim(raw->>''Kode Variasi''), ''-'')) as kode_variasi,
        coalesce(nullif(trim(raw->>''__COL_E''), ''-''), nullif(trim(raw->>''Nama Variasi''), ''-'')) as nama_variasi_raw,
        is_parent, sales_idr, units
      from sales_rows
      where source = ''spos''
        and ($1 is null or year        = $1)
        and ($2 is null or month       = $2)
        and ($3 is null or week        = $3)
        and ($4 is null or pic_client  = $4)
        and ($5 is null or brand       = $5)
        and ($6 is null or store_name  = $6)
   ),
   flagged as (
      select *,
        bool_or(kode_variasi is not null) over (partition by kode_produk) as has_children
      from base
      where kode_produk is not null
   ),
   leaf as (
      select * from flagged
      where (has_children and kode_variasi is not null)
         or (not has_children and kode_variasi is null and is_parent)
   ),
   agg as (
      select
        kode_produk,
        coalesce(kode_variasi, ''-'') as kode_variasi,
        max(nama_produk) as nama_produk,
        max(nama_variasi_raw) as nama_variasi,
        coalesce(sum(sales_idr), 0) as total_sales,
        coalesce(sum(units), 0) as total_units
      from leaf
      group by kode_produk, coalesce(kode_variasi, ''-'')
   ),
   agg_costed as (
      select a.*, coalesce(a.total_units * pc.harga_modal, 0) as total_modal
      from agg a
      left join product_costs pc
        on pc.kode_produk = a.kode_produk and pc.kode_variasi = a.kode_variasi
   ),
   ads_by_product as (
      select kode_produk, coalesce(sum(ad_cost), 0) as ads_cost
      from sales_rows
      where source = ''ads'' and kode_produk is not null
        and ($1 is null or year        = $1)
        and ($2 is null or month       = $2)
        and ($3 is null or week        = $3)
        and ($4 is null or pic_client  = $4)
        and ($5 is null or brand       = $5)
        and ($6 is null or store_name  = $6)
      group by kode_produk
   ),
   ads_distributed as (
      select
        a.kode_produk, a.kode_variasi,
        coalesce(ap.ads_cost * (a.total_sales / nullif(sum(a.total_sales) over (partition by a.kode_produk), 0)), 0) as ads_cost
      from agg a
      left join ads_by_product ap on ap.kode_produk = a.kode_produk
   ),
   fin_totals as (
      select
        coalesce(abs(sum(promotion_cost)), 0)  as total_promotion,
        coalesce(abs(sum(refund)), 0)          as total_refund,
        coalesce(abs(sum(delivery_cost)), 0)   as total_delivery,
        coalesce(abs(sum(affiliate_cost)), 0)  as total_affiliate,
        coalesce(abs(sum(marketplace_fee)), 0) as total_marketplace_fee
      from finance_rows
      where ($1 is null or year        = $1)
        and ($2 is null or month       = $2)
        and ($3 is null or week        = $3)
        and ($4 is null or pic_client  = $4)
        and ($5 is null or brand       = $5)
        and ($6 is null or store_name  = $6)
   ),
   store_sales as (
      select coalesce(sum(total_sales), 0) as total from agg
   ),
   coeffs as (
      select
        case when s.total > 0 then f.total_promotion / s.total else 0 end       as coef_promotion,
        case when s.total > 0 then f.total_refund / s.total else 0 end         as coef_refund,
        case when s.total > 0 then f.total_delivery / s.total else 0 end       as coef_delivery,
        case when s.total > 0 then f.total_affiliate / s.total else 0 end      as coef_affiliate,
        case when s.total > 0 then f.total_marketplace_fee / s.total else 0 end as coef_marketplace_fee
      from fin_totals f, store_sales s
   ),
   agg_full as (
      select
        ac.*,
        coalesce(ad.ads_cost, 0) as ads_cost,
        ac.total_sales * c.coef_promotion       as promotion_cost,
        ac.total_sales * c.coef_refund          as refund,
        ac.total_sales * c.coef_delivery        as delivery_cost,
        ac.total_sales * c.coef_affiliate       as affiliate_cost,
        ac.total_sales * c.coef_marketplace_fee as marketplace_fee
      from agg_costed ac
      cross join coeffs c
      left join ads_distributed ad
        on ad.kode_produk = ac.kode_produk and ad.kode_variasi = ac.kode_variasi
   )
   select jsonb_build_object(
      ''rows'', (select coalesce(jsonb_agg(jsonb_build_object(
          ''kode_produk'', kode_produk, ''nama_produk'', nama_produk,
          ''kode_variasi'', kode_variasi, ''nama_variasi'', nama_variasi,
          ''units_sold'', total_units,
          ''total_sales'', total_sales, ''total_modal'', total_modal,
          ''promotion_cost'', promotion_cost, ''refund'', refund,
          ''delivery_cost'', delivery_cost, ''affiliate_cost'', affiliate_cost,
          ''marketplace_fee'', marketplace_fee, ''ads_cost'', ads_cost,
          ''nett_profit'', total_sales - (total_modal + promotion_cost + refund
            + delivery_cost + affiliate_cost + marketplace_fee + ads_cost)
        ) order by nama_produk, kode_produk, kode_variasi), ''[]'') from agg_full)
   )'
  using p_year, p_month, p_week, p_owner, p_brand, p_store;
end;
$$;

grant execute on function debug_product_profit_detail_explain(int, text, text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload config';
