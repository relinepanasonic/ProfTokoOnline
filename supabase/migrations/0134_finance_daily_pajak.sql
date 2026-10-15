-- =====================================================================
-- 0134: Pajak per day for the Earning page's Daily Transaction Detail.
--
-- finance_summary()'s daily rows (keyed by release date) don't carry Pajak,
-- and its marketplace_fee INCLUDES pajak for orders from the newer Penghasilan
-- report (see 0129). This returns just the Pajak per release date so the page
-- can show it as its own column and subtract it from the Marketplace Fee
-- column (no double count). Days / months uploaded in the older layout have
-- pajak = 0 and are simply absent here.
-- =====================================================================

create or replace function finance_daily_pajak(
  p_year  int  default null,
  p_month text default null,
  p_week  text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
set statement_timeout = '30s'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tx_date', tx_date, 'pajak', pajak) order by tx_date), '[]'::jsonb)
  from (
    select release_date as tx_date, abs(sum(pajak)) as pajak
    from finance_rows
    where release_date is not null
      and (p_year  is null or year        = p_year)
      and (p_month is null or month       = p_month)
      and (p_week  is null or week        = p_week)
      and (p_owner is null or pic_client  = p_owner)
      and (p_brand is null or brand       = p_brand)
      and (p_store is null or store_name  = p_store)
    group by release_date
    having sum(pajak) <> 0
  ) x;
$$;

notify pgrst, 'reload config';
