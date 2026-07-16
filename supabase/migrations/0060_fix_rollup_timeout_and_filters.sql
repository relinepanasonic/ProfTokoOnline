-- =====================================================================
-- 0060: dashboard_rollup silently going stale after every upload, and an
-- empty Month/City/Store filter dropdown on the Dashboard.
--
-- Root cause, reproduced live against production data: refresh_dashboard_
-- rollup() now takes ~20s+ and hits the role-level statement_timeout
-- (57014, "canceling statement due to statement timeout") on every call.
-- /api/upload/route.ts's post-upload `await admin.rpc("refresh_dashboard_
-- rollup")` doesn't check the RPC's error, so this failure was completely
-- silent — the upload itself reports success (rows really did land in
-- sales_rows), but the pre-aggregated dashboard_rollup table that
-- dashboard_summary() actually reads from never picks up the new rows.
-- This is what made a freshly-uploaded "Ads Performa" file's Biaya column
-- (correctly parsed into sales_rows.ad_cost) show as Rp 0 / ROAS 0.00x on
-- the Dashboard — the KPI query was reading a stale rollup, not broken
-- column mapping. sales_rows has grown enough (multi-tenant) since
-- migration 0052 that the role's 20s timeout, tuned for normal read
-- queries, is now too short for this specific full TRUNCATE+re-aggregate.
--
-- Fix: give the function its OWN longer statement_timeout via a function-
-- level SET (survives independently of the role-level 20s limit; must be
-- re-declared on every CREATE OR REPLACE, same caveat noted in earlier
-- migrations).
--
-- Second, separate bug: dashboard_filters() (populates the Month/City/
-- Store dropdowns) was NEVER updated when migration 0052 moved
-- dashboard_summary() onto dashboard_rollup — it still does 4 raw DISTINCT
-- scans directly over sales_rows, the exact same table-growth problem,
-- causing it to time out and return nothing under RLS for a real Owner
-- login (hence the Month dropdown showing no options at all). Rewritten to
-- read from dashboard_rollup instead — small, pre-aggregated, and already
-- carries year/month/city/store_name.
-- =====================================================================

create or replace function refresh_dashboard_rollup() returns void
  language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
begin
  truncate dashboard_rollup;
  insert into dashboard_rollup (
    client_id, year, month, city, store_name, brand, product_type, item_name, source, ad_type,
    sales_idr, visitors, in_cart, orders, orders_ready, orders_created,
    product_views, visitor_cart_adds, ad_cost, clicks, add_to_cart
  )
  select
    client_id, year, month, city, store_name, brand, product_type, item_name, source, ad_type,
    sum(sales_idr), sum(visitors), sum(in_cart), sum(orders), sum(orders_ready),
    sum(orders_created), sum(product_views), sum(visitor_cart_adds),
    sum(ad_cost), sum(clicks), sum(add_to_cart)
  from sales_rows
  where source <> 'spos' or is_parent           -- SPOS parent-row rule, baked in
  group by client_id, year, month, city, store_name, brand, product_type, item_name, source, ad_type;

  truncate dashboard_month_completeness;
  insert into dashboard_month_completeness (client_id, store_name, month, week_count)
  select client_id, store_name, month, count(distinct week)
  from sales_rows
  where source = 'spos' and store_name is not null and month is not null
    and coalesce(lower(trim(month)), '') <> 'baseline'
  group by client_id, store_name, month;
end $$;

create or replace function dashboard_filters()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'years',  (select coalesce(jsonb_agg(distinct year order by year desc), '[]') from dashboard_rollup where year is not null),
    'months', (select coalesce(jsonb_agg(distinct month), '[]') from dashboard_rollup where month is not null),
    'cities', (select coalesce(jsonb_agg(distinct city order by city), '[]') from dashboard_rollup where city is not null),
    'stores', (select coalesce(jsonb_agg(distinct store_name order by store_name), '[]') from dashboard_rollup where store_name is not null)
  );
$$;

-- Backfill immediately so every existing client's stale rollup (like the
-- ads/ROAS data this migration was written to fix) is corrected the
-- moment this ships, not just on the next upload.
select refresh_dashboard_rollup();

notify pgrst, 'reload config';
