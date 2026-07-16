-- =====================================================================
-- 0059: Owners can't delete their own uploads — the Delete button in the
-- Upload Log silently did nothing for a branch_manager. Also: client_admin
-- and advertiser can now UPLOAD finance/ops files (an earlier round widened
-- /api/finance/upload and /api/store/upload to allow them) but were never
-- given SELECT on finance_rows/order_rows — the new per-page UploadGate
-- check (finance_rows / order_rows existence) would show those two roles a
-- permanently blurred Finance Detail / Ops Performance page even with real
-- data present, since RLS silently returns 0 rows rather than erroring.
--
-- uploads RLS only ever had uploads_admin_all (superadmin/client_admin),
-- uploads_advertiser_write, and a read-only uploads_scoped_read for
-- everyone else. There was never a write/delete policy for branch_manager,
-- so `.delete().in("id", ids)` from the Owner-facing Upload Log matched 0
-- rows under RLS — Supabase doesn't error on a 0-row delete, so the button
-- looked like it did nothing.
--
-- Scope: an Owner may only delete uploads for their OWN client AND a store
-- that belongs to their OWN owner-scope (meta->>'store_name' checked against
-- store_links, same scoping already enforced server-side on the upload
-- POST routes). uploads has no direct store_name/owner column — the store
-- name lives in the meta jsonb blob written by every upload route.
-- =====================================================================

drop policy if exists uploads_owner_write on uploads;
create policy uploads_owner_write on uploads
  for all
  using (
    client_id = my_client_id()
    and my_role()::text = 'branch_manager'
    and (meta->>'store_name') in (
      select sl.store_name from store_links sl
      where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
    )
  )
  with check (
    client_id = my_client_id()
    and my_role()::text = 'branch_manager'
    and (meta->>'store_name') in (
      select sl.store_name from store_links sl
      where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
    )
  );

-- client_admin/advertiser: client-scoped read on finance_rows/order_rows,
-- matching the write access those two roles already have on the upload
-- routes. superadmin is already covered by finance_rows_super_all /
-- order_rows_super_all ("for all"); branch_manager by the owner-scoped
-- read policies from migration 0051.
drop policy if exists finance_rows_staff_read on finance_rows;
create policy finance_rows_staff_read on finance_rows
  for select using (client_id = my_client_id() and my_role()::text in ('client_admin','advertiser'));

drop policy if exists order_rows_staff_read on order_rows;
create policy order_rows_staff_read on order_rows
  for select using (client_id = my_client_id() and my_role()::text in ('client_admin','advertiser'));

notify pgrst, 'reload config';
