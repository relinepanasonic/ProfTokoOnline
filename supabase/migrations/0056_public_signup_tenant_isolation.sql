-- =====================================================================
-- 0056: Public self-serve registration, on a true multi-tenant foundation.
--
-- Every signup gets its OWN new `clients` row (a real tenant), fully
-- isolated from the existing "Prof Toko Online" client and from every other
-- signup. This migration:
--   A. Closes a real cross-tenant leak: client_admin currently has GLOBAL,
--      unscoped RLS access on 6 tables (by original design — see
--      /api/users' isScopedRole(), which deliberately excludes client_admin
--      because it was built as a platform-wide ops role). That's fine with
--      one tenant; with multiple tenants it means any client_admin could
--      read every tenant's data. Scoped to client_id = my_client_id() below.
--      The one existing client_admin has client_id = NULL today, so it's
--      backfilled to Prof Toko Online FIRST — otherwise this scoping would
--      lock them out entirely (NULL = my_client_id() matches nothing).
--   B. Adds the profile columns the register form needs.
--   C. Adds client_id-scoped WRITE policies on store_links/master_data for
--      branch_manager, so a self-registered tenant owner can manage their
--      own Core List (they had read-only before; there were 0 branch_manager
--      accounts, so no regression).
--   D. provision_tenant(): one SECURITY DEFINER function that creates the
--      clients + store_links + profiles rows atomically (single function
--      call = single transaction; the API just calls this once).
-- =====================================================================

-- ── A1. Backfill the existing client_admin to Prof Toko Online ───────────────
update profiles set client_id = (select id from clients where slug = 'prof-toko-online')
  where role = 'client_admin' and client_id is null;

-- ── A2. Scope the 6 previously-global client_admin policies ──────────────────
drop policy if exists sales_admin_all on sales_rows;
create policy sales_admin_all on sales_rows
  for all
  using (my_role() = 'superadmin' or (my_role() = 'client_admin' and client_id = my_client_id()))
  with check (my_role() = 'superadmin' or (my_role() = 'client_admin' and client_id = my_client_id()));

drop policy if exists clients_admin_read on clients;
create policy clients_admin_read on clients
  for select using (my_role() = 'client_admin' and id = my_client_id());
-- (clients_read_own already covers "id = my_client_id()" for every role, kept as-is)

drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all
  using (my_role() = 'client_admin' and role <> 'superadmin' and client_id = my_client_id())
  with check (my_role() = 'client_admin' and role <> 'superadmin' and client_id = my_client_id());

drop policy if exists master_admin_all on master_data;
create policy master_admin_all on master_data
  for all
  using (my_role() = 'superadmin' or (my_role() = 'client_admin' and client_id = my_client_id()))
  with check (my_role() = 'superadmin' or (my_role() = 'client_admin' and client_id = my_client_id()));

drop policy if exists links_admin_all on store_links;
create policy links_admin_all on store_links
  for all
  using (my_role() = 'superadmin' or (my_role() = 'client_admin' and client_id = my_client_id()))
  with check (my_role() = 'superadmin' or (my_role() = 'client_admin' and client_id = my_client_id()));

drop policy if exists rollup_admin_read on dashboard_rollup;
create policy rollup_admin_read on dashboard_rollup
  for select using (my_role() = 'superadmin' or (my_role() = 'client_admin' and client_id = my_client_id()));

-- ── B. New profile columns for the register form + superadmin tracking ───────
alter table profiles add column if not exists brand       text;
alter table profiles add column if not exists nama_toko   text;
alter table profiles add column if not exists contacted    boolean not null default false;
alter table profiles add column if not exists contacted_at timestamptz;
alter table profiles add column if not exists contacted_by uuid references profiles(id);

-- Case-insensitive uniqueness at the DB level (the app also checks this
-- before insert, but a unique index is what actually prevents a race
-- between two concurrent signups picking the same username).
create unique index if not exists profiles_username_unique_idx
  on profiles (lower(username)) where username is not null;

-- ── C. Owner (branch_manager) write access to their OWN Core List ────────────
-- Read access already exists (links_read_owner_scoped / master_client_read).
drop policy if exists links_owner_write on store_links;
create policy links_owner_write on store_links
  for all
  using (client_id = my_client_id() and my_role()::text = 'branch_manager')
  with check (client_id = my_client_id() and my_role()::text = 'branch_manager');

drop policy if exists master_owner_write on master_data;
create policy master_owner_write on master_data
  for all
  using (client_id = my_client_id() and my_role()::text = 'branch_manager')
  with check (client_id = my_client_id() and my_role()::text = 'branch_manager');

-- ── D. Atomic tenant provisioning ─────────────────────────────────────────────
-- Called once by /api/register after the auth user is created. Creates a
-- brand-new, fully isolated tenant (clients row) + its first store_links
-- entry + the owner's profile, all in one function call — if any insert
-- fails the whole thing rolls back (Postgres wraps the function body in the
-- calling statement's transaction).
create or replace function provision_tenant(
  p_user_id      uuid,
  p_email        text,
  p_display_name text,
  p_username     text,
  p_phone        text,
  p_brand        text,
  p_nama_toko    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
  v_slug      text;
begin
  -- unique slug derived from the store name, falling back to the new
  -- client id's text form on any collision (guaranteed unique).
  v_slug := lower(regexp_replace(coalesce(p_nama_toko, p_brand, 'toko'), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' or exists (select 1 from clients where slug = v_slug) then
    v_slug := 'toko-' || replace(gen_random_uuid()::text, '-', '');
  end if;

  insert into clients (name, slug, pic_label, store_label)
    values (coalesce(p_nama_toko, p_brand, p_display_name), v_slug, 'PIC', 'Store Name')
    returning id into v_client_id;

  insert into store_links (client_id, owner, brand, store_name)
    values (v_client_id, p_display_name, p_brand, p_nama_toko);

  insert into profiles (
    id, email, display_name, username, phone, role, client_id,
    scope_owner, brand, nama_toko, plan_type, subscription_end
  ) values (
    p_user_id, p_email, p_display_name, p_username, p_phone, 'branch_manager', v_client_id,
    p_display_name, p_brand, p_nama_toko, 'sultan', now() + interval '30 days'
  );

  return v_client_id;
end $$;

grant execute on function provision_tenant(uuid,text,text,text,text,text,text) to service_role;

notify pgrst, 'reload config';
