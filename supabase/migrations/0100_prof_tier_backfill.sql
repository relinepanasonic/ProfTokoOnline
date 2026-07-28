-- =====================================================================
-- 0100: Introduce the "Prof" tier.
--
-- Business model clarified: existing Owner (branch_manager) accounts are
-- almost all agency-managed real clients — our team uploads their 5 core
-- Shopee files for them (Store/Product/Ads Performa + GMV Auto + Group
-- Ads). Going forward these are labeled "Prof" (plan_type='prof',
-- lifetime — see PLAN_LABEL in layout.tsx, PLANS in users/page.tsx, and
-- the isProf lock in UploadHere.tsx which hides the 5-core-file section
-- for them but keeps Order Complete + Finance Detail self-serve).
--
-- Self-registered SaaS signups (/register) keep the existing three-tier
-- plan set — Juragan (relabeled "lapak" value, unchanged), Sultan, King —
-- unaffected by this migration.
--
-- No schema change needed: plan_type is a free-text column on both
-- `profiles` and `invites` already (see 0011 / 0095), so 'prof' is just a
-- new value, not a new column.
--
-- Exclusion matching: the first preview run turned up "ade dwijayanto"
-- (display_name has a SPACE) surviving an exact match against the typed
-- exclusion "adedwijayanto" — so this compares with whitespace stripped,
-- not just lowercased, across display_name/username/scope_owner/email.
--
-- ── Run the SELECT below FIRST and eyeball the list before running the
-- UPDATE — this touches every existing real-client Owner account. ──
-- =====================================================================

-- Preview: every branch_manager profile this migration WILL retag to
-- plan_type='prof' (excludes the 3 named test/SaaS accounts, matched
-- whitespace-insensitively against display_name, username, scope_owner,
-- and email-local-part so spacing/casing differences don't slip through).
select id, display_name, username, scope_owner, email, plan_type, subscription_end
from profiles
where role = 'branch_manager'
  and regexp_replace(lower(coalesce(display_name, '')), '\s+', '', 'g')
        not in ('adedwijayanto', 'christianhandoko', 'nicotest')
  and regexp_replace(lower(coalesce(username, '')), '\s+', '', 'g')
        not in ('adedwijayanto', 'christianhandoko', 'nicotest')
  and regexp_replace(lower(coalesce(scope_owner, '')), '\s+', '', 'g')
        not in ('adedwijayanto', 'christianhandoko', 'nicotest')
  and regexp_replace(lower(coalesce(split_part(email, '@', 1), '')), '\s+', '', 'g')
        not in ('adedwijayanto', 'christianhandoko', 'nicotest')
order by display_name;

-- Once the preview above looks right, uncomment and run:
--
-- update profiles
-- set plan_type = 'prof', subscription_end = null
-- where role = 'branch_manager'
--   and regexp_replace(lower(coalesce(display_name, '')), '\s+', '', 'g')
--         not in ('adedwijayanto', 'christianhandoko', 'nicotest')
--   and regexp_replace(lower(coalesce(username, '')), '\s+', '', 'g')
--         not in ('adedwijayanto', 'christianhandoko', 'nicotest')
--   and regexp_replace(lower(coalesce(scope_owner, '')), '\s+', '', 'g')
--         not in ('adedwijayanto', 'christianhandoko', 'nicotest')
--   and regexp_replace(lower(coalesce(split_part(email, '@', 1), '')), '\s+', '', 'g')
--         not in ('adedwijayanto', 'christianhandoko', 'nicotest');
