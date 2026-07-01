-- =====================================================================
-- 0021: Allow inviting a "Superadmin" role from the Users page.
-- (Only superadmin can create invites at all — see api/invites/route.ts
-- verifyAdmin — so this just lets a superadmin bring in another one.)
-- =====================================================================
alter table invites drop constraint if exists invites_role_check;
alter table invites add constraint invites_role_check
  check (role in ('branch_manager','client_admin','store_user','advertiser','superadmin'));
