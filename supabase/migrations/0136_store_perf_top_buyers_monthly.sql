-- =====================================================================
-- 0136: Demographic page additions (Order Completed data, order_rows).
--
-- store_perf_top_buyers(): top buyer usernames by sales for the page's
--   filters, plus the exact total orders / total sales of the same filter
--   (so "Avg Sales per Transaction" = AOV is computed over the same set
--   as the "Total Transaction" KPI). One row per distinct order first
--   (total_payment is order-level and repeated on each line -> max), then
--   grouped by buyer. Sales = Total Pembayaran, same as the province/city
--   GMV on this page.
--
-- store_perf_monthly(): distinct orders per month for the store, ignoring
--   the page's Month / Week filter, for the Total Transaction mini chart.
--   Grouped by (year, month) so months of different years never merge.
-- =====================================================================

create or replace function store_perf_top_buyers(
  p_client_id uuid,
  p_year  int  default null,
  p_month text default null,
  p_week  text default null,
  p_owner text default null,
  p_store text default null,
  p_limit int  default 5
) returns jsonb
language sql stable
set statement_timeout = '30s'
as $$
  with orders as (
    select
      r.order_no,
      max(r.buyer_username)        as buyer,
      max(r.total_payment)         as gmv,
      sum(coalesce(r.qty, 0))      as units
    from order_rows r
    where r.client_id = p_client_id
      and r.order_no is not null
      and (p_year  is null or r.year        = p_year)
      and (p_month is null or r.month       = p_month)
      and (p_week  is null or r.week        = p_week)
      and (p_owner is null or r.pic_client  = p_owner)
      and (p_store is null or r.store_name  = p_store)
    group by r.order_no
  ),
  by_buyer as (
    select buyer, count(*) as orders, coalesce(sum(gmv), 0) as gmv, coalesce(sum(units), 0) as units
    from orders
    where buyer is not null and btrim(buyer) <> ''
    group by buyer
  )
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('username', buyer, 'orders', orders, 'gmv', gmv, 'units', units)
                                       order by gmv desc, buyer), '[]'::jsonb)
             from (select * from by_buyer order by gmv desc, buyer limit greatest(p_limit, 1)) x),
    'total_orders', (select count(*) from orders),
    'total_gmv',    (select coalesce(sum(gmv), 0) from orders)
  );
$$;

create or replace function store_perf_monthly(
  p_client_id uuid,
  p_year  int  default null,
  p_owner text default null,
  p_store text default null
) returns jsonb
language sql stable
set statement_timeout = '30s'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('year', year, 'month', month, 'orders', orders) order by year, month), '[]'::jsonb)
  from (
    select r.year, r.month, count(distinct r.order_no) as orders
    from order_rows r
    where r.client_id = p_client_id
      and r.month is not null and r.order_no is not null
      and (p_year  is null or r.year        = p_year)
      and (p_owner is null or r.pic_client  = p_owner)
      and (p_store is null or r.store_name  = p_store)
    group by r.year, r.month
  ) x;
$$;

notify pgrst, 'reload config';
