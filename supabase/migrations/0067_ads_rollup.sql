-- =====================================================================
-- 0067: ads_rollup — the same fix dashboard_rollup (migration 0052) was
-- for the main Dashboard, applied to Ads Performance.
--
-- ads_dashboard_summary() (migrations 0062-0065) scans sales_rows and
-- ad_groups DIRECTLY, under RLS. That's the exact anti-pattern
-- dashboard_rollup was built to eliminate: dashboard_summary() used to do
-- the same thing and needed 3-12s (sometimes timing out at 57014) once
-- sales_rows grew past a few thousand rows per client, because RLS's
-- owner-scoping subquery (store_name in (select ... from store_links))
-- gets re-evaluated per row scanned. A 60s function-level timeout
-- (migration 0065) just raises the ceiling; it doesn't fix the underlying
-- cost, and the user is still seeing multi-minute loads.
--
-- Fix: a small pre-aggregated table, refreshed once after each relevant
-- upload (not per-row triggers), carrying the exact same RLS shape as
-- dashboard_rollup/sales_rows/ad_groups so scoping is still enforced —
-- just against a table that's orders of magnitude smaller.
--
-- Grain: one row per (client_id, source, year, month, store_name,
-- item_name, kode_produk, ads_level) where source distinguishes which
-- Shopee export it came from:
--   'total'   — sales_rows where source='ads' (the Total Ads / "Semua
--               Laporan Iklan CPC" export)
--   'group'   — ad_groups where level='group' (Shopee's own per-group
--               rollup row — GMV Max / Group Ads / etc.)
--   'product' — ad_groups where level='product' (the per-item breakdown)
-- =====================================================================

create table if not exists ads_rollup (
  client_id   uuid not null references clients(id) on delete cascade,
  source      text not null,   -- 'total' | 'group' | 'product'
  year        int,
  month       text,
  store_name  text,
  item_name   text,
  kode_produk text,
  ads_level   text,
  ads_cost    numeric,
  sales       numeric,
  view        numeric,
  click       numeric,
  add_to_cart numeric,
  orders      numeric,
  item_sold   numeric
);

create index if not exists ads_rollup_client_idx on ads_rollup (client_id, source, month);
create index if not exists ads_rollup_store_idx  on ads_rollup (client_id, store_name);

alter table ads_rollup enable row level security;

-- Mirror sales_rows/ad_groups/dashboard_rollup's three read policies exactly.
drop policy if exists ads_rollup_admin_read on ads_rollup;
create policy ads_rollup_admin_read on ads_rollup
  for select using (my_role()::text in ('superadmin','client_admin'));

drop policy if exists ads_rollup_advertiser_read on ads_rollup;
create policy ads_rollup_advertiser_read on ads_rollup
  for select using (client_id = my_client_id() and my_role()::text = 'advertiser');

drop policy if exists ads_rollup_owner_scoped_read on ads_rollup;
create policy ads_rollup_owner_scoped_read on ads_rollup
  for select using (
    client_id = my_client_id()
    and (
      (my_role()::text = 'branch_manager' and store_name in (
        select sl.store_name from store_links sl
        where sl.client_id = my_client_id() and sl.owner = my_scope_owner() and sl.store_name is not null
      ))
      or (my_role()::text = 'store_user' and store_name = my_scope_store())
    )
  );

-- SECURITY DEFINER so the upload routes (authenticated) can rebuild the
-- rollup without direct write grants — same pattern as
-- refresh_dashboard_rollup(). 60s headroom, matching the timeout already
-- given to ads_dashboard_summary() in migration 0065.
-- GROUP BY + SUM, not a 1:1 copy — the whole point is fewer rows for RLS's
-- owner-scoping subquery to run against (same reason dashboard_rollup
-- aggregates instead of just reshaping sales_rows). Grain excludes `week`
-- (matches dashboard_rollup) — a store can have several weekly uploads
-- feeding the same month/product, and this collapses them.
create or replace function refresh_ads_rollup() returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
  truncate ads_rollup;
  insert into ads_rollup (client_id, source, year, month, store_name, item_name, kode_produk, ads_level,
                           ads_cost, sales, view, click, add_to_cart, orders, item_sold)
  select client_id, 'total', year, month, store_name, item_name,
         nullif(nullif(trim(kode_produk), ''), '-') as kode_produk,
         null,
         sum(ad_cost), sum(sales_idr), sum(visitors), sum(clicks), sum(add_to_cart), sum(orders), sum(units)
  from sales_rows
  where source = 'ads'
  group by client_id, year, month, store_name, item_name, nullif(nullif(trim(kode_produk), ''), '-');

  insert into ads_rollup (client_id, source, year, month, store_name, item_name, kode_produk, ads_level,
                           ads_cost, sales, view, click, add_to_cart, orders, item_sold)
  select client_id, 'group', year, month, store_name, item_name,
         null, ads_level,
         sum(biaya), sum(omzet), sum(dilihat), sum(klik), null, sum(konversi), sum(produk_terjual)
  from ad_groups
  where level = 'group'
  group by client_id, year, month, store_name, item_name, ads_level;

  insert into ads_rollup (client_id, source, year, month, store_name, item_name, kode_produk, ads_level,
                           ads_cost, sales, view, click, add_to_cart, orders, item_sold)
  select client_id, 'product', year, month, store_name, item_name,
         nullif(nullif(trim(kode_produk), ''), '-') as kode_produk, ads_level,
         sum(biaya), sum(omzet), sum(dilihat), sum(klik), null, sum(konversi), sum(produk_terjual)
  from ad_groups
  where level = 'product'
  group by client_id, year, month, store_name, item_name, nullif(nullif(trim(kode_produk), ''), '-'), ads_level;
end $$;

grant execute on function refresh_ads_rollup() to authenticated, service_role;

-- Populate immediately so Ads Performance has data the moment this ships.
select refresh_ads_rollup();

-- Hourly safety-net refresh via pg_cron (same convention as
-- refresh_dashboard_rollup — never fails the migration if pg_cron isn't
-- enabled on the project).
do $$ begin
  perform cron.schedule('refresh-ads-rollup', '11 * * * *', 'select refresh_ads_rollup()');
exception when others then
  raise notice 'pg_cron not available — scheduled refresh skipped. Upload-triggered refresh still active.';
end $$;

notify pgrst, 'reload config';
