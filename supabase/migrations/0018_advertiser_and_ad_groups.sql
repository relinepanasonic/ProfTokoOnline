-- =====================================================================
-- 0018: Advertiser role + Ad Groups (Grup Iklan) analysis
--   1. New user_role 'advertiser'  — sees Dashboard + Ads Performance,
--      uploads Grup Iklan files. Client-wide read scope (like admin).
--   2. New data_source 'ads_group' — the per-ad-group Shopee export.
--   3. New table ad_groups          — one row per ad/product line, tagged
--      level = 'group' (the Grup total) | 'product' (item inside the group).
--   4. RLS so advertiser/admin/superadmin can read+write within their client.
--
-- NOTE: we compare role via my_role()::text = '...'   (never 'advertiser'::user_role)
-- so this whole script is safe to run in one go right after ADD VALUE — a new
-- enum literal can't be *used* in the same transaction, but a text compare can.
-- =====================================================================

-- ── 1. enum additions ─────────────────────────────────────────────────────────
alter type user_role   add value if not exists 'advertiser';
alter type data_source add value if not exists 'ads_group';

-- ── 2. ad_groups table ────────────────────────────────────────────────────────
create table if not exists ad_groups (
  id                 bigint generated always as identity primary key,
  client_id          uuid not null references clients(id) on delete cascade,
  upload_id          uuid references uploads(id) on delete cascade,

  -- dimensions (manual, entered at upload — same as the SPOS/Ads upload form)
  year               int,
  month              text,          -- Indonesian month name ("Juni")
  week               text,          -- "Week 1" … "Week 5"
  store_name         text,
  pic_client         text,          -- owner
  brand              text,

  -- the ad group this row belongs to ("Grup Hero")
  grup_iklan         text,
  level              text not null default 'product',  -- 'group' | 'product'
  item_name          text,          -- product name (= grup name on the group row)
  kode_produk        text,

  -- metrics straight from the file
  dilihat            numeric,       -- impressions
  klik               numeric,       -- clicks
  konversi           numeric,
  konversi_langsung  numeric,
  produk_terjual     numeric,
  terjual_langsung   numeric,
  omzet              numeric,       -- Omzet Penjualan (total sales from ads)
  penjualan_langsung numeric,       -- Penjualan Langsung (GMV Langsung)
  biaya              numeric,       -- cost
  roas               numeric,       -- Efektifitas Iklan (= Omzet / Biaya)
  roas_langsung      numeric,       -- Efektivitas Langsung

  periode_start      date,
  periode_end        date,
  raw                jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists ad_groups_dims_idx
  on ad_groups (client_id, year, month, week, store_name, grup_iklan);
create index if not exists ad_groups_upload_idx on ad_groups (upload_id);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
alter table ad_groups enable row level security;

drop policy if exists ad_groups_super_all    on ad_groups;
drop policy if exists ad_groups_client_read   on ad_groups;
drop policy if exists ad_groups_client_write  on ad_groups;

create policy ad_groups_super_all on ad_groups
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

-- read: admin, advertiser and owner (branch_manager) within their client
create policy ad_groups_client_read on ad_groups
  for select using (
    client_id = my_client_id()
    and my_role()::text in ('client_admin','advertiser','branch_manager')
  );

-- write: admin + advertiser within their client (uploads also use service role)
create policy ad_groups_client_write on ad_groups
  for all
  using      (client_id = my_client_id() and my_role()::text in ('client_admin','advertiser'))
  with check (client_id = my_client_id() and my_role()::text in ('client_admin','advertiser'));

-- ── 4. let advertiser read the Dashboard data (sales_rows) + uploads ──────────
drop policy if exists sales_advertiser_read   on sales_rows;
create policy sales_advertiser_read on sales_rows
  for select using (client_id = my_client_id() and my_role()::text = 'advertiser');

drop policy if exists uploads_advertiser_read on uploads;
create policy uploads_advertiser_read on uploads
  for select using (client_id = my_client_id() and my_role()::text = 'advertiser');

-- advertiser also needs to write the uploads audit row (also done via service role)
drop policy if exists uploads_advertiser_write on uploads;
create policy uploads_advertiser_write on uploads
  for all
  using      (client_id = my_client_id() and my_role()::text = 'advertiser')
  with check (client_id = my_client_id() and my_role()::text = 'advertiser');

-- ── 5. allow 'advertiser' in the invites role check ───────────────────────────
do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'invites'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%';
  if cname is not null then
    execute format('alter table invites drop constraint %I', cname);
  end if;
end $$;

alter table invites add constraint invites_role_check
  check (role in ('branch_manager','client_admin','store_user','advertiser'));
