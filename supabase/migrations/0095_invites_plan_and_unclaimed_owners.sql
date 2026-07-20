-- =====================================================================
-- 0095: Extend `invites` for the "Unclaimed Owners" invite-to-claim flow
-- (extends the existing invites table/route/join page — no parallel
-- system) + get_unclaimed_owners() RPC.
--
-- New columns are nullable so the existing manual "Invite User" button
-- (client_admin/superadmin, sultan/30d) is completely unaffected — it
-- never sets them, so /api/join falls back to its current hardcoded
-- defaults for those rows. `expires_at` was already nullable (no NOT
-- NULL constraint, just a default), so NULL = lifetime needs no schema
-- change — only /api/join's expiry checks need to treat NULL as "never
-- expires" (handled in the route, not here).
--
-- get_unclaimed_owners(): every (owner, client_id) pair in store_links
-- that has no matching branch_manager profile (scope_owner + client_id),
-- LEFT JOIN'd to that owner's most recent unused invite (if any) to
-- report 'No Link' vs 'Pending Signup'. Plain `language sql stable`
-- (not security definer) — relies on the existing profiles_super_all /
-- links_super_all / invites_superadmin_all RLS policies, so only
-- superadmin sees results, matching /api/invites' existing superadmin
-- gate.
-- =====================================================================

alter table invites add column if not exists plan_type text;
alter table invites add column if not exists duration_days int;

create or replace function get_unclaimed_owners()
returns table (
  owner_name text,
  client_id uuid,
  invite_status text,
  token text
)
language sql stable as $$
  select
    sl.owner as owner_name,
    sl.client_id,
    case when i.token is not null then 'Pending Signup' else 'No Link' end as invite_status,
    i.token
  from (
    select distinct owner, client_id from store_links where owner is not null
  ) sl
  left join profiles p
    on p.role = 'branch_manager' and p.client_id = sl.client_id and p.scope_owner = sl.owner
  left join lateral (
    select inv.token
    from invites inv
    where inv.owner_name = sl.owner and inv.client_id = sl.client_id and inv.used_at is null
    order by inv.created_at desc
    limit 1
  ) i on true
  where p.id is null
  order by sl.owner;
$$;

notify pgrst, 'reload config';
