-- =====================================================================
-- 0033: finance_filters() RPC — fixes the Month/Year dropdown missing
-- months once uploads exceed 1000 total rows.
--
-- FinanceDashboard.tsx was deriving Year/Month options by fetching every
-- finance_rows row (select year,month,week,...) and de-duping client-side.
-- Supabase/PostgREST caps a plain select() at 1000 rows by default — once
-- Mei + Juni uploads together exceeded that, Juni's rows were silently
-- truncated out of the response, so "Juni" never appeared as an option.
--
-- Fix: a server-side DISTINCT aggregation (same pattern as
-- dashboard_filters()), so the full row set never has to leave Postgres.
-- =====================================================================

create index if not exists finance_rows_year_only_idx  on finance_rows (year)  where year  is not null;
create index if not exists finance_rows_month_only_idx on finance_rows (month) where month is not null;

create or replace function finance_filters() returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'years',  (select coalesce(jsonb_agg(distinct year order by year desc), '[]') from finance_rows where year  is not null),
    'months', (select coalesce(jsonb_agg(distinct month), '[]')                  from finance_rows where month is not null)
  );
$$;
