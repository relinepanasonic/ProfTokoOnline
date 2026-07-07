-- =====================================================================
-- 0038: Market Place Fee — editable in-app (was a read-only Google Sheet)
--
-- Seeded once from the user's "Market Place Fee" tab (2837 rows: Category >
-- Sub Category > Jenis Product, per Platform + Jenis Toko — verified against
-- the real sheet export). From now on the numbers are edited directly in
-- this app, not the sheet.
--
-- Fee updates happen monthly, not daily — market_fee_log records WHICH
-- MONTH an edit applies to and WHO made it, not a per-edit timestamp (the
-- UI never surfaces created_at; it's kept only for internal ordering).
-- =====================================================================

create table if not exists market_fees (
  id                     bigint generated always as identity primary key,
  client_id              uuid not null references clients(id) on delete cascade,

  category               text not null,
  sub_category           text not null,
  jenis_product          text not null,
  platform               text not null,
  jenis_toko             text not null,

  platform_fee           numeric,  -- %
  biaya_proses_pesanan   numeric,  -- Rp
  biaya_layanan_mall     numeric,  -- %
  kategori_kirim         text,
  min_go_biasa           numeric,  -- %
  max_go_biasa           numeric,  -- Rp
  min_go_khusus          numeric,  -- %
  max_go_khusus          numeric,  -- Rp
  min_promo_xtra         numeric,  -- %
  max_promo_xtra         numeric,  -- Rp
  spaylater_3mo          numeric,  -- %
  spaylater_6mo          numeric,  -- %

  updated_at             timestamptz,
  updated_by             uuid references profiles(id),
  updated_month          text,     -- last month an editable field was changed

  created_at             timestamptz not null default now(),
  unique (client_id, category, sub_category, jenis_product, platform, jenis_toko)
);

create index if not exists market_fees_client_idx on market_fees (client_id);
create index if not exists market_fees_platform_idx on market_fees (client_id, platform, jenis_toko);

alter table market_fees enable row level security;

drop policy if exists market_fees_super_all on market_fees;
create policy market_fees_super_all on market_fees
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

drop policy if exists market_fees_client_read on market_fees;
create policy market_fees_client_read on market_fees
  for select using (
    client_id = my_client_id()
    and my_role()::text in ('client_admin', 'branch_manager', 'advertiser', 'store_user')
  );

drop policy if exists market_fees_client_write on market_fees;
create policy market_fees_client_write on market_fees
  for update
  using      (client_id = my_client_id() and my_role()::text = 'client_admin')
  with check (client_id = my_client_id() and my_role()::text = 'client_admin');

-- ── market_fee_log — month + editor only, never a raw date in the UI ────────
create table if not exists market_fee_log (
  id             bigint generated always as identity primary key,
  client_id      uuid not null references clients(id) on delete cascade,
  market_fee_id  bigint not null references market_fees(id) on delete cascade,
  field_name     text not null,
  old_value      numeric,
  new_value      numeric,
  month          text not null,
  edited_by      uuid references profiles(id),
  edited_by_name text,
  created_at     timestamptz not null default now()
);

create index if not exists market_fee_log_fee_idx on market_fee_log (market_fee_id);
create index if not exists market_fee_log_client_idx on market_fee_log (client_id, month);

alter table market_fee_log enable row level security;

drop policy if exists market_fee_log_super_all on market_fee_log;
create policy market_fee_log_super_all on market_fee_log
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

drop policy if exists market_fee_log_client_read on market_fee_log;
create policy market_fee_log_client_read on market_fee_log
  for select using (
    client_id = my_client_id()
    and my_role()::text in ('client_admin', 'branch_manager', 'advertiser', 'store_user')
  );

drop policy if exists market_fee_log_client_insert on market_fee_log;
create policy market_fee_log_client_insert on market_fee_log
  for insert
  with check (client_id = my_client_id() and my_role()::text = 'client_admin');

-- ── filters (server-side DISTINCT — table has 2800+ rows) ───────────────────
create or replace function market_fee_filters() returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'platforms',   (select coalesce(jsonb_agg(distinct platform order by platform), '[]') from market_fees),
    'jenis_toko',  (select coalesce(jsonb_agg(distinct jenis_toko order by jenis_toko), '[]') from market_fees)
  );
$$;

-- ── search (server-side, paginated) ──────────────────────────────────────────
create or replace function market_fee_search(
  p_query    text default null,
  p_platform text default null,
  p_toko     text default null,
  p_limit    int  default 100,
  p_offset   int  default 0
) returns jsonb
language sql stable
as $$
  with f as (
    select *
    from market_fees
    where (p_platform is null or platform   = p_platform)
      and (p_toko     is null or jenis_toko = p_toko)
      and (p_query is null or p_query = '' or (
            category      ilike '%' || p_query || '%'
         or sub_category   ilike '%' || p_query || '%'
         or jenis_product  ilike '%' || p_query || '%'
      ))
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', (select coalesce(jsonb_agg(x), '[]') from (
        select * from f
        order by category, sub_category, jenis_product, platform, jenis_toko
        limit p_limit offset p_offset
      ) x)
  );
$$;

-- ── edit a single fee field + log it (whitelisted columns only) ─────────────
create or replace function update_market_fee_field(
  p_id      bigint,
  p_field   text,
  p_value   numeric,
  p_month   text
) returns market_fees
language plpgsql
as $$
declare
  allowed text[] := array[
    'platform_fee','biaya_proses_pesanan','biaya_layanan_mall',
    'min_go_biasa','max_go_biasa','min_go_khusus','max_go_khusus',
    'min_promo_xtra','max_promo_xtra','spaylater_3mo','spaylater_6mo'
  ];
  old_val   numeric;
  fee_client uuid;
  editor_name text;
  result market_fees;
begin
  if not (p_field = any(allowed)) then
    raise exception 'field % is not editable', p_field;
  end if;

  select client_id into fee_client from market_fees where id = p_id;
  if fee_client is null or fee_client <> my_client_id() then
    raise exception 'not found';
  end if;

  execute format('select %I from market_fees where id = $1', p_field) into old_val using p_id;
  select coalesce(display_name, username, 'Unknown') into editor_name from profiles where id = auth.uid();

  execute format(
    'update market_fees set %I = $1, updated_at = now(), updated_by = $2, updated_month = $3 where id = $4',
    p_field
  ) using p_value, auth.uid(), p_month, p_id;

  insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
  values (fee_client, p_id, p_field, old_val, p_value, p_month, auth.uid(), editor_name);

  select * into result from market_fees where id = p_id;
  return result;
end;
$$;

notify pgrst, 'reload config';
