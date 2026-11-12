-- =====================================================================
-- 0140: erp_top_products() — the numbers behind GET /api/erp/top-products
-- (accounting ERP weekly report, page 2: the store's best-selling products).
--
-- ONLY ADDS A FUNCTION. Nothing existing is changed or dropped.
--
-- Product sales = dashboard_rollup source 'spos' (Performa Produk, parent rows only), summed
-- sales_idr per item_name — the same definition as the monthly PDF's "Top 10 Produk Terlaris"
-- (dashboard_summary.top_products) and as `sales` in erp_performance().
--
-- Which weeks count: the SAME dating logic as erp_performance() (0138) — a week is picked when its
-- periodStart (its Monday) is inside [p_from, p_to]. So Monday..Sunday 2026-11-09..2026-11-15 returns
-- exactly the week starting 2026-11-09 and no neighbouring week. A week cannot be split (the product
-- export is a weekly total). Over several weeks each product is summed, then ranked.
--
-- `store` is dashboard_rollup.store_name verbatim (identical to erp_performance's `store`);
-- `workspace` is always '' (this app has no workspaces). `name` is trimmed, never cut; a product
-- without a name is skipped, and so is one without positive sales. Ties sort by name A..Z.
-- p_limit is clamped to 1..20.
--
-- Callable by the server key only: no grant to anon / authenticated.
-- =====================================================================

create or replace function erp_top_products(p_client_id uuid, p_from date, p_to date, p_limit int default 10)
returns jsonb
language sql stable
set statement_timeout = '30s'
as $$
  with
  slices as (
    select distinct year, month, week, store_name from dashboard_rollup
    where client_id = p_client_id and source = 'spos'
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
           coalesce(d.d_start, g.g_start) as period_start
    from slices s
    left join upload_dates d
      on d.store_name = s.store_name and d.year = s.year and d.month = s.month and d.week = s.week
    left join lateral (
      select (make_date(s.year, m.mi, 1) + ((substring(s.week from '(\d+)')::int - 1) * 7))::date as g_start
      from (select array_position(array['Januari','Februari','Maret','April','Mei','Juni','Juli',
                                        'Agustus','September','Oktober','November','Desember'], s.month) as mi) m
      where m.mi is not null and s.week ~ '\d'
    ) g on true
  ),
  picked as (
    select * from dated
    where period_start is not null and period_start between p_from and p_to
  ),
  prod as (
    select r.store_name, btrim(r.item_name) as name, sum(r.sales_idr) as sales
    from dashboard_rollup r
    join picked p
      on p.store_name = r.store_name and p.year = r.year and p.month = r.month and p.week = r.week
    where r.client_id = p_client_id and r.source = 'spos'
      and r.item_name is not null and btrim(r.item_name) <> ''
    group by r.store_name, btrim(r.item_name)
    having sum(r.sales_idr) > 0
  ),
  ranked as (
    select store_name, name, sales,
           row_number() over (partition by store_name order by sales desc, name asc) as rn
    from prod
  ),
  per_store as (
    select store_name,
           jsonb_agg(jsonb_build_object('name', name, 'sales', sales) order by sales desc, name asc) as products
    from ranked
    where rn <= least(greatest(coalesce(p_limit, 10), 1), 20)
    group by store_name
  )
  select coalesce(jsonb_agg(
    jsonb_build_object('store', store_name, 'workspace', '', 'products', products) order by store_name
  ), '[]'::jsonb)
  from per_store;
$$;

revoke all on function erp_top_products(uuid, date, date, int) from public, anon, authenticated;
grant execute on function erp_top_products(uuid, date, date, int) to service_role;

notify pgrst, 'reload config';
