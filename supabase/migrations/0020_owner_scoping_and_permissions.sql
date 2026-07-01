-- =====================================================================
-- 0020: Real Owner-level data scoping + 4-tier permission model
--
--   Role model (final):
--     superadmin    — everything
--     client_admin  — Upload, Core List, Market Place Fee only (see/edit/delete)
--     advertiser    — Dashboard, Ads Performance (see/edit/delete)
--     branch_manager ("Owner") — Dashboard, Ads Performance, Price Calculator,
--                     Market Place Fee — READ ONLY, scoped to their own
--                     Owner name (which may span many Brands/Stores — one
--                     login sees everything under store_links.owner = theirs)
--
--   The old branch_manager scoping was by CITY (my_scope_city()), which was
--   never actually populated by the invite flow — Owner accounts effectively
--   saw nothing. Replaced with a proper Owner-name scope.
-- =====================================================================

-- ── 1. profiles.scope_owner + helper fn ───────────────────────────────────────
alter table profiles add column if not exists scope_owner text;

create or replace function my_scope_owner() returns text
  language sql stable security definer set search_path = public as $$
  select scope_owner from profiles where id = auth.uid()
$$;

-- ── 2. sales_rows: branch_manager scoped by owner (was: city) ────────────────
drop policy if exists sales_scoped_read on sales_rows;
create policy sales_scoped_read on sales_rows
  for select using (
    client_id = my_client_id()
    and (
      (my_role()::text = 'branch_manager' and store_name in (
        select sl.store_name from store_links sl
        where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
      ))
      or (my_role()::text = 'store_user' and store_name = my_scope_store())
    )
  );

-- ── 3. store_links: broad read for admin/advertiser, owner-scoped for branch_manager
drop policy if exists links_client_read on store_links;
drop policy if exists links_read_broad on store_links;
drop policy if exists links_read_owner_scoped on store_links;

create policy links_read_broad on store_links
  for select using (
    client_id = my_client_id() and my_role()::text <> 'branch_manager'
  );
create policy links_read_owner_scoped on store_links
  for select using (
    client_id = my_client_id() and my_role()::text = 'branch_manager' and owner = my_scope_owner()
  );

-- ── 4. ad_groups: same split (was: unrestricted for branch_manager) ──────────
drop policy if exists ad_groups_client_read on ad_groups;
create policy ad_groups_client_read on ad_groups
  for select using (
    client_id = my_client_id()
    and my_role()::text in ('client_admin','advertiser')
  );
create policy ad_groups_owner_scoped_read on ad_groups
  for select using (
    client_id = my_client_id()
    and my_role()::text = 'branch_manager'
    and store_name in (
      select sl.store_name from store_links sl
      where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
    )
  );

-- ── 5. ad_modals: same read split (branch_manager has no write access) ───────
drop policy if exists ad_modals_client_read on ad_modals;
create policy ad_modals_client_read on ad_modals
  for select using (
    client_id = my_client_id()
    and my_role()::text in ('client_admin','advertiser')
  );
create policy ad_modals_owner_scoped_read on ad_modals
  for select using (
    client_id = my_client_id()
    and my_role()::text = 'branch_manager'
    and store_name in (
      select sl.store_name from store_links sl
      where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
    )
  );
