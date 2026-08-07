-- =====================================================================
-- 0114: Massive Calculator — price_calc_items.
--
-- One row per product a seller is pricing. Each row links to a
-- market_fees row by the same 5-field key (category, sub_category,
-- jenis_product, platform, jenis_toko) so Total Biaya/Profit can be
-- computed live client-side from the matched fee numbers — no join
-- needed server-side, same "fetch once, compute in the browser" pattern
-- MarketFeeTable.tsx already uses at this row count.
--
-- Unlike market_fees (a shared fee-rule table admins maintain), these are
-- a seller's own working calculator rows — branch_manager (Owner) gets
-- write access here too, not just superadmin/client_admin.
-- =====================================================================

create table if not exists price_calc_items (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,

  item_name         text not null,

  modal_produk_rp   numeric not null default 0,
  harga_jual_rp     numeric not null default 0,

  -- Drive the Ukuran Biasa/Khusus split in the Gratis Ongkir formula:
  -- Khusus when weight_kg > 5 OR volume_cm3 > 20000, else Biasa.
  weight_kg         numeric not null default 0,
  volume_cm3        numeric not null default 0,

  -- Same field names as market_fees' own 5-key columns on purpose — this
  -- IS the lookup key (category doubles as both the product's own display
  -- category and the fee-match key, matching the reference's single
  -- "Category (Fee)" column, which just confirms what matched rather than
  -- being a separate attribute). Plain text, not a foreign key into
  -- market_fees, so a product stays readable even if its matching fee row
  -- is later renamed or removed — the lookup just falls back to "no fee
  -- matched" instead of the whole row breaking.
  category          text,
  sub_category      text,
  jenis_product     text,
  platform          text,
  jenis_toko        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists price_calc_items_client_idx on price_calc_items (client_id);

alter table price_calc_items enable row level security;

drop policy if exists price_calc_items_read  on price_calc_items;
drop policy if exists price_calc_items_write on price_calc_items;
create policy price_calc_items_read on price_calc_items
  for select using (client_id = my_client_id() or my_role()::text = 'superadmin');
-- client_id = my_client_id() is required in BOTH using and with check, not
-- just a role check — without it, any client_admin/branch_manager could
-- write to another tenant's rows by specifying a different client_id
-- (this exact gap was inherited into 0113's market_fees_write and is
-- patched in 0115 for that table).
create policy price_calc_items_write on price_calc_items
  for all
  using (
    (client_id = my_client_id() and my_role()::text in ('client_admin','branch_manager'))
    or my_role()::text = 'superadmin'
  )
  with check (
    (client_id = my_client_id() and my_role()::text in ('client_admin','branch_manager'))
    or my_role()::text = 'superadmin'
  );

notify pgrst, 'reload config';
