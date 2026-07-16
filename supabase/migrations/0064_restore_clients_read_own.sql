-- =====================================================================
-- 0064: clients 406 on every branch_manager/advertiser session — the
-- layout's clientName lookup (clients?select=name) and the Dashboard's
-- store_label lookup (clients?select=store_label) both use .single(),
-- which PostgREST turns into a 406 when RLS filters the row out entirely.
--
-- Root cause, found by tracing actual browser console errors: migration
-- 0001 created `clients_read_own` (for select using (id = my_client_id()))
-- so EVERY role could read their own client row. Migration 0007
-- (consolidating client_admin's policies) dropped it to replace it —
-- "drop policy if exists clients_read_own on clients;" — but only ever
-- recreated clients_super_all and a NEW clients_admin_read (client_admin
-- only). clients_read_own was never restored. Migration 0056 even left a
-- comment claiming "clients_read_own already covers id = my_client_id()
-- for every role, kept as-is" — that comment was wrong; the policy had
-- already been gone for many migrations by then. branch_manager,
-- advertiser, and store_user have had zero read access to their own
-- clients row since migration 0007.
-- =====================================================================

drop policy if exists clients_read_own on clients;
create policy clients_read_own on clients
  for select using (id = my_client_id());

notify pgrst, 'reload config';
