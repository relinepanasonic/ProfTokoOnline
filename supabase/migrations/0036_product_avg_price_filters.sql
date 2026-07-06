-- =====================================================================
-- 0036: Modal Product page — add Owner / Store filter to product_avg_price()
--
-- The AVG Harga Jual reference stays unfiltered by time (still a global,
-- all-history average per [[spos-parent-row-rule]]-style leaf grouping),
-- but is now scoped by Owner/Store like the rest of the app, since the same
-- product can sell at a different average price per store.
-- =====================================================================

drop function if exists product_avg_price();

create or replace function product_avg_price(
  p_owner text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with base as (
    select
      id, upload_id,
      nullif(trim(raw->>'Kode Produk'), '') as kode_produk,
      item_name as nama_produk,
      nullif(nullif(trim(raw->>'Kode Variasi'), '-'), '') as kode_variasi,
      nullif(trim(raw->>'Nama Variasi'), '-') as nama_variasi_raw,
      is_parent, sales_idr, units
    from sales_rows
    where source = 'spos'
      and (p_owner is null or pic_client = p_owner)
      and (p_store is null or store_name = p_store)
  ),
  flagged as (
    select *,
      bool_or(kode_variasi is not null) over (partition by upload_id, kode_produk) as has_children
    from base
  ),
  leaf as (
    select * from flagged
    where kode_produk is not null
      and ((has_children and kode_variasi is not null)
        or (not has_children and kode_variasi is null and is_parent))
  )
  select coalesce(jsonb_agg(x), '[]') from (
    select
      kode_produk,
      coalesce(kode_variasi, '-') as kode_variasi,
      max(nama_produk) as nama_produk,
      max(nama_variasi_raw) as nama_variasi,
      coalesce(sum(sales_idr), 0) as total_sales,
      coalesce(sum(units), 0) as total_units,
      case when sum(units) > 0 then sum(sales_idr) / sum(units) else null end as avg_price
    from leaf
    group by kode_produk, coalesce(kode_variasi, '-')
    order by max(nama_produk), coalesce(kode_variasi, '-')
  ) x;
$$;

notify pgrst, 'reload config';
