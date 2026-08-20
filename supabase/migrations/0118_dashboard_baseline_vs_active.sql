-- =====================================================================
-- 0118: dashboard_baseline_vs_active() — Baseline vs Active (avg/month)
-- comparison RPC for the new Dashboard chart pair (Prof-tier clients only,
-- gated client-side).
--
-- "Active" only counts ENDED months — reuses dashboard_month_completeness
-- (0058/0110's week_count >= 4 threshold, the app's existing definition of
-- a complete month), the same mechanism the dealer sparkline trend already
-- relies on to avoid an in-progress month dragging an average down. This
-- also naturally excludes the current calendar month once it's under way,
-- without any date-math — a month that hasn't finished uploading its
-- weeks yet just never enters the average, regardless of why.
--
-- avg_roas is NOT the average of each month's own ROAS (averaging ratios
-- skews toward whichever month had the smallest ad_cost denominator — the
-- exact shape of bug that produces a nonsensical "2456x" reading). It's
-- avg(sales)/avg(ad_cost), i.e. sum(sales)/sum(ad_cost) across active
-- months — the same blended-ROAS convention used everywhere else in this
-- app (dashboard_summary's own kpis.roas, ads_dashboard_summary's totals).
-- A near-zero denominator can still produce a huge number when spend is
-- genuinely thin; the frontend guards that case the same way
-- lib/reportPdf.tsx's BaselineBody already does (an "ads thin" check),
-- rather than hiding it here.
--
-- language sql stable, NOT security definer — same convention as
-- dashboard_summary(): relies on the caller's own RLS on dashboard_rollup
-- and dashboard_month_completeness (both already role/owner-scoped), so
-- there is no separate role-resolution logic to get wrong here.
-- =====================================================================

create or replace function dashboard_baseline_vs_active(
  p_client_id uuid,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with base as (
    select r.month, r.store_name, r.source, r.sales_idr, r.ad_cost
    from dashboard_rollup r
    where r.client_id = p_client_id
      and (p_store is null or r.store_name = p_store)
      and (p_owner is null or r.owner      = p_owner)
      and (p_brand is null or r.store_name in (
            select sl.store_name from store_links sl
            where sl.client_id = p_client_id and sl.brand = p_brand and sl.store_name is not null))
  ),
  baseline as (
    select coalesce(sum(sales_idr) filter (where source = 'spos'), 0) sales,
           coalesce(sum(ad_cost)   filter (where source = 'ads'),  0) ad_cost
    from base
    where coalesce(lower(trim(month)), '') = 'baseline'
  ),
  complete_months as (
    select distinct c.month
    from dashboard_month_completeness c
    where c.client_id = p_client_id
      and c.week_count >= 4
      and (p_store is null or c.store_name = p_store)
      and (p_owner is null or c.owner      = p_owner)
      and (p_brand is null or c.store_name in (
            select sl.store_name from store_links sl
            where sl.client_id = p_client_id and sl.brand = p_brand and sl.store_name is not null))
  ),
  active_monthly as (
    select month,
           coalesce(sum(sales_idr) filter (where source = 'spos'), 0) sales,
           coalesce(sum(ad_cost)   filter (where source = 'ads'),  0) ad_cost
    from base
    where month in (select month from complete_months)
    group by month
  )
  select jsonb_build_object(
    'baseline', (select jsonb_build_object(
      'sales',   b.sales,
      'ad_cost', b.ad_cost,
      'roas',    b.sales / nullif(b.ad_cost, 0)
    ) from baseline b),
    'active', (select jsonb_build_object(
      'months',      count(*),
      'avg_sales',   coalesce(avg(sales), 0),
      'avg_ad_cost', coalesce(avg(ad_cost), 0),
      'avg_roas',    avg(sales) / nullif(avg(ad_cost), 0)
    ) from active_monthly)
  );
$$;

notify pgrst, 'reload config';
