-- =====================================================================
-- 0117: profiles_plan_chk never learned about the "prof" tier.
--
-- 0100 introduced plan_type='prof' (agency-managed real clients, lifetime)
-- and explicitly said "no schema change needed — plan_type is a free-text
-- column already." That was wrong: profiles_plan_chk (0055) still only
-- allows ('lapak','sultan','king'), so every "prof" Unclaimed-Owner invite
-- (users/page.tsx's generateUnclaimedInvite, lifetime:true) has been
-- failing account creation at /join with:
--   new row for relation "profiles" violates check constraint
--   "profiles_plan_chk"
-- since the day 0100 shipped — caught via a real failed signup (Nico).
-- =====================================================================

alter table profiles drop constraint if exists profiles_plan_chk;
alter table profiles add constraint profiles_plan_chk
  check (plan_type is null or plan_type in ('lapak','sultan','king','prof'));
