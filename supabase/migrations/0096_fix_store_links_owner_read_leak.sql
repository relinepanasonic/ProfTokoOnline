-- =====================================================================
-- 0096: Fix cross-owner read leak on store_links + owner-scope
-- dashboard_filters.
--
-- SECURITY REGRESSION: migration 0020 correctly restricted a
-- branch_manager's store_links reads to their own owner:
--   links_read_owner_scoped: client_id = my_client_id()
--     and my_role() = 'branch_manager' and owner = my_scope_owner()
--
-- Migration 0056 then added, to give owners write access to their Core
-- List:
--   links_owner_write: FOR ALL
--     using (client_id = my_client_id() and my_role() = 'branch_manager')
--
-- `FOR ALL` includes SELECT, and RLS policies are PERMISSIVE (OR'd), so
-- that clause silently re-granted every branch_manager client-wide READ
-- of store_links — defeating 0020 entirely. Symptom: an Owner's Dashboard
-- "Pemilik" dropdown listed every other owner in the tenant.
--
-- NOTE on the data model (verified, not a bug): all owners legitimately
-- share ONE tenant client_id. Isolation within a tenant is by
-- scope_owner, not client_id — so this is purely an RLS bug, and no
-- profile data needed correcting.
--
-- Fix: replace the FOR ALL policy with explicit INSERT/UPDATE/DELETE
-- policies carrying the same predicate, leaving SELECT governed solely
-- by links_read_owner_scoped.
-- =====================================================================

drop policy if exists links_owner_write on store_links;

create policy links_owner_insert on store_links
  for insert
  with check (client_id = my_client_id() and my_role()::text = 'branch_manager');

create policy links_owner_update on store_links
  for update
  using      (client_id = my_client_id() and my_role()::text = 'branch_manager')
  with check (client_id = my_client_id() and my_role()::text = 'branch_manager');

create policy links_owner_delete on store_links
  for delete
  using (client_id = my_client_id() and my_role()::text = 'branch_manager');

-- ── dashboard_filters: owner-scoped narrowing ────────────────────────────────
-- With the RLS fix, `stores` (from store_links) is already correct for an
-- Owner. But years/months read dashboard_rollup, where RLS filters row-by-row
-- via a store_links subquery — so without an owner predicate the query still
-- SCANS the whole tenant (all owners) before filtering. p_owner narrows it up
-- front, which is what fixes the 57014 timeout for Owner logins.
-- Signature changes, so the 1-arg version is dropped (PGRST203 — same lesson
-- as 0093/0084).
drop function if exists public.dashboard_filters(uuid);

create or replace function dashboard_filters(p_client_id uuid default null, p_owner text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'years',  coalesce((select jsonb_agg(distinct year order by year desc)
                         from dashboard_rollup r
                         where r.year is not null
                           and (p_client_id is null or r.client_id = p_client_id)
                           and (p_owner is null or r.store_name in (
                                 select sl.store_name from store_links sl
                                 where sl.client_id = r.client_id and sl.owner = p_owner and sl.store_name is not null))), '[]'),
    'months', coalesce((select jsonb_agg(distinct month)
                         from dashboard_rollup r
                         where r.month is not null
                           and (p_client_id is null or r.client_id = p_client_id)
                           and (p_owner is null or r.store_name in (
                                 select sl.store_name from store_links sl
                                 where sl.client_id = r.client_id and sl.owner = p_owner and sl.store_name is not null))), '[]'),
    'stores', coalesce((select jsonb_agg(distinct store_name order by store_name)
                         from store_links
                         where store_name is not null
                           and (p_client_id is null or client_id = p_client_id)
                           and (p_owner is null or owner = p_owner)), '[]')
  );
$$;

notify pgrst, 'reload config';
