-- =====================================================================
-- 0123: dashboard_baseline_vs_active() — check Sales and Ads Spend
-- completeness INDEPENDENTLY, not one shared "complete months" set.
--
-- 0118 gated the whole active average on dashboard_month_completeness,
-- which only ever counted SPOS (sales) weeks (0058/0110) — it was never
-- extended to track Ads uploads. Practical effect: if a store's Sales
-- data for the current month is fully uploaded (>=4 weeks) but its Ads
-- data for that same month is still partial (e.g. only 2 of the week's
-- ad exports uploaded so far), the old logic still counted that month's
-- (partial) ad_cost in the Ads Spend average — exactly the "ongoing data
-- drags the average down" problem this feature exists to prevent, just
-- for Ads specifically rather than Sales.
--
-- Fix: compute week-completeness separately per source, straight from
-- dashboard_rollup's own `week` column (no need to touch the SPOS-only
-- dashboard_month_completeness table) — sales_complete_months gates the
-- Sales average, ads_complete_months gates the Ads Spend/ROAS average.
-- A month can now be "complete enough" for Sales but not yet for Ads, or
-- vice versa, and each average only ever reflects genuinely-finished
-- months for ITS OWN metric.
--
-- Known limitation (unchanged from 0118, not a new regression): for a
-- multi-store scope (an Owner/Brand spanning several stores), "4 distinct
-- weeks reported this month" is checked across the COMBINED rows, not
-- per-store — one store finishing all 4 weeks can make the month count
-- as complete even if another store in the same scope only reported 2.
-- Exact for the common single-store case; worth revisiting if Owner/
-- Brand-wide views turn out to need it.
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
    select r.month, r.week, r.store_name, r.source, r.sales_idr, r.ad_cost
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
  sales_complete_months as (
    select month from (
      select month, count(distinct week) wc
      from base
      where source = 'spos' and coalesce(lower(trim(month)), '') <> 'baseline' and week is not null
      group by month
    ) x where wc >= 4
  ),
  ads_complete_months as (
    select month from (
      select month, count(distinct week) wc
      from base
      where source = 'ads' and coalesce(lower(trim(month)), '') <> 'baseline' and week is not null
      group by month
    ) x where wc >= 4
  ),
  active_sales_monthly as (
    select month, coalesce(sum(sales_idr) filter (where source = 'spos'), 0) sales
    from base
    where month in (select month from sales_complete_months)
    group by month
  ),
  active_ads_monthly as (
    select month,
           coalesce(sum(ad_cost)   filter (where source = 'ads'),  0) ad_cost,
           coalesce(sum(sales_idr) filter (where source = 'spos'), 0) sales
    from base
    where month in (select month from ads_complete_months)
    group by month
  )
  select jsonb_build_object(
    'baseline', (select jsonb_build_object(
      'sales',   b.sales,
      'ad_cost', b.ad_cost,
      'roas',    b.sales / nullif(b.ad_cost, 0)
    ) from baseline b),
    'active', (select jsonb_build_object(
      'months',      (select count(*) from active_sales_monthly),
      'avg_sales',   coalesce((select avg(sales)   from active_sales_monthly), 0),
      'ad_months',   (select count(*) from active_ads_monthly),
      'avg_ad_cost', coalesce((select avg(ad_cost) from active_ads_monthly), 0),
      -- Blended ROAS (avg(sales)/avg(ad_cost), not avg of each month's own
      -- ROAS — averaging ratios skews toward the smallest-denominator month)
      -- computed over the SAME ads-complete months used for avg_ad_cost, so
      -- the ratio's two halves are always drawn from a consistent basis.
      'avg_roas',    (select avg(sales) from active_ads_monthly) / nullif((select avg(ad_cost) from active_ads_monthly), 0)
    ))
  );
$$;

notify pgrst, 'reload config';
