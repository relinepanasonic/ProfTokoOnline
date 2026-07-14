-- =====================================================================
-- 0055: Reshape the owner subscription columns to the plan_type model.
--
-- Supersedes 0051's tier/sub_started_at/sub_expires_at. There are currently
-- 0 Owner (branch_manager) accounts, so there is no live subscription data
-- to migrate — this is a clean rename + value remap, not a data migration.
--
--   tier            -> plan_type   ('lapak','sultan','king')
--                        ('juragan' was the old name for 'lapak'; the old
--                         'signup'/'free_trial' states are gone — new owners
--                         get a 30-day Sultan trial at registration instead)
--   sub_expires_at  -> subscription_end
--   sub_started_at  -> dropped (was display-only)
--
-- Plans (feature access is enforced in the app, not here):
--   Lapak  (30d):  Dashboard, Upload, Marketplace Fee
--   Sultan (30d):  + Ads, Detail Keuangan, Performa Operational, Price Calc
--   King   (395d): same features as Sultan
-- =====================================================================

alter table profiles drop constraint if exists profiles_tier_chk;
alter table profiles drop column     if exists sub_started_at;

-- Rename the two columns we keep (only if they still have the old names, so
-- this migration is safe to re-run).
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name='profiles' and column_name='tier') then
    alter table profiles rename column tier to plan_type;
  end if;
  if exists (select 1 from information_schema.columns
             where table_name='profiles' and column_name='sub_expires_at') then
    alter table profiles rename column sub_expires_at to subscription_end;
  end if;
end $$;

-- The column now allows NULL (a non-owner, or an owner not yet provisioned).
alter table profiles alter column plan_type drop not null;
alter table profiles alter column plan_type drop default;
update profiles set plan_type = null where plan_type in ('signup');
update profiles set plan_type = 'lapak'  where plan_type = 'juragan';
update profiles set plan_type = 'sultan' where plan_type = 'free_trial';

do $$ begin
  alter table profiles add constraint profiles_plan_chk
    check (plan_type is null or plan_type in ('lapak','sultan','king'));
exception when duplicate_object then null; end $$;

-- ── helpers (RLS / server-side enforcement) ──────────────────────────────────
create or replace function my_plan() returns text
  language sql stable security definer set search_path = public as $$
  select plan_type from profiles where id = auth.uid()
$$;

drop function if exists my_tier();

-- active = an owner whose plan is set and not expired. Non-owners are always
-- active (plan_type doesn't gate them).
create or replace function my_sub_active() returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when (select role from profiles where id = auth.uid())::text <> 'branch_manager' then true
    else exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.plan_type is not null
        and (p.subscription_end is null or p.subscription_end > now())
    )
  end
$$;

notify pgrst, 'reload config';
