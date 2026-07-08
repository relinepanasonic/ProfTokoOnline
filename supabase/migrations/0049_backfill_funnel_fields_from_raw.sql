-- =====================================================================
-- 0049: Backfill the funnel/transaction typed columns from raw jsonb.
--
-- The four funnel fields were added as columns in later migrations, so
-- every SPOS row uploaded before each field existed has them null:
--   orders_created    NULL on all 104,354 spos rows (added most recently)
--   product_views     NULL on ~94,499
--   orders_ready      NULL on ~94,499
--   visitor_cart_adds NULL on ~90,408
-- BUT the underlying values were captured in raw jsonb at upload time all
-- along (this project stores full raw, unlike the older Reline export).
-- So instead of waiting for every store to re-upload, backfill straight
-- from raw — the dashboard then shows complete history immediately.
--
-- Verified before writing: the source keys are present on 99.9% of spos
-- rows (the 0.1% missing are the malformed English-report uploads that
-- have null sales anyway), and every value is a plain integer count or
-- "-" (no commas, no dots) across a 4,000-value scan — so stripping
-- non-digits then casting reproduces parse.ts's toNum() exactly for these
-- count columns.
--
-- COALESCE(existing, ...) preserves any value already parsed at upload
-- time, so this is safe to re-run and never overwrites good data.
--
-- NOTE: run in the SQL editor (as postgres) — updating ~100k rows exceeds
-- the 20s role statement_timeout. Consider VACUUM (ANALYZE) sales_rows;
-- afterwards to clear the dead tuples this rewrite leaves.
-- =====================================================================

update sales_rows set
  product_views     = coalesce(product_views,
    nullif(regexp_replace(raw->>'Jumlah Produk Dilihat', '[^0-9]', '', 'g'), '')::numeric),
  orders_ready      = coalesce(orders_ready,
    nullif(regexp_replace(raw->>'Pesanan Siap Dikirim', '[^0-9]', '', 'g'), '')::numeric),
  orders_created    = coalesce(orders_created,
    nullif(regexp_replace(raw->>'Total Pembeli (Pesanan Dibuat)', '[^0-9]', '', 'g'), '')::numeric),
  visitor_cart_adds = coalesce(visitor_cart_adds,
    nullif(regexp_replace(raw->>'Pengunjung Produk (Menambahkan Produk ke Keranjang)', '[^0-9]', '', 'g'), '')::numeric)
where source = 'spos'
  and (product_views is null or orders_ready is null
       or orders_created is null or visitor_cart_adds is null);
