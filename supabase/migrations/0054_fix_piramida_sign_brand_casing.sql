-- =====================================================================
-- 0054: Fix "piramida sign" brand casing -> "Piramida Sign".
--
-- Confirmed mappings (per user):
--   Nuphy         - Owner Yohanes - Brand Nuphy         - Store nuphyindonesia  (already correct)
--   Piramida Sign - Owner Sherry  - Brand Piramida Sign - Store piramidasign    (brand was lowercase)
-- =====================================================================

update store_links
  set brand = 'Piramida Sign'
  where store_name = 'piramidasign' and brand = 'piramida sign';

update sales_rows
  set brand = 'Piramida Sign'
  where store_name = 'piramidasign' and brand = 'piramida sign';

select refresh_dashboard_rollup();
