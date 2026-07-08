-- =====================================================================
-- 0050: Make autovacuum far more aggressive on sales_rows.
--
-- The dashboard timeout (57014) keeps coming back after any large write
-- (bulk weekly uploads, or the 0049 backfill which rewrote ~90k rows).
-- Default autovacuum only triggers after 20% of the table changes, so
-- dead tuples pile up and the full-table dashboard aggregate slows past
-- the statement_timeout. Dropping the scale factor to 2% makes Postgres
-- clean up almost continuously, keeping scans fast without manual VACUUM.
--
-- This does NOT reclaim the bloat that already exists — run
--   VACUUM (FULL, ANALYZE) sales_rows;
-- once in the SQL editor first (it takes a brief exclusive lock). After
-- that, this setting keeps it from recurring.
-- =====================================================================

alter table sales_rows set (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 2
);
