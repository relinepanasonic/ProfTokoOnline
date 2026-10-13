-- =====================================================================
-- 0127: Kampus Online workshop schedule, managed from /workshops in the
-- dashboard (superadmin only) and read by the public marketing site
-- (profesoronline.id/kampus/ and /kampus/workshop/) with the anon key.
-- Only published events are visible to the public; nothing sensitive is
-- stored here (it is the same info shown on the landing page).
-- =====================================================================

create table if not exists workshop_events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  starts_at    timestamptz not null,
  mode         text not null default 'online' check (mode in ('offline', 'online')),
  place        text not null default '',
  address      text not null default '',
  city         text not null default '',
  seats_total  int  not null default 30 check (seats_total > 0),
  seats_taken  int  not null default 0  check (seats_taken >= 0),
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists workshop_events_starts_idx on workshop_events (starts_at);

alter table workshop_events enable row level security;

drop policy if exists workshop_events_public_read on workshop_events;
create policy workshop_events_public_read on workshop_events
  for select to anon, authenticated using (published);

drop policy if exists workshop_events_super on workshop_events;
create policy workshop_events_super on workshop_events
  for all to authenticated
  using ((select my_role())::text = 'superadmin')
  with check ((select my_role())::text = 'superadmin');

grant select on workshop_events to anon;
grant select, insert, update, delete on workshop_events to authenticated;

-- First event: the 21 Nov 2026 batch (12:00 WIB), online.
insert into workshop_events (title, starts_at, mode, seats_total, seats_taken)
select 'Kampus Online: Bosan Boncos, Belajar untuk Cuan', '2026-11-21T12:00:00+07:00', 'online', 30, 20
where not exists (select 1 from workshop_events);

notify pgrst, 'reload config';
