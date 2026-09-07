-- =====================================================================
-- 0122: Backfill profiles broken by the superadmin-invite client_id bug.
--
-- /api/invites (POST) fell back to the CALLER's own client_id whenever
-- the request didn't supply one — the manual "+ Invite User" form never
-- does. Superadmin's own client_id is NULL by design, so every account a
-- superadmin invited that way (any role — Admin, Advertiser, or Owner
-- via that button rather than Unclaimed Owners) got client_id = NULL.
-- Every RLS policy in this app checks client_id = my_client_id(), and
-- NULL never equals NULL in SQL, so that login could see NO data
-- anywhere — the exact "Upload the Data First" blur reported for the
-- Advertiser Devi despite data already existing. Fixed prospectively in
-- the same commit (route now falls back to the first-created client,
-- same convention used everywhere else for a superadmin-less client_id);
-- this backfills the accounts already broken by it.
--
-- Only superadmin is EVER supposed to have client_id = NULL "by design"
-- (established rule, referenced throughout this project's migrations) —
-- so any other role sitting on NULL here is this exact bug, not a
-- legitimate state.
-- =====================================================================

update profiles
set client_id = (select id from clients order by created_at limit 1)
where client_id is null
  and role <> 'superadmin';
