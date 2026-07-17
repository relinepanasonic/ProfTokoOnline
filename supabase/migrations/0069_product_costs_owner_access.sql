-- =====================================================================
-- 0069: Modal Product (product_costs) was invisible to everyone except
-- superadmin. Its only RLS policy, product_costs_super_all (0035), gated
-- both read and write to my_role() = 'superadmin' — client_admin and
-- branch_manager (Owner) got 0 rows back under RLS (no error, just an
-- empty "No products found" table), and their upsert on saveCost()/
-- importExcel() in ModalProduct.tsx would likewise silently match nothing.
--
-- Modal Product is client-wide cost data (no store_name column — see
-- 0035's own "Import berlaku untuk semua produk, tanpa perlu Store"), so
-- unlike uploads_owner_write there is no store_links scoping to add here:
-- client_id = my_client_id() is the whole story for both client_admin and
-- branch_manager (Owner).
-- =====================================================================

drop policy if exists product_costs_staff_all on product_costs;
create policy product_costs_staff_all on product_costs
  for all
  using (client_id = my_client_id() and my_role()::text in ('client_admin', 'branch_manager'))
  with check (client_id = my_client_id() and my_role()::text in ('client_admin', 'branch_manager'));

notify pgrst, 'reload config';
