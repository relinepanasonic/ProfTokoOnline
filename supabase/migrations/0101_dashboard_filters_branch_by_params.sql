-- =====================================================================
-- 0101: Fix the last 57014 on dashboard_filters() — the
-- `(p_x IS NULL OR col = p_x)` anti-pattern.
--
-- dashboard_summary/dashboard_filters's earlier 57014 rounds (0092-0099)
-- were all about RLS subquery cost or missing client scoping. Those are
-- fixed; dashboard_summary loads instantly now. dashboard_filters still
-- times out because it's a single `language sql stable` statement with
-- `(p_client_id is null or client_id = p_client_id)` and
-- `(p_owner is null or owner = p_owner)` on every sub-query. Postgres
-- plans ONE generic plan that has to stay correct for every possible
-- (p_client_id, p_owner) combination — it can't prove either half of
-- either OR is dead at plan time, so it can't commit to
-- dashboard_rollup_client_year_month_idx or
-- dashboard_rollup_client_owner_idx and falls back to a scan.
--
-- Fix: rewrite as plpgsql with explicit IF/ELSIF/ELSE branches, each
-- running its own static SQL with a hardcoded equality predicate (no OR
-- IS NULL anywhere). Postgres plans each branch's statements
-- independently, so whichever branch actually executes gets a real
-- index scan on the columns that matter for that case:
--   Path A: p_client_id is null           -> Super Admin, unscoped (RLS
--                                             already grants full access;
--                                             no index needed/possible)
--   Path B: p_client_id set, p_owner null -> client_id = p_client_id
--                                             (dashboard_rollup_client_
--                                             year_month_idx)
--   Path C: both set                      -> client_id = p_client_id AND
--                                             owner = p_owner (the actual
--                                             57014 case — branch_manager/
--                                             store_user logins;
--                                             dashboard_rollup_client_
--                                             owner_idx)
--
-- Signature is unchanged from 0096/0098 (p_client_id uuid default null,
-- p_owner text default null), so this isn't a PGRST203 risk, but the
-- DROP is kept anyway per the standing rule for every RPC touch.
-- =====================================================================

drop function if exists public.dashboard_filters(uuid, text);

create or replace function dashboard_filters(p_client_id uuid default null, p_owner text default null)
returns jsonb
language plpgsql
stable
as $$
declare
  v_years  jsonb;
  v_months jsonb;
  v_stores jsonb;
begin
  if p_client_id is null then
    -- Path A: Super Admin — unscoped, matches prior behavior exactly.
    select coalesce(jsonb_agg(distinct year order by year desc), '[]')
      into v_years
      from dashboard_rollup
      where year is not null;

    select coalesce(jsonb_agg(distinct month), '[]')
      into v_months
      from dashboard_rollup
      where month is not null;

    select coalesce(jsonb_agg(distinct store_name order by store_name), '[]')
      into v_stores
      from store_links
      where store_name is not null;

  elsif p_owner is null then
    -- Path B: client_admin/advertiser — client-scoped, no owner.
    select coalesce(jsonb_agg(distinct year order by year desc), '[]')
      into v_years
      from dashboard_rollup
      where year is not null and client_id = p_client_id;

    select coalesce(jsonb_agg(distinct month), '[]')
      into v_months
      from dashboard_rollup
      where month is not null and client_id = p_client_id;

    select coalesce(jsonb_agg(distinct store_name order by store_name), '[]')
      into v_stores
      from store_links
      where store_name is not null and client_id = p_client_id;

  else
    -- Path C: branch_manager/store_user — client + owner scoped. This is
    -- the path that was actually timing out.
    select coalesce(jsonb_agg(distinct year order by year desc), '[]')
      into v_years
      from dashboard_rollup
      where year is not null and client_id = p_client_id and owner = p_owner;

    select coalesce(jsonb_agg(distinct month), '[]')
      into v_months
      from dashboard_rollup
      where month is not null and client_id = p_client_id and owner = p_owner;

    select coalesce(jsonb_agg(distinct store_name order by store_name), '[]')
      into v_stores
      from store_links
      where store_name is not null and client_id = p_client_id and owner = p_owner;
  end if;

  return jsonb_build_object('years', v_years, 'months', v_months, 'stores', v_stores);
end;
$$;

notify pgrst, 'reload config';
