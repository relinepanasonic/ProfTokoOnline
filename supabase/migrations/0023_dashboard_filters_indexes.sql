-- =====================================================================
-- 0023: Fix dashboard_filters() statement timeout (error 57014)
--
-- dashboard_filters() runs 4 independent DISTINCT ... ORDER BY scans over
-- sales_rows (year, month, city, store_name) with NO client_id predicate
-- (it deliberately aggregates whatever the caller's RLS lets them see).
-- The only existing index is the composite (client_id, year, month, city,
-- store_name, source) — useless here since client_id isn't filtered, so
-- each DISTINCT scan falls back to a full sequential scan + sort. As
-- sales_rows has grown this now exceeds Supabase's statement timeout.
--
-- Fix: one partial btree index per column, letting Postgres satisfy each
-- DISTINCT ... ORDER BY with a fast Index Only Scan instead of a full scan.
-- =====================================================================

create index if not exists sales_rows_year_only_idx
  on sales_rows (year) where year is not null;

create index if not exists sales_rows_month_only_idx
  on sales_rows (month) where month is not null;

create index if not exists sales_rows_city_only_idx
  on sales_rows (city) where city is not null;

create index if not exists sales_rows_store_name_only_idx
  on sales_rows (store_name) where store_name is not null;

-- Keep the planner's row-count estimates fresh so it actually picks the
-- new indexes right away instead of waiting for autovacuum.
analyze sales_rows;
