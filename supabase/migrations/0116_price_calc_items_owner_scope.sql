-- =====================================================================
-- 0116: Scope price_calc_items by Owner/Store, not just client_id.
--
-- 0114 only scoped this table by client_id — inside one tenant (client),
-- every Owner shares that same client_id, so any branch_manager could
-- read/write every OTHER owner's product rows in the Massive Calculator.
-- Same owner/store_name scoping pattern already used on dashboard_rollup/
-- ads_rollup (migration 0097): branch_manager sees only their own owner's
-- rows, store_user only their own store's rows, client_admin/superadmin
-- see everything in the client.
--
-- Policy calls are wrapped as (select my_role()) / (select my_scope_owner())
-- etc. from the start — bare calls in a USING clause get re-evaluated once
-- PER ROW (the exact bug migration 0108 spent a whole investigation
-- tracking down on dashboard_rollup); no reason to reintroduce it on a new
-- table when the fix pattern is already established in this codebase.
-- =====================================================================

alter table price_calc_items add column if not exists owner text;
alter table price_calc_items add column if not exists store_name text;

create index if not exists price_calc_items_owner_idx on price_calc_items (client_id, owner);
create index if not exists price_calc_items_store_idx on price_calc_items (client_id, store_name);

drop policy if exists price_calc_items_read  on price_calc_items;
drop policy if exists price_calc_items_write on price_calc_items;

create policy price_calc_items_read on price_calc_items
  for select using (
    (select my_role())::text = 'superadmin'
    or (
      client_id = (select my_client_id())
      and (
        (select my_role())::text = 'client_admin'
        or ((select my_role())::text = 'branch_manager' and owner = (select my_scope_owner()))
        or ((select my_role())::text = 'store_user' and store_name = (select my_scope_store()))
      )
    )
  );

create policy price_calc_items_write on price_calc_items
  for all
  using (
    (select my_role())::text = 'superadmin'
    or (
      client_id = (select my_client_id())
      and (
        (select my_role())::text = 'client_admin'
        or ((select my_role())::text = 'branch_manager' and owner = (select my_scope_owner()))
      )
    )
  )
  with check (
    (select my_role())::text = 'superadmin'
    or (
      client_id = (select my_client_id())
      and (
        (select my_role())::text = 'client_admin'
        or ((select my_role())::text = 'branch_manager' and owner = (select my_scope_owner()))
      )
    )
  );

notify pgrst, 'reload config';
