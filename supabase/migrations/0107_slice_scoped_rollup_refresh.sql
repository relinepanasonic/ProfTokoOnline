-- =====================================================================
-- 0107: THE structural fix for the never-ending 57014 / lock-timeout
-- cycle on upload.
--
-- ── WHY EVERY PREVIOUS FIX FAILED ────────────────────────────────────
-- 0060 raised a timeout. 0102 restored it after 0097 wiped it. 0103 added
-- one to dashboard_filters. 0104/0105 scoped the refresh to one client.
-- All of those made the SAME work cheaper without changing its ORDER OF
-- GROWTH. refresh_dashboard_rollup() re-aggregates a client's ENTIRE
-- history to regenerate the numbers for ONE week of ONE store. That cost
-- rises forever as data accumulates, while the Postgres statement_timeout
-- and Vercel's 60s function limit stay fixed. Every "fix" just moved the
-- date of the next failure.
--
-- ── THE ACTUAL FIX ───────────────────────────────────────────────────
-- Every row produced by a single upload shares the same
-- (client_id, source, year, month, week, store_name) — mapRow() stamps
-- all of them from the uploader's manual Year/Month/Week/Store selection
-- (src/lib/parse.ts). The rollup grain is strictly finer than that tuple.
-- So an upload can only ever change ONE slice of the rollup, and the
-- refresh only ever needs to recompute THAT slice.
--
-- That turns per-upload work from O(entire history) into O(one week of
-- one store) — a few hundred rows, milliseconds, and it stays that way
-- no matter how large the database grows. This is the property every
-- earlier fix was missing.
--
-- Two follow-on benefits:
--   * Bloat stops being generated. 0104/0105 replaced TRUNCATE with
--     DELETE to avoid TRUNCATE's ACCESS EXCLUSIVE lock — correct for
--     locking, but DELETE leaves dead tuples, and it was deleting the
--     client's WHOLE rollup on every upload. Now it deletes a few hundred
--     rows instead of tens of thousands.
--   * Lock contention effectively disappears: the row-level locks are
--     held for milliseconds over a handful of rows.
--
-- The full-rebuild functions from 0104/0105 are left in place unchanged
-- for manual use (`select refresh_dashboard_rollup();` in the SQL editor,
-- e.g. after the 0106 dedupe).
-- =====================================================================

-- ── 1. Indexes supporting the slice predicate ────────────────────────
-- The existing sales_rows_client_dims_idx has `city` in the middle, which
-- breaks the prefix for this lookup; these are exact-match on the full
-- slice key.
create index if not exists sales_rows_slice_idx
  on sales_rows (client_id, source, year, month, week, store_name);
create index if not exists dashboard_rollup_slice_idx
  on dashboard_rollup (client_id, source, year, month, week, store_name);
create index if not exists ads_rollup_slice_idx
  on ads_rollup (client_id, year, month, week, store_name);
create index if not exists ad_groups_slice_idx
  on ad_groups (client_id, year, month, week, store_name);
create index if not exists completeness_slice_idx
  on dashboard_month_completeness (client_id, store_name, month);

-- ── 2. Autovacuum on the derived tables ──────────────────────────────
-- 0050 tuned sales_rows but the rollup tables were never touched — and
-- 0104/0105 turned them into DELETE+INSERT churn tables, which is exactly
-- the workload that needs an aggressive setting. Defaults only vacuum
-- after 20% of the table changes; 2% keeps them continuously clean.
alter table dashboard_rollup set (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 2
);
alter table ads_rollup set (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 2
);
alter table dashboard_month_completeness set (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 2
);
alter table ad_groups set (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 2
);

-- ── 3. Slice-scoped dashboard rollup refresh ─────────────────────────
-- `is not distinct from` throughout: month/week/store_name are nullable
-- and a plain `=` would silently match zero rows (and so silently fail to
-- clear the old slice) whenever one of them is NULL.
create or replace function refresh_dashboard_rollup_slice(
  p_client_id  uuid,
  p_source     text,
  p_year       int,
  p_month      text,
  p_week       text,
  p_store_name text
) returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
  delete from dashboard_rollup r
  where r.client_id = p_client_id
    and r.source     is not distinct from p_source
    and r.year       is not distinct from p_year
    and r.month      is not distinct from p_month
    and r.week       is not distinct from p_week
    and r.store_name is not distinct from p_store_name;

  insert into dashboard_rollup (
    client_id, year, month, week, city, store_name, owner, brand, product_type, item_name, source, ad_type,
    sales_idr, visitors, in_cart, orders, orders_ready, orders_created,
    product_views, visitor_cart_adds, ad_cost, clicks, add_to_cart
  )
  select
    s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
    s.brand, s.product_type, s.item_name, s.source, s.ad_type,
    sum(s.sales_idr), sum(s.visitors), sum(s.in_cart), sum(s.orders), sum(s.orders_ready),
    sum(s.orders_created), sum(s.product_views), sum(s.visitor_cart_adds),
    sum(s.ad_cost), sum(s.clicks), sum(s.add_to_cart)
  from sales_rows s
  left join lateral (
    select sl.owner from store_links sl
    where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
    order by sl.owner limit 1
  ) so on true
  where s.client_id = p_client_id
    and s.source     is not distinct from p_source
    and s.year       is not distinct from p_year
    and s.month      is not distinct from p_month
    and s.week       is not distinct from p_week
    and s.store_name is not distinct from p_store_name
    and (s.source <> 'spos' or s.is_parent)          -- SPOS parent-row rule
  group by s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
           s.brand, s.product_type, s.item_name, s.source, s.ad_type;

  -- Month completeness is grained (client_id, store_name, owner, month)
  -- and counts DISTINCT weeks, so it must be recomputed across all weeks
  -- of the affected month — still only one store-month, not the table.
  -- Only spos rows feed it (see the full-rebuild function).
  if p_source = 'spos' and p_store_name is not null and p_month is not null
     and coalesce(lower(trim(p_month)), '') <> 'baseline' then
    delete from dashboard_month_completeness c
    where c.client_id = p_client_id
      and c.store_name is not distinct from p_store_name
      and c.month      is not distinct from p_month;

    insert into dashboard_month_completeness (client_id, store_name, owner, month, week_count)
    select s.client_id, s.store_name, so.owner, s.month, count(distinct s.week)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.client_id = p_client_id
      and s.store_name is not distinct from p_store_name
      and s.month      is not distinct from p_month
      and s.source = 'spos' and s.store_name is not null and s.month is not null
    group by s.client_id, s.store_name, so.owner, s.month;
  end if;
