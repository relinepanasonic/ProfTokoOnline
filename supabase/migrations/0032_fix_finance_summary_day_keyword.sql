-- =====================================================================
-- 0032: Fix syntax error in finance_summary() — "day" is a reserved
-- keyword in Postgres grammar and can't be used as a bare column alias.
-- Renamed to tx_date (JSON key in the 'daily' array is now "tx_date",
-- not "day" — the frontend is updated to match).
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
        'discount_voucher', coalesce(sum(discount_voucher),0),
        'marketplace_fee',  coalesce(sum(marketplace_fee),0),
        'gross_profit',     coalesce(sum(net_income),0),
        'refund',           coalesce(sum(refund),0)
      ) from f
    ),
    'monthly', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(sales) sales, sum(net_income) profit
        from f where month is not null group by month) x),
    'monthly_fee', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(marketplace_fee) fee
        from f where month is not null group by month) x),
    'monthly_discount', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(discount_voucher) discount
        from f where month is not null group by month) x),
    'payment_method', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(payment_method,'Lainnya') method, count(*) cnt
        from f group by payment_method) x),
    'jasa_kirim', (select coalesce(jsonb_agg(x order by x.cnt desc),'[]') from (
        select coalesce(jasa_kirim,'Lainnya') service, count(*) cnt
        from f group by jasa_kirim) x),
    'daily', (select coalesce(jsonb_agg(x order by x.tx_date),'[]') from (
        select release_date as tx_date, count(*) orders,
               sum(sales) sales, sum(discount_voucher) discount_voucher,
               sum(marketplace_fee) marketplace_fee, sum(net_income) net_income,
               sum(refund) refund
        from f where release_date is not null group by release_date) x)
  );
$$;
