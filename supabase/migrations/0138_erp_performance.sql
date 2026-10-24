-- =====================================================================
-- 0138: erp_performance() — the numbers behind GET /api/erp/performance
-- (accounting ERP "Advertiser Dashboard"). One row per STORE per WEEK.
--
-- Reads only the pre-summed tables the dashboards read, so every number equals what
-- the app shows on Dashboard and Ads Performance:
--   dashboard_rollup  source 'spos'  (Performa Produk, parent rows only)
--                     source 'perf'  (Performa Toko, store total)
--   ads_rollup        source 'total' (Data Keseluruhan Iklan)
--                     source 'group' (GMV Max "Inkubasi" + Grup Iklan files)
--
-- Period = the weekly upload's own Monday..Sunday (uploads.meta.tanggal_mulai/berakhir).
-- Slices that have no dates (older uploads) fall back to the week grid: Week N of a month
-- = days (N-1)*7+1 .. N*7, ending at the month's last day. The "Baseline" month is not a
-- period and never produces rows.
--
-- A week is returned when its periodStart is inside [p_from, p_to] (the ERP groups by
-- periodStart). A week may cross a month end (e.g. 23 Feb .. 1 Mar).
--
-- Independent Ads = Total ads - GMV Max - Group Ads, each number clamped at 0 (a negative
-- here means the ads data is wrong, e.g. a duplicated upload; never show it as negative).
-- ad_groups exports have no add-to-cart, so gmvMax / group addToCart are 0 and
-- independent.addToCart equals total.addToCart.
--
-- baselineSales: the store's Baseline snapshot sales, on the store's FIRST returned row
-- only (the ERP sums rows, so repeating it would multiply it). activeSales = that week's sales.
--
-- Callable by the server key only: no grant to anon / authenticated.
-- =====================================================================

