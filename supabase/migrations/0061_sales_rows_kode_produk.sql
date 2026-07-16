-- =====================================================================
-- 0061: sales_rows.kode_produk — the Total Ads export (source='ads') can
-- carry real per-product rows (individual non-grouped product ads sit
-- alongside campaign/group rows in the same file, each with a real
-- "Kode Produk"), which the new Ads Performance product table needs to
-- join into the same unified list as ad_groups' product rows. Historical
-- rows are backfilled from the already-saved raw jsonb — no re-upload
-- needed, same technique as the earlier ad_type backfill (migration 0057).
-- =====================================================================

alter table sales_rows add column if not exists kode_produk text;

update sales_rows
  set kode_produk = nullif(trim(coalesce(raw->>'Kode Produk', raw->>'__COL_E')), '')
  where source = 'ads' and kode_produk is null;

create index if not exists sales_rows_kode_produk_idx
  on sales_rows (client_id, kode_produk) where kode_produk is not null;

notify pgrst, 'reload config';
