-- =====================================================================
-- 0105: Finish the 0104 fix — scope refresh_ads_rollup() and
-- refresh_product_catalog() to the uploading client too.
--
-- 0104 scoped refresh_dashboard_rollup() (DELETE instead of TRUNCATE,
-- WHERE client_id = ...) because its unscoped TRUNCATE was taking an
-- ACCESS EXCLUSIVE lock that queued behind concurrent readers and hit
-- lock_timeout. refresh_ads_rollup() has the EXACT same shape — a bare
-- `truncate ads_rollup` with no client_id predicate — and is called by
-- BOTH /api/upload (ads source) and /api/ads-group/upload (Inkubasi/
-- Group Ads), so when "Ads Performa" is one of several files in a batch
-- upload, it is the other realistic source of "canceling statement due
-- to lock timeout" alongside dashboard_rollup.
--
-- refresh_product_catalog() does NOT truncate (it's an upsert via
-- `insert ... on conflict do update`), so it isn't a lock-timeout risk —
-- but it's still unscoped and rebuilds every tenant's catalog from every
-- tenant's sales_rows on every single spos upload. Scoped here too for
-- the same O(this tenant) vs O(every tenant) reason as 0104.
--
-- Same pattern as 0104: optional p_client_id, IF/ELSE branches with
-- static SQL per branch (no OR-IS-NULL) so the scoped path actually uses
-- an index, NULL still does a full rebuild for manual SQL-editor runs.
-- =====================================================================

drop function if exists public.refresh_ads_rollup();

create or replace function refresh_ads_rollup(p_client_id uuid default null) returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
  if p_client_id is null then
    truncate ads_rollup;

    insert into ads_rollup (client_id, source, year, month, week, store_name, owner, item_name, kode_produk, ads_level,
                             ads_cost, sales, view, click, add_to_cart, orders, item_sold)
    select s.client_id, 'total', s.year, s.month, s.week, s.store_name, so.owner, s.item_name,
           nullif(nullif(trim(s.kode_produk), ''), '-') as kode_produk,
           null,
           sum(s.ad_cost), sum(s.sales_idr), sum(s.visitors), sum(s.clicks), sum(s.add_to_cart), sum(s.orders), sum(s.units)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.source = 'ads'
    group by s.client_id, s.year, s.month, s.week, s.store_name, so.owner, s.item_name,
             nullif(nullif(trim(s.kode_produk), ''), '-');

    insert into ads_rollup (client_id, source, year, month, week, store_name, owner, item_name, kode_produk, ads_level,
                             ads_cost, sales, view, click, add_to_cart, orders, item_sold)
    select g.client_id, 'group', g.year, g.month, g.week, g.store_name, so.owner, g.item_name,
           null, g.ads_level,
           sum(g.biaya), sum(g.omzet), sum(g.dilihat), sum(g.klik), null, sum(g.konversi), sum(g.produk_terjual)
    from ad_groups g
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = g.client_id and sl.store_name = g.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where g.level = 'group'
    group by g.client_id, g.year, g.month, g.week, g.store_name, so.owner, g.item_name, g.ads_level;

    insert into ads_rollup (client_id, source, year, month, week, store_name, owner, item_name, kode_produk, ads_level,
                             ads_cost, sales, view, click, add_to_cart, orders, item_sold)
    select g.client_id, 'product', g.year, g.month, g.week, g.store_name, so.owner, g.item_name,
           nullif(nullif(trim(g.kode_produk), ''), '-') as kode_produk, g.ads_level,
           sum(g.biaya), sum(g.omzet), sum(g.dilihat), sum(g.klik), null, sum(g.konversi), sum(g.produk_terjual)
    from ad_groups g
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = g.client_id and sl.store_name = g.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where g.level = 'product'
    group by g.client_id, g.year, g.month, g.week, g.store_name, so.owner, g.item_name,
             nullif(nullif(trim(g.kode_produk), ''), '-'), g.ads_level;

  else
    delete from ads_rollup where client_id = p_client_id;

    insert into ads_rollup (client_id, source, year, month, week, store_name, owner, item_name, kode_produk, ads_level,
                             ads_cost, sales, view, click, add_to_cart, orders, item_sold)
    select s.client_id, 'total', s.year, s.month, s.week, s.store_name, so.owner, s.item_name,
           nullif(nullif(trim(s.kode_produk), ''), '-') as kode_produk,
           null,
           sum(s.ad_cost), sum(s.sales_idr), sum(s.visitors), sum(s.clicks), sum(s.add_to_cart), sum(s.orders), sum(s.units)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.client_id = p_client_id and s.source = 'ads'
    group by s.client_id, s.year, s.month, s.week, s.store_name, so.owner, s.item_name,
             nullif(nullif(trim(s.kode_produk), ''), '-');

    insert into ads_rollup (client_id, source, year, month, week, store_name, owner, item_name, kode_produk, ads_level,
                             ads_cost, sales, view, click, add_to_cart, orders, item_sold)
    select g.client_id, 'group', g.year, g.month, g.week, g.store_name, so.owner, g.item_name,
           null, g.ads_level,
           sum(g.biaya), sum(g.omzet), sum(g.dilihat), sum(g.klik), null, sum(g.konversi), sum(g.produk_terjual)
    from ad_groups g
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = g.client_id and sl.store_name = g.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where g.client_id = p_client_id and g.level = 'group'
    group by g.client_id, g.year, g.month, g.week, g.store_name, so.owner, g.item_name, g.ads_level;

    insert into ads_rollup (client_id, source, year, month, week, store_name, owner, item_name, kode_produk, ads_level,
                             ads_cost, sales, view, click, add_to_cart, orders, item_sold)
    select g.client_id, 'product', g.year, g.month, g.week, g.store_name, so.owner, g.item_name,
           nullif(nullif(trim(g.kode_produk), ''), '-') as kode_produk, g.ads_level,
           sum(g.biaya), sum(g.omzet), sum(g.dilihat), sum(g.klik), null, sum(g.konversi), sum(g.produk_terjual)
    from ad_groups g
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = g.client_id and sl.store_name = g.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where g.client_id = p_client_id and g.level = 'product'
    group by g.client_id, g.year, g.month, g.week, g.store_name, so.owner, g.item_name,
             nullif(nullif(trim(g.kode_produk), ''), '-'), g.ads_level;
  end if;
end $$;

grant execute on function refresh_ads_rollup(uuid) to authenticated, service_role;

-- ── refresh_product_catalog: same client-scoping, no lock concern (it's an
-- upsert, never truncates) but still avoids rebuilding every tenant's
-- catalog on every single spos upload. ─────────────────────────────────
drop function if exists public.refresh_product_catalog();

create or replace function refresh_product_catalog(p_client_id uuid default null) returns void
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
      and (p_client_id is null or client_id = p_client_id)
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

grant execute on function refresh_product_catalog(uuid) to authenticated, service_role;

notify pgrst, 'reload config';
