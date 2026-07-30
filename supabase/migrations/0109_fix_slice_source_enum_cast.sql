-- =====================================================================
-- 0109: Fix "operator does not exist: data_source = text" in
-- refresh_dashboard_rollup_slice() — a bug introduced by 0107.
--
-- The two `source` columns are NOT the same type:
--   sales_rows.source        data_source  (enum, NOT NULL)   -- 0001
--   dashboard_rollup.source  text         (nullable)         -- 0052
--
-- 0107's slice function declares `p_source text` and compares it against
-- both. Against dashboard_rollup (text vs text) that's fine. Against
-- sales_rows it's `data_source = text`, for which Postgres has no
-- operator, so the whole function throws.
--
-- Postgres silently coerces a bare *literal* ('spos') to the enum, which
-- is why every other refresh function survived — they all filter with
-- literals. Only the slice function takes the source as a typed text
-- parameter, so only it broke. Symptom: every /api/upload file logged
-- "⚠ dashboard: operator does not exist: data_source = text" while the
-- ad-group uploads (which never hit this path) succeeded cleanly.
--
-- Fix: cast the parameter to the enum for the sales_rows comparison.
-- Casting the PARAMETER (a constant) rather than the column keeps
-- sales_rows_slice_idx usable; casting the column (s.source::text) would
-- have disabled it. sales_rows.source is NOT NULL so a plain `=` is
-- correct here — `is not distinct from` was never needed on this column
-- and costs index efficiency. dashboard_rollup.source IS nullable, so its
-- comparison keeps `is not distinct from`.
--
-- Everything else in the function is byte-for-byte identical to 0107.
-- =====================================================================

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
  -- dashboard_rollup.source is TEXT and nullable -> is not distinct from.
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
    -- sales_rows.source is the data_source ENUM and NOT NULL: cast the
    -- parameter (constant) so the slice index stays usable.
    and s.source     = p_source::data_source
    and s.year       is not distinct from p_year
    and s.month      is not distinct from p_month
    and s.week       is not distinct from p_week
    and s.store_name is not distinct from p_store_name
    and (s.source <> 'spos' or s.is_parent)          -- SPOS parent-row rule
  group by s.client_id, s.year, s.month, s.week, s.city, s.store_name, so.owner,
           s.brand, s.product_type, s.item_name, s.source, s.ad_type;

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

-- ── Catch up the slices that failed while the bug was live ───────────
-- The uploads themselves succeeded (rows landed in sales_rows); only the
-- rollup refresh threw, so dashboard_rollup is stale for anything
-- uploaded since 0107 shipped. One full rebuild reconciles it.
select refresh_dashboard_rollup();

notify pgrst, 'reload config';
