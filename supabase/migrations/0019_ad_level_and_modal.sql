-- =====================================================================
-- 0019: Ads Level (4 tiers) + editable Modal Harian
--   - ad_groups.ads_level : 'incubation' | 'hero' | 'regular' | 'low_conversion'
--     (chosen at upload, applies to the whole Grup Iklan file)
--   - ad_modals           : advertiser-entered daily budget (Modal/hari)
--     per (store, grup, year, month, week) — editable inline, survives re-upload
-- =====================================================================

-- ── ads_level on ad_groups ────────────────────────────────────────────────────
alter table ad_groups add column if not exists ads_level text;
create index if not exists ad_groups_level_idx on ad_groups (client_id, ads_level);

-- ── ad_modals (manual daily budget) ───────────────────────────────────────────
create table if not exists ad_modals (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references clients(id) on delete cascade,
  store_name   text not null,
  grup_iklan   text not null,
  year         int  not null,
  month        text not null,
  week         text not null,
  modal_harian numeric,
  updated_at   timestamptz not null default now(),
  unique (client_id, store_name, grup_iklan, year, month, week)
);

alter table ad_modals enable row level security;

drop policy if exists ad_modals_super_all   on ad_modals;
drop policy if exists ad_modals_client_read  on ad_modals;
drop policy if exists ad_modals_client_write on ad_modals;

create policy ad_modals_super_all on ad_modals
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

create policy ad_modals_client_read on ad_modals
  for select using (
    client_id = my_client_id()
    and my_role()::text in ('client_admin','advertiser','branch_manager')
  );

create policy ad_modals_client_write on ad_modals
  for all
  using      (client_id = my_client_id() and my_role()::text in ('client_admin','advertiser'))
  with check (client_id = my_client_id() and my_role()::text in ('client_admin','advertiser'));
