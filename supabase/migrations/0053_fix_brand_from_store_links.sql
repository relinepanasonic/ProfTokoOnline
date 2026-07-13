-- =====================================================================
-- 0053: Repoint historical sales_rows.brand to the store's REAL brand.
--
-- Old uploads derived brand from the product name (a Panasonic-appliance
-- leftover), which tagged ~109k rows as "Others" plus a handful of wrong
-- AQUA/Gea/Beko — none matched the store's actual brand. Brand is now taken
-- from the uploader's Owner→Brand→Store choice (parse.ts change), and the
-- authoritative brand per store already lives in store_links (verified 1:1:
-- no store maps to more than one brand). So set every row's brand to its
-- store's store_links.brand.
--
-- NOTE: run in the SQL editor (as postgres). This rewrites ~110k rows, which
-- creates dead tuples — the aggressive autovacuum from 0050 will reclaim
-- them, and the dashboard reads the rollup (rebuilt below) not sales_rows,
-- so read speed is unaffected. VACUUM (ANALYZE) sales_rows; afterwards if
-- you want the space back immediately.
-- =====================================================================

update sales_rows s
  set brand = sl.brand
  from store_links sl
  where sl.client_id  = s.client_id
    and sl.store_name = s.store_name
    and sl.store_name is not null
    and s.brand is distinct from sl.brand;

-- Rebuild the dashboard rollup so Brand Share (and any brand filter) reflect
-- the corrected brands immediately.
select refresh_dashboard_rollup();