end $$;

grant execute on function refresh_dashboard_rollup_slice(uuid, text, int, text, text, text)
  to authenticated, service_role;

-- ── 4. Slice-scoped ads rollup refresh ───────────────────────────────
-- Refreshes all three ads_rollup sources ('total' from sales_rows,
-- 'group'/'product' from ad_groups) for the slice, so BOTH callers
-- (/api/upload with source='ads', and /api/ads-group/upload) can share
-- one function without clobbering each other's rows.
create or replace function refresh_ads_rollup_slice(
  p_client_id  uuid,
  p_year       int,
  p_month      text,
  p_week       text,
  p_store_name text
) returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
  delete from ads_rollup r
  where r.client_id = p_client_id
    and r.year       is not distinct from p_year
    and r.month      is not distinct from p_month
    and r.week       is not distinct from p_week
    and r.store_name is not distinct from p_store_name;

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
  where s.client_id = p_client_id
    and s.source = 'ads'
    and s.year       is not distinct from p_year
    and s.month      is not distinct from p_month
    and s.week       is not distinct from p_week
    and s.store_name is not distinct from p_store_name
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
  where g.client_id = p_client_id
    and g.level = 'group'
    and g.year       is not distinct from p_year
    and g.month      is not distinct from p_month
    and g.week       is not distinct from p_week
    and g.store_name is not distinct from p_store_name
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
  where g.client_id = p_client_id
    and g.level = 'product'
    and g.year       is not distinct from p_year
    and g.month      is not distinct from p_month
    and g.week       is not distinct from p_week
    and g.store_name is not distinct from p_store_name
  group by g.client_id, g.year, g.month, g.week, g.store_name, so.owner, g.item_name,
           nullif(nullif(trim(g.kode_produk), ''), '-'), g.ads_level;
end $$;

grant execute on function refresh_ads_rollup_slice(uuid, int, text, text, text)
  to authenticated, service_role;

-- ── 5. Product catalog: scope to the products in this upload ─────────
-- Can't be sliced by period the way the rollups can — it derives a
-- "latest known price" per product ACROSS history, so restricting the
-- scan to one month would let an old backfill overwrite a newer price.
-- Instead restrict to the products actually present in this upload and
-- still scan their full history: correct, and it skips every product the
-- upload didn't touch (the overwhelming majority).
create or replace function refresh_product_catalog_for_upload(p_upload_id uuid) returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
declare
  v_client_id uuid;
begin
  select client_id into v_client_id from uploads where id = p_upload_id;
  if v_client_id is null then return; end if;

  with touched as (
    select distinct nullif(trim(raw->>'Kode Produk'), '') as kode_produk
    from sales_rows
    where upload_id = p_upload_id and source = 'spos'
  ),
  base as (
    select
      s.client_id,
      nullif(trim(s.raw->>'Kode Produk'), '') as kode_produk,
      s.item_name as nama_produk,
      nullif(nullif(trim(s.raw->>'Kode Variasi'), '-'), '') as kode_variasi,
      nullif(trim(s.raw->>'Nama Variasi'), '-') as nama_variasi,
      s.is_parent, s.sales_idr, s.units, s.year, s.month, s.pic_client, s.store_name
    from sales_rows s
    join touched t on t.kode_produk = nullif(trim(s.raw->>'Kode Produk'), '')
    where s.source = 'spos' and s.client_id = v_client_id
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
    nama_produk  = excluded.nama_produk,
    nama_variasi = excluded.nama_variasi,
    has_variant  = excluded.has_variant,
    last_price   = excluded.last_price,
    last_year    = excluded.last_year,
    last_month   = excluded.last_month,
    pic_client   = excluded.pic_client,
    store_name   = excluded.store_name,
    updated_at   = now();
end $$;

grant execute on function refresh_product_catalog_for_upload(uuid) to authenticated, service_role;

analyze dashboard_rollup;
analyze ads_rollup;
analyze dashboard_month_completeness;

notify pgrst, 'reload config';
