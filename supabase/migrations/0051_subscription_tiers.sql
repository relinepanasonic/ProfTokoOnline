-- =====================================================================
-- 0051: Owner subscription tiers + owner-scoped read for the premium
-- data pages (Keuangan / Operational).
--
-- Tiers apply ONLY to the Owner role (branch_manager). Other roles ignore
-- tier entirely.
--   signup      — just registered, not activated yet -> pending screen
--   juragan     — Basic  (Dashboard, Upload, Market Fee)
--   sultan      — Premium, monthly
--   king        — Premium, yearly
--   free_trial  — Premium, free 30-day trial
--
-- Superadmin activates a tier + a number of days on the Users page; that
-- sets sub_started_at = now() and sub_expires_at = now() + days (or NULL
-- for unlimited). The Owner sees a countdown; when it lapses they go
-- read-only (can view, cannot upload).
-- =====================================================================

alter table profiles add column if not exists tier           text not null default 'signup';
alter table profiles add column if not exists sub_started_at timestamptz;
alter table profiles add column if not exists sub_expires_at timestamptz;

do $$ begin
  alter table profiles add constraint profiles_tier_chk
    check (tier in ('signup','juragan','sultan','king','free_trial'));
exception when duplicate_object then null; end $$;

-- Grandfather every EXISTING owner to king / unlimited so nobody who
-- already has a login gets locked out the moment this ships. New owners
-- keep the 'signup' default and wait for activation.
update profiles
  set tier = 'king', sub_started_at = now(), sub_expires_at = null
  where role = 'branch_manager' and tier = 'signup';

-- ── helpers (for future server-side enforcement / RLS) ───────────────────────
create or replace function my_tier() returns text
  language sql stable security definer set search_path = public as $$
  select tier from profiles where id = auth.uid()
$$;

-- active = an owner whose tier is activated (not signup) and not expired.
-- Non-owners are always "active" (tier doesn't gate them).
create or replace function my_sub_active() returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when (select role from profiles where id = auth.uid())::text <> 'branch_manager' then true
    else exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.tier <> 'signup'
        and (p.sub_expires_at is null or p.sub_expires_at > now())
    )
  end
$$;

-- ── owner-scoped read on the premium data pages ──────────────────────────────
-- finance_rows + order_rows both carry store_name, so scope them to the
-- owner's stores exactly like sales_rows (migration 0020). product_costs
-- has no store dimension (cost is per product, per client) so owners get a
-- plain client-scoped read — needed so profit/margin RPCs can join costs
-- to the owner's own (already-scoped) sales.
drop policy if exists finance_rows_owner_scoped_read on finance_rows;
create policy finance_rows_owner_scoped_read on finance_rows
  for select using (
    client_id = my_client_id()
    and my_role()::text = 'branch_manager'
    and store_name in (
      select sl.store_name from store_links sl
      where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
    )
  );

drop policy if exists order_rows_owner_scoped_read on order_rows;
create policy order_rows_owner_scoped_read on order_rows
  for select using (
    client_id = my_client_id()
    and my_role()::text = 'branch_manager'
    and store_name in (
      select sl.store_name from store_links sl
      where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
    )
  );

drop policy if exists product_costs_owner_read on product_costs;
create policy product_costs_owner_read on product_costs
  for select using (
    client_id = my_client_id() and my_role()::text = 'branch_manager'
  );

notify pgrst, 'reload config';
