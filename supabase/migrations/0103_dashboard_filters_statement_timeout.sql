-- =====================================================================
-- 0103: dashboard_filters() still 57014s for Super Admin (Path A).
--
-- 0101 fixed the OR-IS-NULL planning problem by branching into 3 static
-- paths, but never gave the function its own statement_timeout — it was
-- still inheriting the role-level 20s default (migration 0045). Path A
-- (p_client_id IS NULL — Super Admin) has NO predicate at all by design
-- (superadmin sees every tenant), so it's a genuine full scan of
-- dashboard_rollup with nothing to index against. As the table keeps
-- growing, that scan now exceeds 20s too — same shape of bug as
-- refresh_dashboard_rollup() (0060, regressed by 0097, refixed in 0102),
-- just on the read side instead of the write side this time.
--
-- Fix: give dashboard_filters() its own generous statement_timeout, same
-- pattern as every other RPC in this codebase that scans dashboard_rollup
-- at scale (refresh_dashboard_rollup 180s, refresh_ads_rollup 60s,
-- refresh_product_catalog 60s). Function body is otherwise byte-for-byte
-- identical to 0101 — only the SET clause is added.
-- =====================================================================

drop function if exists public.dashboard_filters(uuid, text);

create or replace function dashboard_filters(p_client_id uuid default null, p_owner text default null)
returns jsonb
language plpgsql
stable
set statement_timeout = '60s'
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
    -- Path C: branch_manager/store_user — client + owner scoped.
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
