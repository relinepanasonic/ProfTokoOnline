-- =====================================================================
-- 0081: Re-apply dashboard_filters() as a safety net.
--
-- The Dashboard's Year/Month dropdowns are populated by dashboard_filters(),
-- a separate RPC from dashboard_summary() (which supplies the KPI totals).
-- If migration 0060 was ever skipped, the live function could still be the
-- much older 0002 version reading raw sales_rows instead of dashboard_rollup
-- — this idempotently re-applies the intended (0060) definition so both are
-- guaranteed in sync, regardless of migration history. Safe to run any
-- number of times.
-- =====================================================================

create or replace function dashboard_filters()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'years',  (select coalesce(jsonb_agg(distinct year order by year desc), '[]') from dashboard_rollup where year is not null),
    'months', (select coalesce(jsonb_agg(distinct month), '[]') from dashboard_rollup where month is not null),
    'cities', (select coalesce(jsonb_agg(distinct city order by city), '[]') from dashboard_rollup where city is not null),
    'stores', (select coalesce(jsonb_agg(distinct store_name order by store_name), '[]') from dashboard_rollup where store_name is not null)
  );
$$;

notify pgrst, 'reload config';
