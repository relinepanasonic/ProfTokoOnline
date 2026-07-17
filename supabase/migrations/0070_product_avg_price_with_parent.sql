-- =====================================================================
-- 0070: Modal Product rebuild — product_avg_price() now also returns the
-- parent (rollup) row for products that have variants, flagged `locked`,
-- alongside the variant leaf rows it already returned. Previously the
-- parent was excluded entirely whenever children existed (the [[spos-
-- parent-row-rule]] leaf-only rule, correct for SUM totals but wrong for
-- this page's UX) — the user wants to still SEE that a product has
-- variants, with its Harga Modal Product cell locked (cost must be entered
-- per variant, not on the aggregate), while single-variant ("-") products
-- keep one plain editable row as before.
-- =====================================================================

drop function if exists product_avg_price(text, text);

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
  -- Editable rows: variant leaves when the product has variants, else the
  -- single parent row itself — unchanged from before.
  leaf as (
    select * from flagged
    where kode_produk is not null
      and ((has_children and kode_variasi is not null)
        or (not has_children and kode_variasi is null and is_parent))
  ),
  leaf_agg as (
    select
      kode_produk,
      coalesce(kode_variasi, '-') as kode_variasi,
      max(nama_produk) as nama_produk,
      max(nama_variasi_raw) as nama_variasi,
      coalesce(sum(sales_idr), 0) as total_sales,
      coalesce(sum(units), 0) as total_units,
      case when sum(units) > 0 then sum(sales_idr) / sum(units) else null end as avg_price,
      false as locked
    from leaf
    group by kode_produk, coalesce(kode_variasi, '-')
  ),
  -- New: a locked rollup row per product that DOES have variants, from its
  -- own parent (is_parent=true) rows — shown for context, not editable.
  parent_rows as (
    select
      kode_produk,
      '-'::text as kode_variasi,
      max(nama_produk) as nama_produk,
      null::text as nama_variasi,
      coalesce(sum(sales_idr) filter (where is_parent), 0) as total_sales,
      coalesce(sum(units) filter (where is_parent), 0) as total_units,
      case when sum(units) filter (where is_parent) > 0
        then sum(sales_idr) filter (where is_parent) / sum(units) filter (where is_parent)
        else null end as avg_price,
      true as locked
    from flagged
    where kode_produk is not null and has_children
    group by kode_produk
  )
  select coalesce(jsonb_agg(x order by x.nama_produk, x.kode_produk, x.locked desc, x.kode_variasi), '[]') from (
    select * from leaf_agg
    union all
    select * from parent_rows
  ) x;
$$;

notify pgrst, 'reload config';
