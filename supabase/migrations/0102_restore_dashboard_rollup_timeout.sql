-- =====================================================================
-- 0102: Restore refresh_dashboard_rollup()'s statement_timeout — this is
-- a REGRESSION of migration 0060, not a new bug.
--
-- 0060 diagnosed and fixed this exact symptom before (see its comment):
-- refresh_dashboard_rollup() does a full TRUNCATE + re-aggregate of
-- sales_rows, which routinely exceeds the role-level 20s statement_timeout
-- (migration 0045) as the table grows. 0060's fix was a function-level
-- `set statement_timeout = '120s'` — but a function-level SET is part of
-- the function's definition and is wiped out by any later `CREATE OR
-- REPLACE` that doesn't re-declare it.
--
-- Migration 0097 (owner denormalization) did exactly that: it replaced
-- refresh_dashboard_rollup() to add the `owner` column via a LEFT JOIN
-- LATERAL against store_links, but the new CREATE OR REPLACE never
-- carried over `set statement_timeout = '120s'` — silently reverting it
-- to the 20s role default, at the same time the query got heavier (the
-- extra per-group lateral join). refresh_ads_rollup() got the same 0097
-- treatment but DID keep its `set statement_timeout = '60s'`, which is
-- why only the Dashboard rollup (not Ads) went stale.
--
-- Symptom this caused: /api/upload/route.ts's post-upload
-- `await admin.rpc("refresh_dashboard_rollup")` doesn't check the RPC's
-- error (same silent-failure shape 0060 already called out) — so every
-- upload since 0097 shipped has reported success while dashboard_rollup
-- quietly stopped picking up new rows. This is why the team's July
-- Week 2/3 upload shows nothing on the Dashboard: the rows landed in
-- sales_rows, but the pre-aggregated table dashboard_summary() actually
-- reads from was never refreshed.
--
-- Fix: re-declare the timeout (bumped to 180s — sales_rows has grown
-- further since 0060's 120s, and the query itself is heavier post-0097),
-- and fix the silent-error bug in the two upload routes that call these
-- refresh RPCs so this can't regress invisibly again.
-- =====================================================================

create or replace function refresh_dashboard_rollup() returns void
  language plpgsql security definer set search_path = public set statement_timeout = '180s' as $$
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

-- Backfill immediately — the same reasoning as 0060: correct every
-- client's stale rollup (including this week's missing July Week 2/3
-- upload) the moment this ships, not just on the next upload.
select refresh_dashboard_rollup();

notify pgrst, 'reload config';
