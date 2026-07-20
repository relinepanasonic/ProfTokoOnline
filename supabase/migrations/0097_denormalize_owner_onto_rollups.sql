-- =====================================================================
-- 0097: Kill the RLS subquery bottleneck by denormalizing `owner` onto
-- the rollup tables.
--
-- MEASURED: dashboard_rollup is only 19 MB / 79k rows. Bypassing RLS the
-- owner-filtered query uses dashboard_rollup_store_idx and returns in
-- 7.8ms. WITH RLS it takes 12.1s. The entire cost is
-- rollup_owner_scoped_read's predicate:
--     store_name in (select sl.store_name from store_links sl
--                    where sl.client_id = my_client_id()
--                      and sl.owner = my_scope_owner() ...)
-- re-evaluated per candidate row. Grain/indexes were NOT the problem.
--
-- Fix: carry `owner` on the rollup itself so RLS collapses to a plain
-- indexed equality (owner = my_scope_owner()).
--
-- Also covers dashboard_month_completeness: it carries the identical
-- policy AND is JOINed inside dashboard_summary (trend_by_store), so
-- leaving it behind would leave part of the 12s in place.
--
-- ── Two deliberate deviations from the proposed policy shape ──────────
-- The suggested single policy was:
--   client_id = my_client_id() AND (my_role() = 'super_admin' OR owner = my_scope_owner())
-- That would have broken production two ways:
--   1. superadmin has client_id = NULL by design (migration 0001), so
--      `client_id = my_client_id()` is NULL → never true → superadmin
--      would see ZERO rows and every admin dashboard would go blank.
--   2. the role string is 'superadmin', not 'super_admin'; and it drops
--      the store_user / client_admin / advertiser branches entirely.
-- The existing design uses SEPARATE permissive (OR'd) policies per role.
-- So this migration replaces ONLY the owner-scoped policy on each table
-- and leaves rollup_admin_read / rollup_advertiser_read untouched.
-- =====================================================================

-- ── 1. Columns + indexes ─────────────────────────────────────────────────────
alter table dashboard_rollup             add column if not exists owner text;
alter table ads_rollup                   add column if not exists owner text;
alter table dashboard_month_completeness add column if not exists owner text;

create index if not exists dashboard_rollup_client_owner_idx on dashboard_rollup (client_id, owner);
create index if not exists ads_rollup_client_owner_idx       on ads_rollup (client_id, owner);
create index if not exists completeness_client_owner_idx     on dashboard_month_completeness (client_id, owner);

-- ── 2. Backfill from store_links ─────────────────────────────────────────────
-- DISTINCT ON guarantees exactly one owner per (client_id, store_name) so the
-- UPDATE can never multiply rows if the Core List happens to map one store to
-- several owners. See the verification query in the migration notes.
with store_owner as (
  select distinct on (client_id, store_name) client_id, store_name, owner
  from store_links
  where store_name is not null and owner is not null
  order by client_id, store_name, owner
)
update dashboard_rollup r set owner = so.owner
from store_owner so
where so.client_id = r.client_id and so.store_name = r.store_name;

with store_owner as (
  select distinct on (client_id, store_name) client_id, store_name, owner
  from store_links
  where store_name is not null and owner is not null
  order by client_id, store_name, owner
)
update ads_rollup r set owner = so.owner
from store_owner so
where so.client_id = r.client_id and so.store_name = r.store_name;

with store_owner as (
  select distinct on (client_id, store_name) client_id, store_name, owner
  from store_links
  where store_name is not null and owner is not null
  order by client_id, store_name, owner
)
update dashboard_month_completeness c set owner = so.owner
from store_owner so
where so.client_id = c.client_id and so.store_name = c.store_name;

-- ── 3. Refresh functions populate `owner` going forward ──────────────────────
-- owner is functionally dependent on (client_id, store_name), both already in
-- the GROUP BY, so adding it does not change the rollup grain.
create or replace function refresh_dashboard_rollup() returns void
  language plpgsql security definer set search_path = public as $$
begin
  truncate dashboard_rollup;
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
  where s.source <> 'spos' or s.is_parent           -- SPOS parent-row rule, baked in
  group by s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
           s.brand, s.product_type, s.item_name, s.source, s.ad_type;

  truncate dashboard_month_completeness;
  insert into dashboard_month_completeness (client_id, store_name, owner, month, week_count)
  select s.client_id, s.store_name, so.owner, s.month, count(distinct s.week)
  from sales_rows s
  left join lateral (
    select sl.owner from store_links sl
    where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
    order by sl.owner limit 1
  ) so on true
  where s.source = 'spos' and s.store_name is not null and s.month is not null
    and coalesce(lower(trim(s.month)), '') <> 'baseline'
  group by s.client_id, s.store_name, so.owner, s.month;
end $$;

create or replace function refresh_ads_rollup() returns void
  language plpgsql security definer set search_path = public set statement_timeout = '60s' as $$
begin
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
end $$;

grant execute on function refresh_ads_rollup() to authenticated, service_role;

-- ── 4. RLS: subquery → indexed equality ──────────────────────────────────────
-- Only the owner-scoped policies change. rollup_admin_read /
-- rollup_advertiser_read / ads_rollup_admin_read / ads_rollup_advertiser_read
-- / completeness_admin_read / completeness_advertiser_read are left exactly
-- as-is, so superadmin (client_id NULL), client_admin and advertiser keep
-- their existing access.
drop policy if exists rollup_owner_scoped_read on dashboard_rollup;
create policy rollup_owner_scoped_read on dashboard_rollup
  for select using (
    client_id = my_client_id()
    and (
      (my_role()::text = 'branch_manager' and owner = my_scope_owner())
      or (my_role()::text = 'store_user' and store_name = my_scope_store())
    )
  );

drop policy if exists ads_rollup_owner_scoped_read on ads_rollup;
create policy ads_rollup_owner_scoped_read on ads_rollup
  for select using (
    client_id = my_client_id()
    and (
      (my_role()::text = 'branch_manager' and owner = my_scope_owner())
      or (my_role()::text = 'store_user' and store_name = my_scope_store())
    )
  );

drop policy if exists completeness_owner_scoped_read on dashboard_month_completeness;
create policy completeness_owner_scoped_read on dashboard_month_completeness
  for select using (
    client_id = my_client_id()
    and (
      (my_role()::text = 'branch_manager' and owner = my_scope_owner())
      or (my_role()::text = 'store_user' and store_name = my_scope_store())
    )
  );

analyze dashboard_rollup;
analyze ads_rollup;
analyze dashboard_month_completeness;

notify pgrst, 'reload config';
