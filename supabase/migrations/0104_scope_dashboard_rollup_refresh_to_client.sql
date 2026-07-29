-- =====================================================================
-- 0104: Scope refresh_dashboard_rollup() to the uploading client instead
-- of rebuilding every tenant's data on every single upload.
--
-- Root cause of two related failures reported after 0102/0103:
--   1. "canceling statement due to lock timeout" — TRUNCATE takes an
--      ACCESS EXCLUSIVE lock, which queues behind ANY concurrent reader
--      of dashboard_rollup (e.g. someone with the Dashboard open reading
--      via dashboard_summary/dashboard_filters). Under load this now
--      times out waiting for the lock, not just for query execution.
--   2. "SyntaxError: Unexpected token 'A', "An error o"..." — the client
--      tried to JSON-parse Vercel's own plaintext error page. 0102 gave
--      refresh_dashboard_rollup() a 180s statement_timeout, but
--      /api/upload/route.ts's `maxDuration` is only 60s — Vercel kills
--      the whole serverless function before our own error handling can
--      respond, and returns its platform error page (not JSON) instead.
--
-- Both are downstream of the same design flaw: EVERY upload, from ANY
-- tenant, does `TRUNCATE dashboard_rollup; INSERT ... FROM sales_rows`
-- for the WHOLE table — one tenant's small weekly upload pays the cost
-- of rebuilding every other tenant's data too. That's O(all tenants'
-- data) per upload event instead of O(this tenant's data), and it only
-- gets worse as more tenants onboard. Raising timeouts (0102/0103) just
-- delays the same wall.
--
-- Fix: add an optional p_client_id param. When provided (the normal
-- upload-triggered case), DELETE + rebuild only that client's rows —
-- DELETE ... WHERE client_id = ... takes a ROW EXCLUSIVE lock, which does
-- NOT conflict with concurrent readers' AccessShareLock, so bug #1 goes
-- away too. When NULL (manual full-rebuild from the SQL editor, same use
-- as 0060/0102's `select refresh_dashboard_rollup();`), behavior is
-- unchanged. Each INSERT branches on p_client_id with its own static SQL
-- (no OR-IS-NULL) so the scoped branch actually uses
-- sales_rows_client_dims_idx instead of a full scan.
-- =====================================================================

drop function if exists public.refresh_dashboard_rollup();

create or replace function refresh_dashboard_rollup(p_client_id uuid default null) returns void
  language plpgsql security definer set search_path = public set statement_timeout = '180s' as $$
begin
  if p_client_id is null then
    delete from dashboard_rollup;
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
    where s.source <> 'spos' or s.is_parent
    group by s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
             s.brand, s.product_type, s.item_name, s.source, s.ad_type;

    delete from dashboard_month_completeness;
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

  else
    delete from dashboard_rollup where client_id = p_client_id;
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
      and (s.source <> 'spos' or s.is_parent)
    group by s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
             s.brand, s.product_type, s.item_name, s.source, s.ad_type;

    delete from dashboard_month_completeness where client_id = p_client_id;
    insert into dashboard_month_completeness (client_id, store_name, owner, month, week_count)
    select s.client_id, s.store_name, so.owner, s.month, count(distinct s.week)
    from sales_rows s
    left join lateral (
      select sl.owner from store_links sl
      where sl.client_id = s.client_id and sl.store_name = s.store_name and sl.owner is not null
      order by sl.owner limit 1
    ) so on true
    where s.client_id = p_client_id
      and s.source = 'spos' and s.store_name is not null and s.month is not null
      and coalesce(lower(trim(s.month)), '') <> 'baseline'
    group by s.client_id, s.store_name, so.owner, s.month;
  end if;
end $$;

grant execute on function refresh_dashboard_rollup(uuid) to authenticated, service_role;

notify pgrst, 'reload config';
