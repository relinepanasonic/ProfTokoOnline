-- =====================================================================
-- 0028: Restore the per-function statement_timeout dropped by 0026/0027
--
-- CREATE OR REPLACE FUNCTION does NOT carry forward a function's SET
-- config (proconfig) from the previous definition — it must be re-declared
-- every time the function body changes. Migrations 0026 and 0027 redefined
-- dashboard_summary() without re-adding the `set statement_timeout = '30s'`
-- from migration 0024, silently reverting it to the (much shorter) default
-- and reintroducing error 57014 even though the query itself was fixed.
--
-- Fix: re-apply the override (ALTER FUNCTION ... SET does not require
-- redefining the body), bumped to 45s since the trend join adds work.
-- =====================================================================

alter function dashboard_summary(int, text, text, text, text, text) set statement_timeout = '45s';
alter function dashboard_filters()                                   set statement_timeout = '45s';

analyze sales_rows;
