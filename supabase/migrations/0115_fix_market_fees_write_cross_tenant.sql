-- =====================================================================
-- 0115: Fix a cross-tenant write hole in market_fees_write (0113).
--
-- market_fees_write only checked the caller's ROLE:
--   using (my_role()::text in ('superadmin','client_admin'))
--   with check (my_role()::text in ('superadmin','client_admin'))
-- Nothing scoped it to the caller's OWN client_id. Any client_admin could
-- insert/update/delete another tenant's market_fees rows outright by
-- specifying a different client_id — a genuine cross-tenant write
-- vulnerability, not just a read leak. Caught while building
-- price_calc_items (0114) on the same shape, before that same mistake
-- could be copied forward again.
--
-- superadmin has client_id = NULL by design (this project's standing
-- rule — see 0001/every prior superadmin-scoping fix this session), so
-- the fix keeps superadmin on its own unconditional OR-branch rather than
-- folding it into the client_id equality check.
-- =====================================================================

drop policy if exists market_fees_write on market_fees;
create policy market_fees_write on market_fees
  for all
  using (
    (client_id = my_client_id() and my_role()::text = 'client_admin')
    or my_role()::text = 'superadmin'
  )
  with check (
    (client_id = my_client_id() and my_role()::text = 'client_admin')
    or my_role()::text = 'superadmin'
  );

notify pgrst, 'reload config';
