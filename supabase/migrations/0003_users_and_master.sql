-- =====================================================================
-- Stage 9: Users management + Core List (master data)
-- Safe to re-run.
-- =====================================================================

-- ---------- profiles: store email for the Users list ----------
alter table profiles add column if not exists email text;

-- ---------- master_data: the Core List behind every dropdown ----------
drop table if exists master_data cascade;
create table master_data (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  kind       text not null check (kind in ('city','dealer','brand','product_type')),
  value      text not null,
  pic        text,   -- city: its PIC Panasonic; dealer: PIC inherited from its city
  city       text,   -- dealer: which city it belongs to
  created_at timestamptz not null default now(),
  unique (client_id, kind, value)
);
create index master_data_client_kind_idx on master_data (client_id, kind);

alter table master_data enable row level security;

-- superadmin: everything
create policy master_super_all on master_data
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');
-- everyone in a client can read its lists (needed for Upload dropdowns)
create policy master_client_read on master_data
  for select using (client_id = my_client_id());
-- client_admin can manage its client's lists
create policy master_admin_write on master_data
  for all
  using (client_id = my_client_id() and my_role() = 'client_admin')
  with check (client_id = my_client_id() and my_role() = 'client_admin');
