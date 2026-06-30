-- 0013_fix_spos_is_parent.sql
-- Root cause of SPOS double-counting:
--   is_parent column defaults to TRUE, so all SPOS rows (parent + variant) were
--   counted. Variant rows should be FALSE — they have no visitors data (the column
--   is empty, "-", or null in the Shopee export).
--
-- Fix: re-derive is_parent from the stored raw JSONB for every SPOS row.
-- A row is a parent if "Pengunjung Produk (Kunjungan)" in raw is a non-empty,
-- non-"-" numeric string — exactly the same logic as parse.ts toNum().

UPDATE sales_rows
SET is_parent = (
  COALESCE(
    regexp_replace(
      NULLIF(NULLIF(TRIM(
        COALESCE(
          raw->>'Pengunjung Produk (Kunjungan)',
          raw->>'Pengunjung_Produk__Kunjungan_'   -- bqCol-sanitised fallback
        )
      ), ''), '-'),
      '[^0-9.,]', '', 'g'
    ),
    ''
  ) <> ''
)
WHERE source = 'spos';

-- Verify: after running this, the ratio of parent rows should be well below 100%.
-- SELECT is_parent, COUNT(*) FROM sales_rows WHERE source='spos' GROUP BY is_parent;
