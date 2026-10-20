-- =====================================================================
-- 0137: make refresh_product_catalog_for_upload() independent of history size.
--
-- Every SPOS upload runs refresh_product_catalog_for_upload() (0107). It joins the products of the
-- new file against ALL of the client's SPOS rows on
--     nullif(trim(raw->>'Kode Produk'), '')
-- which has no index, so Postgres reads and parses the `raw` jsonb (~3.6 KB/row, TOASTed) of every
-- SPOS row the client ever uploaded — 33 s for a 1,470-row file today, and slower every week as
-- more stores / weeks are added. That is what pushed /api/upload past Vercel's 60 s limit.
--
-- This partial expression index matches that expression exactly, so the join becomes a lookup of
-- only the touched products. No function change is needed.
--
-- Run it when nobody is uploading: building it reads every SPOS row once (about as long as ONE
-- refresh, possibly a minute or two) and blocks writes to sales_rows until it finishes.
-- =====================================================================

set statement_timeout = 0;

create index if not exists sales_rows_spos_kode_produk_idx
  on sales_rows (client_id, (nullif(trim(raw->>'Kode Produk'), '')))
  where source = 'spos';

analyze sales_rows;

reset statement_timeout;
notify pgrst, 'reload config';
