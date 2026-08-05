-- =====================================================================
-- 0111: Restore Ads Spent to finance_summary() — dropped by 0091.
--
-- finance_rows (the Shopee Income/Penghasilan Dilepas export) has no ad
-- spend column at all — ad cost has always had to come from a separate
-- `ads` CTE over sales_rows where source='ads', scoped by the same
-- year/month/week/owner/brand/store filters. That CTE existed correctly
-- in the original finance_summary() (migration 0035): 'ads_cost' in kpis,
-- plus a top-level 'monthly_ads_cost' series for the KPI card's sparkline.
--
-- 0091 rewrote finance_summary() for an unrelated feature (daily
-- drilldown charts) and, in doing so, dropped the `ads` CTE and BOTH of
-- those output fields entirely — not a deliberate removal, just lost in
-- the rewrite. Since 0091 is the current/only version since, this has
-- been live ever since: the frontend's `k?.ads_cost ?? 0` and
-- `d?.monthly_ads_cost` both silently resolve to nothing, showing
-- "Rp 0" with no sparkline on the Ads Spent card, and flowing straight
-- into Nett Profit (gross_profit - ads_cost - modal), which was
-- therefore ALSO overstated by the missing ad cost the whole time.
--
-- product_profit_detail() was never affected — it computes ads_cost
-- independently via its own ads_by_product CTE (migration 0073+), which
-- is why the per-product table has always shown real numbers while the
-- top scorecard showed zero.
--
-- Fix: restore the `ads` CTE and both fields, byte-for-byte the same
-- shape as 0035, layered onto 0091's current body (daily_gross, dynamic
-- monthly_fee/monthly_discount bucketing, daily) with no other changes.
-- =====================================================================

create or replace function finance_summary(
  p_year  int  default null,
  p_month text default null,
  p_week  text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with f as (
    select r.*
    from finance_rows r
    where (p_year  is null or r.year        = p_year)
      and (p_month is null or r.month       = p_month)
      and (p_week  is null or r.week        = p_week)
      and (p_owner is null or r.pic_client  = p_owner)
      and (p_brand is null or r.brand       = p_brand)
      and (p_store is null or r.store_name  = p_store)
  ),
  ads as (
    select s.*
    from sales_rows s
    where s.source = 'ads'
      and (p_year  is null or s.year        = p_year)
      and (p_month is null or s.month       = p_month)
      and (p_week  is null or s.week        = p_week)
      and (p_owner is null or s.pic_client  = p_owner)
      and (p_brand is null or s.brand       = p_brand)
      and (p_store is null or s.store_name  = p_store)
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'sales',            coalesce(sum(sales),0),
        'promotion_cost',   coalesce(abs(sum(promotion_cost)),0),
        'refund',           coalesce(abs(sum(refund)),0),
        'delivery_cost',    coalesce(abs(sum(delivery_cost)),0),
        'affiliate_cost',   coalesce(abs(sum(affiliate_cost)),0),
        'marketplace_fee',  coalesce(abs(sum(marketplace_fee)),0),
        'misc',             coalesce(abs(sum(misc)),0),
        'gross_profit',     coalesce(sum(net_income),0),
        'ads_cost',         (select coalesce(sum(ad_cost),0) from ads)
      ) from f
    ),
    'monthly', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(sales) sales, sum(net_income) profit
        from f where month is not null group by month) x),
    -- per-day Gross Sales + Gross Profit — only when a month is selected
    'daily_gross', (case when p_month is null then '[]'::jsonb else (
        select coalesce(jsonb_agg(x order by x.day),'[]') from (
          select release_date::text as day, sum(sales) gross_sales, sum(net_income) gross_profit
          from f where release_date is not null group by release_date) x) end),
    -- dynamic bucket: month when All Months, ISO date when a month is picked
    'monthly_fee', (select coalesce(jsonb_agg(x),'[]') from (
        select (case when p_month is null then month else release_date::text end) as month,
               abs(sum(marketplace_fee)) fee
        from f
        where (case when p_month is null then month else release_date::text end) is not null
        group by (case when p_month is null then month else release_date::text end)) x),
    'monthly_discount', (select coalesce(jsonb_agg(x),'[]') from (
        select (case when p_month is null then month else release_date::text end) as month,
               abs(sum(promotion_cost)) discount
        from f
        where (case when p_month is null then month else release_date::text end) is not null
        group by (case when p_month is null then month else release_date::text end)) x),
    'monthly_ads_cost', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(ad_cost) ad_cost from ads
        where month is not null group by month) x),
    'monthly_costs', (select coalesce(jsonb_agg(x),'[]') from (
        select month,
               abs(sum(promotion_cost)) promotion_cost,
               abs(sum(refund)) refund,
               abs(sum(delivery_cost)) delivery_cost,
               abs(sum(affiliate_cost)) affiliate_cost,
               abs(sum(marketplace_fee)) marketplace_fee,
               abs(sum(misc)) misc
        from f where month is not null group by month) x),
    'payment_method', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(payment_method,'Lainnya') method, count(*) cnt
        from f group by payment_method) x),
    'jasa_kirim', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(jasa_kirim,'Lainnya') service, count(*) cnt
        from f group by jasa_kirim) x),
    'daily', (select coalesce(jsonb_agg(x order by x.tx_date),'[]') from (
        select release_date as tx_date, count(*) orders,
               sum(sales) sales, abs(sum(promotion_cost)) promotion_cost,
               abs(sum(marketplace_fee)) marketplace_fee, sum(net_income) net_income,
               abs(sum(refund)) refund
        from f where release_date is not null group by release_date) x)
  );
$$;

notify pgrst, 'reload config';
