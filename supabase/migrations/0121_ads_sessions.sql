-- =====================================================================
-- 0121: Ads Photo Capture -> session-based flow.
--
-- Redesigned flow: staff pick a Store, click "Record Ads", and — inside
-- ONE recording session (a staff member checking ads 2-3x/day) — upload
-- 2-5 screenshots that all feed into one running draft table before a
-- single Save. ads_sessions is the new parent: one row per "Record Ads"
-- click, timestamped automatically (created_at — never user-editable,
-- that's the log's Date & Time column). ads_photo_captures now holds one
-- row per IMAGE within a session (many per session_id, was previously
-- 1:1 with a "capture"); ads_photo_capture_items now links to the
-- session directly (session_id) since a manually-added or manually-
-- retyped row may not trace back to one specific screenshot at all —
-- capture_id on that table is therefore relaxed to nullable.
--
-- Old owner/brand/store_name/year/month columns on ads_photo_captures/
-- ads_photo_capture_items are kept (nullable, unused by new inserts
-- going forward) rather than dropped — no data has been lost by this
-- being an additive migration, and the old test rows from before this
-- flow existed stay queryable.
-- =====================================================================

create table if not exists ads_sessions (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  owner       text,
  brand       text,
  store_name  text not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()   -- the log's Date & Time stamp; not user-editable
);
create index if not exists ads_sessions_client_idx on ads_sessions (client_id, store_name, created_at desc);

alter table ads_photo_captures
  add column if not exists session_id uuid references ads_sessions(id) on delete cascade;
create index if not exists ads_photo_captures_session_idx on ads_photo_captures (session_id);

alter table ads_photo_capture_items
  add column if not exists session_id uuid references ads_sessions(id) on delete cascade;
alter table ads_photo_capture_items
  alter column capture_id drop not null;
create index if not exists ads_photo_capture_items_session_idx on ads_photo_capture_items (session_id);

alter table ads_sessions enable row level security;

drop policy if exists ads_sessions_staff_all on ads_sessions;
create policy ads_sessions_staff_all on ads_sessions
  for all using (
    (select my_role())::text = 'superadmin'
    or ((select my_role())::text = 'advertiser' and client_id = (select my_client_id()))
  )
  with check (
    (select my_role())::text = 'superadmin'
    or ((select my_role())::text = 'advertiser' and client_id = (select my_client_id()))
  );

notify pgrst, 'reload config';
