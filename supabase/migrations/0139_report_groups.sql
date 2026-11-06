-- =====================================================================
-- 0139: report_groups — one WhatsApp group per Owner for the weekly report.
--
-- The weekly report (GET /api/reports/weekly, called by Make.com) sends each Owner's stores
-- to that Owner's own WhatsApp group. group_id is the gateway's group id
-- (e.g. 1203630xxxxxxxxxx@g.us). Only admins (superadmin / client_admin) can see or edit it;
-- the report endpoint reads it with the service role.
-- =====================================================================

create table if not exists report_groups (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  owner        text not null,
  group_id     text not null default '',
  enabled      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, owner)
);

alter table report_groups enable row level security;

drop policy if exists report_groups_admin on report_groups;
create policy report_groups_admin on report_groups
  for all
  using (
    (select my_role())::text = 'superadmin'
    or ((select my_role())::text = 'client_admin' and client_id = (select my_client_id()))
  )
  with check (
    (select my_role())::text = 'superadmin'
    or ((select my_role())::text = 'client_admin' and client_id = (select my_client_id()))
  );

notify pgrst, 'reload config';
