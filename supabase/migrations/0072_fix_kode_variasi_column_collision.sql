-- =====================================================================
-- 0072: Root cause of "variants never show in Modal Product" — confirmed
-- live against production data (client 92213048-a91b-4202-9b47-8d1c38671082,
-- kode_produk 27268399667): raw->>'Kode Variasi' was "-" on EVERY single
-- spos row, including rows whose Nama Variasi clearly held a real variant
-- ("4x6cm", "6x9cm(2R)") — while raw->>'__COL_D' (the same cell, addressed
-- by fixed column position instead of header text) held the correct code
-- ("223494656648" etc). Not a schema/upsert/query bug as guessed — it's a
-- parsing bug in /api/upload/route.ts's raw-object builder.
--
-- Shopee's "Performa Produk" (SPOS) export literally repeats the header
-- text "Kode Variasi" on TWO columns: D (the real variant code) and G
-- (always "-", confirmed against the reference file). route.ts built raw
-- by `raw[h] = val` for every column in position order — with an exact
-- duplicate header, column G's "-" was written AFTER column D's real
-- value and silently overwrote it. This affected every spos upload from
-- every client since the app launched; has_variant in product_catalog was
-- never able to come out true. route.ts is fixed (first-occurrence wins on
-- duplicate header text) so future uploads capture the real value — this
-- migration recovers the ALREADY-uploaded historical data too, since
-- __COL_D was captured correctly all along and just never read.
-- =====================================================================

create or replace function refresh_product_catalog() returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
  with base as (
    select
      client_id,
      nullif(trim(raw->>'Kode Produk'), '') as kode_produk,
      item_name as nama_produk,
      -- __COL_D first: raw->>'Kode Variasi' is corrupted on any export with
      -- the duplicate-header collision (see comment above) — column letter
      -- is immune to that, since it's keyed by position, not text.
      coalesce(nullif(trim(raw->>'__COL_D'), '-'), nullif(trim(raw->>'Kode Variasi'), '-')) as kode_variasi,
      coalesce(nullif(trim(raw->>'__COL_E'), '-'), nullif(trim(raw->>'Nama Variasi'), '-')) as nama_variasi,
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

-- Recover every existing client's catalog immediately — no re-upload
-- needed, __COL_D/__COL_E were captured correctly all along.
select refresh_product_catalog();

notify pgrst, 'reload config';
