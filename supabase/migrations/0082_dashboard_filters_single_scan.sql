-- =====================================================================
-- 0082: Fix dashboard_filters() statement timeout (57014).
--
-- The previous version ran 4 separate subqueries against dashboard_rollup
-- ('years','months','cities','stores'), each its own full table scan +
-- DISTINCT sort. dashboard_rollup's grain includes item_name (per-product),
-- so row counts are large — 4 independent scans (further multiplied by the
-- RLS predicate re-evaluating store_links per row for a branch_manager) was
-- enough to blow the role-level statement timeout.
--
-- Fix: one single scan, computing all 4 DISTINCT aggregates in the same
-- pass via FILTER, instead of 4 separate correlated subqueries.
-- =====================================================================

create or replace function dashboard_filters()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'years',  coalesce(jsonb_agg(distinct year        order by year desc) filter (where year       is not null), '[]'),
    'months', coalesce(jsonb_agg(distinct month)                          filter (where month       is not null), '[]'),
    'cities', coalesce(jsonb_agg(distinct city          order by city)          filter (where city         is not null), '[]'),
    'stores', coalesce(jsonb_agg(distinct store_name    order by store_name)    filter (where store_name   is not null), '[]')
  )
  from dashboard_rollup;
$$;

notify pgrst, 'reload config';
