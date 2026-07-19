-- =====================================================================
-- 0080: ads_rollup_filters() — years/months for the new Ads Performance
-- filter bar (Owner/Brand/Store come from store_links, same convention as
-- the main Dashboard and Operational Performance). Scoped to ads_rollup
-- itself rather than reusing dashboard_filters()/dashboard_rollup, since
-- an ads-only upload can exist for a year/month with no sales upload yet.
-- =====================================================================

create or replace function ads_rollup_filters() returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'years',  (select coalesce(jsonb_agg(distinct year order by year desc), '[]') from ads_rollup where year  is not null),
    'months', (select coalesce(jsonb_agg(distinct month), '[]')                  from ads_rollup where month is not null)
  );
$$;

notify pgrst, 'reload config';
