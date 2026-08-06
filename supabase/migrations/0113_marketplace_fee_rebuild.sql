-- =====================================================================
-- 0113: Replace the standalone "Market Place Fee" page/table with the
-- Marketplace Fee tab under Price Calculator, matching the reference
-- implementation already stable in the sibling project.
--
-- Explicit instruction: drop the old market_fees/market_fee_log (2,800+
-- rows from the old sheet-import workflow) and rebuild on the reference's
-- own schema — the user will re-populate via a fresh CSV upload (July
-- data) after this ships, so no data migration is needed or wanted here.
--
-- CASCADE also removes the RPCs that referenced the old table
-- (market_fee_search, market_fee_filters, update_market_fee_field,
-- save_market_fee_row from 0038/0039/0112) since none of them survive
-- the schema change — the new page doesn't use RPCs, it reads/writes
-- market_fees directly under RLS, matching the reference.
-- =====================================================================

drop function if exists market_fee_search(text, text, text, int, int);
drop function if exists market_fee_filters();
drop function if exists update_market_fee_field(bigint, text, numeric, text);
drop function if exists save_market_fee_row(bigint, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text);

drop table if exists market_fee_edits cascade;
drop table if exists market_fee_log cascade;
drop table if exists market_fees cascade;

create table market_fees (
  id                            uuid primary key default gen_random_uuid(),
  client_id                     uuid not null references clients(id) on delete cascade,

  category                      text not null,
  sub_category                  text,
  jenis_product                 text,
  platform                      text not null,
  jenis_toko                    text,

  platform_fee_pct              numeric not null default 0,
  biaya_proses_pesanan_rp       numeric not null default 0,
  biaya_layanan_mall_pct        numeric not null default 0,
  kategori_kirim                text,
  min_gratis_ongkir_biasa_pct   numeric not null default 0,
  max_gratis_ongkir_biasa_rp    numeric not null default 0,
  min_gratis_ongkir_khusus_pct  numeric not null default 0,
  max_gratis_ongkir_khusus_rp   numeric not null default 0,
  min_promo_xtra_pct            numeric not null default 0,
  max_promo_xtra_rp             numeric not null default 0,   -- Rp cap, not a percent
  spaylater_xtra_3mo_pct        numeric not null default 0,
  spaylater_xtra_6mo_pct        numeric not null default 0,

  updated_by                    text,   -- display name of whoever last edited the numbers
  updated_month                 text,   -- e.g. "Juli 2026" — month granularity only, no exact date

  created_at                    timestamptz not null default now(),
  unique (client_id, category, sub_category, jenis_product, platform, jenis_toko)
);

-- One row per edit event — full numeric snapshot + "who changed it, in
-- which month" (no timestamp shown in the UI; created_at is bookkeeping).
create table market_fee_edits (
  id                            uuid primary key default gen_random_uuid(),
  fee_id                        uuid not null references market_fees(id) on delete cascade,
  edited_by                     text not null,
  edited_month                  text not null,
  platform_fee_pct              numeric,
  biaya_proses_pesanan_rp       numeric,
  biaya_layanan_mall_pct        numeric,
  kategori_kirim                text,
  min_gratis_ongkir_biasa_pct   numeric,
  max_gratis_ongkir_biasa_rp    numeric,
  min_gratis_ongkir_khusus_pct  numeric,
  max_gratis_ongkir_khusus_rp   numeric,
  min_promo_xtra_pct            numeric,
  max_promo_xtra_rp             numeric,
  spaylater_xtra_3mo_pct        numeric,
  spaylater_xtra_6mo_pct        numeric,
  created_at                    timestamptz not null default now()
);

create index if not exists market_fees_client_idx   on market_fees (client_id);
create index if not exists market_fees_category_idx on market_fees (client_id, category);
create index if not exists market_fees_platform_idx on market_fees (client_id, platform);
create index if not exists market_fee_edits_fee_idx  on market_fee_edits (fee_id);

alter table market_fees      enable row level security;
alter table market_fee_edits enable row level security;

-- Read: own client, or superadmin. Write: superadmin/client_admin only —
-- matches the write-role set the old market_fees table used, and the
-- role this project's Upload/Finance/Ads flows already reserve for
-- tenant-level admin actions.
drop policy if exists market_fees_read  on market_fees;
drop policy if exists market_fees_write on market_fees;
create policy market_fees_read on market_fees
  for select using (client_id = my_client_id() or my_role()::text = 'superadmin');
create policy market_fees_write on market_fees
  for all using (my_role()::text in ('superadmin','client_admin'))
  with check (my_role()::text in ('superadmin','client_admin'));

drop policy if exists market_fee_edits_read  on market_fee_edits;
drop policy if exists market_fee_edits_write on market_fee_edits;
create policy market_fee_edits_read on market_fee_edits
  for select using (exists (
    select 1 from market_fees f where f.id = fee_id
    and (f.client_id = my_client_id() or my_role()::text = 'superadmin')
  ));
create policy market_fee_edits_write on market_fee_edits
  for insert with check (my_role()::text in ('superadmin','client_admin'));

notify pgrst, 'reload config';
