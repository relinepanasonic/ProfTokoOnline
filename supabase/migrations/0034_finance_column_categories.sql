-- =====================================================================
-- 0034: Precise column-letter categorization for Detail Keuangan KPIs
--
-- Verified against the real Income export (0 mismatches, 248 rows):
--   sales(H) + promotion_cost(I,K,L,M,N,O) + refund(J) + delivery_cost(P-V)
--   + affiliate_cost(W) + marketplace_fee(X-AE) + misc(AF) == net_income(AG)
--   EXACTLY, using each column's own raw signed value.
--
-- This also fixes a real bug in the original marketplace_fee formula: it
-- wrongly included Biaya Komisi AMS (W, now its own "Affiliate Cost") and
-- Biaya Isi Saldo Otomatis (AF, now "Misc"), and wrongly EXCLUDED
-- "Bea Masuk, PPN & PPh" (AE) entirely.
--
-- IMPORTANT: existing finance_rows uploaded before this migration have
-- marketplace_fee computed under the OLD (wrong) formula and no
-- affiliate_cost/misc values — delete and re-upload those files after
-- this runs.
-- =====================================================================

alter table finance_rows rename column discount_voucher to promotion_cost;
alter table finance_rows rename column shipping_net to delivery_cost;
alter table finance_rows add column if not exists affiliate_cost numeric;
alter table finance_rows add column if not exists misc numeric;

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
    'monthly_fee', (select coalesce(jsonb_agg(x),'[]') from (
        select month, abs(sum(marketplace_fee)) fee
        from f where month is not null group by month) x),
    'monthly_discount', (select coalesce(jsonb_agg(x),'[]') from (
        select month, abs(sum(promotion_cost)) discount
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
