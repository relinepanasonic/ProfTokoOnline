-- =====================================================================
-- 0092: Fix dashboard_filters() 57014 regression from migration 0089.
--
-- 0089 added `week` to dashboard_rollup's grain to support the weekly
-- drilldown chart, which roughly 4-5x'd its row count (one row per week
-- instead of per month). dashboard_filters() had no client_id filter at
-- all — a full-table scan relying purely on RLS, whose owner-scoped
-- policy re-evaluates a store_links subquery per branch_manager session.
-- The larger table pushed that back over the statement timeout.
--
-- Fix:
--   * years/months: add p_client_id + an explicit WHERE, backed by a new
--     covering index, so the planner can restrict the scan (and RLS's
--     per-row check) to one tenant instead of the whole table.
--   * stores: source from store_links instead of dashboard_rollup — it's
--     only ever re-filtered against store_links client-side anyway
--     (page.tsx), so scanning the fact table for it was pure waste.
--   * cities: dropped entirely — the City filter was removed from the
--     Dashboard UI (an earlier migration), this output had no consumer.
--
-- Still `language sql stable` (NOT security definer) — the explicit
-- client_id predicate only helps the planner; RLS remains the actual
-- security boundary, so a caller still can't fetch another tenant's data
-- by passing an arbitrary p_client_id.
-- =====================================================================

create index if not exists dashboard_rollup_client_year_month_idx
  on dashboard_rollup (client_id, year, month);

create or replace function dashboard_filters(p_client_id uuid default null)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'years',  coalesce((select jsonb_agg(distinct year order by year desc)
                         from dashboard_rollup
                         where year is not null and (p_client_id is null or client_id = p_client_id)), '[]'),
    'months', coalesce((select jsonb_agg(distinct month)
                         from dashboard_rollup
                         where month is not null and (p_client_id is null or client_id = p_client_id)), '[]'),
    'stores', coalesce((select jsonb_agg(distinct store_name order by store_name)
                         from store_links
                         where store_name is not null and (p_client_id is null or client_id = p_client_id)), '[]')
  );
$$;

notify pgrst, 'reload config';
