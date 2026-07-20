-- =====================================================================
-- 0091: Daily drilldown for Finance Detail charts.
--
-- finance_rows has a real per-transaction date (release_date), so unlike
-- Dashboard/Ads (weekly), Finance can honestly drill to DAILY. When a
-- specific month is selected:
--   * monthly_fee / monthly_discount bucket by release_date instead of
--     month (output key stays `month`, value = ISO date string).
--   * a new `daily_gross` series returns per-day Gross Sales + Gross
--     Profit — both real per-row finance_rows fields. This replaces the
--     "Gross Sales vs Nett Profit" chart when zoomed, because Nett Profit
--     subtracts monthly-only ad-spend + product modal and therefore has
--     no honest daily form.
--
-- `monthly` (sales, profit) is unchanged and still drives the monthly
-- Gross-vs-Nett chart when All Months is selected. daily_gross is empty
-- unless p_month is set (avoids shipping a full-history daily series).
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
        'gross_profit',     coalesce(sum(net_income),0)
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
