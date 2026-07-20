-- =====================================================================
-- 0093: Fix PGRST203 ambiguous-function error on dashboard_filters().
--
-- 0092 added p_client_id as a new parameter. Postgres resolves functions
-- by name + argument types, so CREATE OR REPLACE with a different
-- parameter list creates a SECOND overload rather than replacing the
-- original zero-arg one (the exact same mistake, and fix, as migration
-- 0084 for store_perf_summary). PostgREST then can't pick between
-- dashboard_filters() and dashboard_filters(p_client_id uuid) and fails
-- with PGRST203. Drop the orphaned zero-arg signature so only the
-- client-scoped version can ever be called.
-- =====================================================================

drop function if exists public.dashboard_filters();

notify pgrst, 'reload config';
