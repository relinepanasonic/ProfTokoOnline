-- =====================================================================
-- 0071: Modal Product rebuild #2 — replace product_avg_price() (a live,
-- full-history scan of sales_rows on every page load, averaging price
-- across ALL uploaded weeks/months ever) with a maintained product_catalog
-- table, refreshed once per SPOS upload — same rollup pattern already used
-- for dashboard_rollup (0052) and ads_rollup (0067).
--
-- Why this had to change, not just be filtered differently:
--   1. "213 product and variant (all together)" — product_avg_price()'s
--      leaf rule already included zero-sale rows, but there was no
--      persistent identity: every request re-derived the catalog from
--      scratch by scanning every historical spos row for that owner/store,
--      so a product that only ever appeared in an OLDER upload (a
--      different week/month than the one currently selected in the Owner/
--      Store filter, or before a period with 0 sales) could silently drop
--      out depending on which rows happened to match the filter that call.
--   2. Uploading the same store's Product Performa every week re-inserts
--      the SAME 213 rows into sales_rows each time (that's intentional —
--      sales_rows is a transaction log, not a catalog). product_catalog is
--      the missing piece: one row per (client_id, kode_produk, kode_variasi)
--      — a real unique constraint — upserted (not appended) on every
--      refresh, so re-uploading the same period never creates duplicates.
--   3. Unchanged: products with variants get their real variant rows
--      (has_variant=true, editable) PLUS a '-' placeholder row carrying the
--      product's own parent/rollup data (has_variant=true, locked in the
--      UI — see ModalProduct.tsx). Products without variants get a single
--      '-' row (has_variant=false, editable), from their own parent row.
--   4. avg/last price is still Penjualan (Pesanan Siap Dikirim) (IDR) ÷
--      Produk (Pesanan Siap Dikirim) — sales_idr / units — unchanged math.
--   5. NEW: price is no longer averaged across all history. For each
--      (kode_produk, kode_variasi), find its most recent (year, month)
--      across every upload, then compute sales_idr/units using ONLY that
--      period's rows (summed across any same-month weekly uploads).
-- =====================================================================

create table if not exists product_catalog (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references clients(id) on delete cascade,
  kode_produk  text not null,
  kode_variasi text not null default '-',
  nama_produk  text,
  nama_variasi text,
  has_variant  boolean not null default false,
  last_price   numeric,
  last_year    int,
  last_month   text,
  pic_client   text,
  store_name   text,
  updated_at   timestamptz not null default now(),
  unique (client_id, kode_produk, kode_variasi)
);

alter table product_catalog enable row level security;

drop policy if exists product_catalog_super_all on product_catalog;
create policy product_catalog_super_all on product_catalog
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

drop policy if exists product_catalog_staff_read on product_catalog;
create policy product_catalog_staff_read on product_catalog
  for select using (client_id = my_client_id() and my_role()::text in ('client_admin', 'branch_manager'));

create index if not exists product_catalog_client_idx on product_catalog(client_id);

create or replace function refresh_product_catalog() returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
  with base as (
    select
      client_id,
      nullif(trim(raw->>'Kode Produk'), '') as kode_produk,
      item_name as nama_produk,
      nullif(nullif(trim(raw->>'Kode Variasi'), '-'), '') as kode_variasi,
      nullif(trim(raw->>'Nama Variasi'), '-') as nama_variasi,
      is_parent, sales_idr, units, year, month, pic_client, store_name
    from sales_rows
    where source = 'spos'
  ),
  filtered as (
    select * from base where kode_produk is not null
  ),
  flagged as (
    select *, bool_or(kode_variasi is not null) over (partition by client_id, kode_produk) as has_variant
    from filtered
  ),
  -- Every displayed row: real variant leaves (has_variant products only),
  -- plus one '-' row per product from its own parent/rollup rows — for
  -- variant products this becomes the locked placeholder; for variant-less
  -- products it's the single editable row (has_variant=false).
  all_rows as (
    select client_id, kode_produk, kode_variasi, nama_produk, nama_variasi,
      true as has_variant, sales_idr, units, year, month, pic_client, store_name
    from flagged where has_variant and kode_variasi is not null
    union all
    select client_id, kode_produk, '-'::text as kode_variasi, nama_produk, null::text as nama_variasi,
      has_variant, sales_idr, units, year, month, pic_client, store_name
    from flagged where is_parent
  ),
  ranked as (
    select *,
      row_number() over (
        partition by client_id, kode_produk, kode_variasi
        order by year desc nulls last,
          coalesce(array_position(
            array['Januari','Februari','Maret','April','Mei','Juni','Juli',
                  'Agustus','September','Oktober','November','Desember'], month), 0) desc nulls last
      ) as rn
    from all_rows
  ),
  latest_meta as (
    select client_id, kode_produk, kode_variasi, nama_produk, nama_variasi, has_variant, year, month, pic_client, store_name
    from ranked where rn = 1
  ),
  latest_price as (
    select r.client_id, r.kode_produk, r.kode_variasi,
      case when sum(r.units) > 0 then sum(r.sales_idr) / sum(r.units) else null end as price
    from all_rows r
    join latest_meta m
      on m.client_id = r.client_id and m.kode_produk = r.kode_produk and m.kode_variasi = r.kode_variasi
      and m.year is not distinct from r.year and m.month is not distinct from r.month
    group by r.client_id, r.kode_produk, r.kode_variasi
  )
  insert into product_catalog (
    client_id, kode_produk, kode_variasi, nama_produk, nama_variasi, has_variant,
    last_price, last_year, last_month, pic_client, store_name, updated_at
  )
  select m.client_id, m.kode_produk, m.kode_variasi, m.nama_produk, m.nama_variasi, m.has_variant,
    p.price, m.year, m.month, m.pic_client, m.store_name, now()
  from latest_meta m
  left join latest_price p
    on p.client_id = m.client_id and p.kode_produk = m.kode_produk and p.kode_variasi = m.kode_variasi
  on conflict (client_id, kode_produk, kode_variasi) do update set
    nama_produk = excluded.nama_produk,
    nama_variasi = excluded.nama_variasi,
    has_variant = excluded.has_variant,
    last_price = excluded.last_price,
    last_year = excluded.last_year,
    last_month = excluded.last_month,
    pic_client = excluded.pic_client,
    store_name = excluded.store_name,
    updated_at = now();
end $$;

grant execute on function refresh_product_catalog() to authenticated, service_role;

-- Backfill immediately from all existing historical spos uploads.
select refresh_product_catalog();

notify pgrst, 'reload config';
