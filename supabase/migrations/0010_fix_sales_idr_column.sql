-- 0010_fix_sales_idr_column.sql
-- The upload pipeline was reading "Total Penjualan (Pesanan Dibuat) (IDR)"
-- instead of "Penjualan (Pesanan Siap Dikirim) (IDR)" — the "Siap Dikirim"
-- (Ready to Ship) column that the GAS dashboard uses for GMV.
-- Since `raw` JSONB is stored on every row, we can re-derive the correct value
-- without re-uploading any files.
--
-- IDR values are whole-rupiah numbers. We strip dots, commas, Rp, and spaces
-- (handles both Indonesian "48.605.000" and plain "48605000" formats), then cast.

UPDATE sales_rows
SET sales_idr = NULLIF(
  regexp_replace(
    COALESCE(raw->>'Penjualan (Pesanan Siap Dikirim) (IDR)', ''),
    '[^0-9]', '', 'g'   -- keep digits only (safe for whole-rupiah values)
  ),
  ''
)::numeric
WHERE source IN ('spos', 'perf')
  AND raw ? 'Penjualan (Pesanan Siap Dikirim) (IDR)'
  AND COALESCE(raw->>'Penjualan (Pesanan Siap Dikirim) (IDR)', '') NOT IN ('', '-');
