-- =====================================================================
-- 0024: Make the dashboard RPCs survive on a grown/bloated sales_rows
--
-- Symptom: Dashboard shows "No data yet" and Formulation's filters are
-- empty, with error 57014 (statement timeout). Both dashboard_summary()
-- and dashboard_filters() scan sales_rows, which has (a) no per-column
-- index and (b) heavy dead-tuple bloat from many delete + re-upload cycles.
--
-- This migration:
--   1. Re-asserts the per-column indexes (same as 0023 — safe if already run)
--   2. Raises the per-function statement_timeout so the analytical queries
--      can finish. Supabase/PostgREST honours a function-level SET, so this
--      only affects these two RPCs — not the whole role.
--   3. ANALYZE to refresh planner stats.
--
-- NOTE: this does NOT reclaim the bloat. After running this, ALSO run ONCE,
-- on its own (VACUUM cannot run inside a migration transaction):
--       VACUUM (FULL, ANALYZE) sales_rows;
-- That rewrites the table without the dead rows and sets the visibility map
-- so the new indexes can serve fast Index Only Scans.
-- =====================================================================

-- 1. per-column indexes (idempotent — mirrors 0023)
create index if not exists sales_rows_year_only_idx       on sales_rows (year)       where year       is not null;
create index if not exists sales_rows_month_only_idx      on sales_rows (month)      where month      is not null;
create index if not exists sales_rows_city_only_idx       on sales_rows (city)       where city       is not null;
create index if not exists sales_rows_store_name_only_idx on sales_rows (store_name) where store_name is not null;

-- 2. give the two analytical RPCs more headroom than the default 8s role timeout
alter function dashboard_summary(int, text, text, text, text, text) set statement_timeout = '30s';
alter function dashboard_filters()                                   set statement_timeout = '30s';

-- 3. refresh stats
analyze sales_rows;
