-- =====================================================================
-- 0066: sales_rows.kode_produk still holds literal "-" for group/campaign
-- rows — migration 0061's backfill only stripped empty string
-- (nullif(..., '')), not the dash Shopee uses for "no product code"
-- (matches what parseAdGroup.ts already normalizes to null for ad_groups).
-- This is why a campaign row like "Low Konversi" (kode_produk = '-')
-- leaked into the Ads Product Performance table — it passed the
-- `kode_produk is not null` filter since '-' is a real (non-null) string.
-- =====================================================================

update sales_rows
  set kode_produk = null
  where source = 'ads' and kode_produk = '-';

notify pgrst, 'reload config';
