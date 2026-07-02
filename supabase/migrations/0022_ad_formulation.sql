-- =====================================================================
-- 0022: Ad Formulation thresholds (per client, per month)
--   The 8 manual numbers that drive the "Analisa" recommendation column
--   in Ads Performance drill-down:
--     incubation_spent / incubation_roas
--     hero_spent       / hero_roas
--     independent_spent/ independent_roas   (Independent == the "Regular" level)
--     low_conversion_spent / low_conversion_roas
--
--   Switch rules (per product, using the product's monthly Biaya + ROAS):
--     Incubation  → "Switch to Hero Group"         if roas > incubation_roas AND biaya > incubation_spent
--     Hero        → "Switch to Independent Ads"     if roas > hero_roas       AND biaya > hero_spent
--     Hero        → "Switch to Low Conversion"      if roas < low_conversion_roas AND biaya > low_conversion_spent
--     Independent → "Switch to Hero Group"          if roas < independent_roas AND biaya > independent_spent
-- =====================================================================

create table if not exists ad_formulation (
  id                   bigint generated always as identity primary key,
  client_id            uuid not null references clients(id) on delete cascade,
  year                 int  not null,
  month                text not null,
  incubation_spent     numeric,
  incubation_roas      numeric,
  hero_spent           numeric,
  hero_roas            numeric,
  independent_spent    numeric,
  independent_roas     numeric,
  low_conversion_spent numeric,
  low_conversion_roas  numeric,
  updated_at           timestamptz not null default now(),
  unique (client_id, year, month)
);

alter table ad_formulation enable row level security;

drop policy if exists ad_formulation_super_all    on ad_formulation;
drop policy if exists ad_formulation_client_read   on ad_formulation;
drop policy if exists ad_formulation_client_write  on ad_formulation;

create policy ad_formulation_super_all on ad_formulation
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

create policy ad_formulation_client_read on ad_formulation
  for select using (
    client_id = my_client_id()
    and my_role()::text in ('client_admin','advertiser','branch_manager')
  );

create policy ad_formulation_client_write on ad_formulation
  for all
  using      (client_id = my_client_id() and my_role()::text in ('client_admin','advertiser'))
  with check (client_id = my_client_id() and my_role()::text in ('client_admin','advertiser'));