create or replace function erp_performance(p_client_id uuid, p_from date, p_to date)
returns jsonb
language sql stable
set statement_timeout = '30s'
as $$
  with
  slices as (
    select distinct year, month, week, store_name from dashboard_rollup
    where client_id = p_client_id and source in ('spos', 'perf', 'ads')
      and store_name is not null and year is not null and month is not null and week is not null
      and lower(btrim(month)) <> 'baseline'
    union
    select distinct year, month, week, store_name from ads_rollup
    where client_id = p_client_id
      and store_name is not null and year is not null and month is not null and week is not null
      and lower(btrim(month)) <> 'baseline'
  ),
  upload_dates as (
    select u.meta->>'store_name' as store_name, (u.meta->>'year')::int as year,
           u.meta->>'bulan' as month, u.meta->>'week' as week,
           max(left(u.meta->>'tanggal_mulai', 10))::date   as d_start,
           max(left(u.meta->>'tanggal_berakhir', 10))::date as d_end
    from uploads u
    where u.client_id = p_client_id and u.source in ('spos', 'perf', 'ads', 'ads_group')
      and u.meta->>'tanggal_mulai'   ~ '^\d{4}-\d{2}-\d{2}'
      and u.meta->>'tanggal_berakhir' ~ '^\d{4}-\d{2}-\d{2}'
      and u.meta->>'year' ~ '^\d+$'
    group by 1, 2, 3, 4
  ),
  dated as (
    select s.year, s.month, s.week, s.store_name,
           coalesce(d.d_start, g.g_start)                    as period_start,
           coalesce(d.d_end, greatest(least(g.g_start + 6, g.m_end), g.g_start)) as period_end
    from slices s
    left join upload_dates d
      on d.store_name = s.store_name and d.year = s.year and d.month = s.month and d.week = s.week
    left join lateral (
      select (make_date(s.year, m.mi, 1) + ((substring(s.week from '(\d+)')::int - 1) * 7))::date as g_start,
             (make_date(s.year, m.mi, 1) + interval '1 month' - interval '1 day')::date           as m_end
      from (select array_position(array['Januari','Februari','Maret','April','Mei','Juni','Juli',
                                        'Agustus','September','Oktober','November','Desember'], s.month) as mi) m
      where m.mi is not null and s.week ~ '\d'
    ) g on true
  ),
  dash as (
    select year, month, week, store_name,
           coalesce(sum(sales_idr)         filter (where source = 'spos'), 0) as sales,
           coalesce(sum(sales_idr)         filter (where source = 'perf'), 0) as gmv,
           coalesce(sum(visitors)          filter (where source = 'spos'), 0) as traffic,
           coalesce(sum(visitor_cart_adds) filter (where source = 'spos'), 0) as add_to_cart,
           coalesce(sum(orders_ready)      filter (where source = 'spos'), 0) as orders,
           coalesce(sum(units)             filter (where source = 'spos'), 0) as items_sold,
           coalesce(sum(product_views)     filter (where source = 'spos'), 0) as product_views,
           coalesce(sum(clicks)            filter (where source = 'spos'), 0) as product_clicks
    from dashboard_rollup
    where client_id = p_client_id and store_name is not null
    group by 1, 2, 3, 4
  ),
  ads as (
    select year, month, week, store_name,
      coalesce(sum(ads_cost)    filter (where source = 'total'), 0) as t_cost,
      coalesce(sum(sales)       filter (where source = 'total'), 0) as t_sales,
      coalesce(sum(view)        filter (where source = 'total'), 0) as t_views,
      coalesce(sum(click)       filter (where source = 'total'), 0) as t_clicks,
      coalesce(sum(add_to_cart) filter (where source = 'total'), 0) as t_atc,
      coalesce(sum(orders)      filter (where source = 'total'), 0) as t_orders,
      coalesce(sum(item_sold)   filter (where source = 'total'), 0) as t_items,
      coalesce(sum(ads_cost)  filter (where source = 'group' and (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as g_cost,
      coalesce(sum(sales)     filter (where source = 'group' and (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as g_sales,
      coalesce(sum(view)      filter (where source = 'group' and (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as g_views,
      coalesce(sum(click)     filter (where source = 'group' and (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as g_clicks,
      coalesce(sum(orders)    filter (where source = 'group' and (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as g_orders,
      coalesce(sum(item_sold) filter (where source = 'group' and (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as g_items,
      coalesce(sum(ads_cost)  filter (where source = 'group' and not (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as r_cost,
      coalesce(sum(sales)     filter (where source = 'group' and not (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as r_sales,
      coalesce(sum(view)      filter (where source = 'group' and not (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as r_views,
      coalesce(sum(click)     filter (where source = 'group' and not (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as r_clicks,
      coalesce(sum(orders)    filter (where source = 'group' and not (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as r_orders,
      coalesce(sum(item_sold) filter (where source = 'group' and not (ads_level = 'incubation' or item_name = 'Shop GMV Max')), 0) as r_items
    from ads_rollup
    where client_id = p_client_id and store_name is not null
    group by 1, 2, 3, 4
  ),
  baseline as (
    select store_name, coalesce(sum(sales_idr) filter (where source = 'spos'), 0) as b_sales
    from dashboard_rollup
    where client_id = p_client_id and lower(btrim(month)) = 'baseline' and store_name is not null
    group by store_name
  ),
  picked as (
    select d.*, row_number() over (partition by d.store_name order by d.period_start, d.week) as rn
    from dated d
    where d.period_start is not null and d.period_start between p_from and p_to
  ),
  final as (
    select
      p.store_name as store, p.period_start, p.period_end,
      coalesce(x.sales, 0) as sales, coalesce(x.gmv, 0) as gmv, coalesce(x.traffic, 0) as traffic,
      coalesce(x.add_to_cart, 0) as add_to_cart, coalesce(x.orders, 0) as orders, coalesce(x.items_sold, 0) as items_sold,
      coalesce(x.product_views, 0) as product_views, coalesce(x.product_clicks, 0) as product_clicks,
      case when p.rn = 1 then coalesce(b.b_sales, 0) else 0 end as baseline_sales,
      a.*
    from picked p
    left join dash x on x.store_name = p.store_name and x.year = p.year and x.month = p.month and x.week = p.week
    left join baseline b on b.store_name = p.store_name
    left join ads a on a.store_name = p.store_name and a.year = p.year and a.month = p.month and a.week = p.week
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'store', f.store,
    'periodStart', f.period_start, 'periodEnd', f.period_end, 'granularity', 'week',
    'sales', greatest(f.sales, 0), 'gmv', greatest(f.gmv, 0), 'traffic', greatest(f.traffic, 0),
    'addToCart', greatest(f.add_to_cart, 0), 'orders', greatest(f.orders, 0), 'itemsSold', greatest(f.items_sold, 0),
    'productViews', greatest(f.product_views, 0), 'productClicks', greatest(f.product_clicks, 0),
    'baselineSales', greatest(f.baseline_sales, 0), 'activeSales', greatest(f.sales, 0),
    'ads', jsonb_build_object(
      'total', jsonb_build_object('cost', greatest(coalesce(f.t_cost,0),0), 'sales', greatest(coalesce(f.t_sales,0),0),
         'views', greatest(coalesce(f.t_views,0),0), 'clicks', greatest(coalesce(f.t_clicks,0),0),
         'addToCart', greatest(coalesce(f.t_atc,0),0), 'orders', greatest(coalesce(f.t_orders,0),0), 'itemsSold', greatest(coalesce(f.t_items,0),0)),
      'gmvMax', jsonb_build_object('cost', greatest(coalesce(f.g_cost,0),0), 'sales', greatest(coalesce(f.g_sales,0),0),
         'views', greatest(coalesce(f.g_views,0),0), 'clicks', greatest(coalesce(f.g_clicks,0),0),
         'addToCart', 0, 'orders', greatest(coalesce(f.g_orders,0),0), 'itemsSold', greatest(coalesce(f.g_items,0),0)),
      'group', jsonb_build_object('cost', greatest(coalesce(f.r_cost,0),0), 'sales', greatest(coalesce(f.r_sales,0),0),
         'views', greatest(coalesce(f.r_views,0),0), 'clicks', greatest(coalesce(f.r_clicks,0),0),
         'addToCart', 0, 'orders', greatest(coalesce(f.r_orders,0),0), 'itemsSold', greatest(coalesce(f.r_items,0),0)),
      'independent', jsonb_build_object(
         'cost',      greatest(coalesce(f.t_cost,0)   - coalesce(f.g_cost,0)   - coalesce(f.r_cost,0), 0),
         'sales',     greatest(coalesce(f.t_sales,0)  - coalesce(f.g_sales,0)  - coalesce(f.r_sales,0), 0),
         'views',     greatest(coalesce(f.t_views,0)  - coalesce(f.g_views,0)  - coalesce(f.r_views,0), 0),
         'clicks',    greatest(coalesce(f.t_clicks,0) - coalesce(f.g_clicks,0) - coalesce(f.r_clicks,0), 0),
         'addToCart', greatest(coalesce(f.t_atc,0), 0),
         'orders',    greatest(coalesce(f.t_orders,0) - coalesce(f.g_orders,0) - coalesce(f.r_orders,0), 0),
         'itemsSold', greatest(coalesce(f.t_items,0)  - coalesce(f.g_items,0)  - coalesce(f.r_items,0), 0))
    )
  ) order by f.period_start, f.store), '[]'::jsonb)
  from final f;
$$;

revoke all on function erp_performance(uuid, date, date) from public, anon, authenticated;
grant execute on function erp_performance(uuid, date, date) to service_role;

notify pgrst, 'reload config';
