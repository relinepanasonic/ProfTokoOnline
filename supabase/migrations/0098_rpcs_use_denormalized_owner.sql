-- =====================================================================
-- 0098: Follow-up to 0097 — make the RPCs use the denormalized `owner`
-- column too, eliminating the last store_links subqueries from the query
-- side.
--
-- 0097 removed the subquery from the RLS policies (the measured 12.1s
-- bottleneck). The same `store_name in (select ... from store_links ...)`
-- shape still existed in the RPC WHERE clauses for p_owner. Now that
-- dashboard_rollup / ads_rollup carry `owner` (indexed via
-- {dashboard,ads}_rollup_client_owner_idx), those collapse to a plain
-- column equality.
--
-- The (p_owner is null or ...) guard is kept — harmless now that the
-- right-hand side is a trivial column comparison rather than a
-- correlated subquery.
--
-- p_brand is deliberately LEFT on its store_links subquery: the rollup's
-- own `brand` column is the auto-detected value from sales_rows, which is
-- not always the business brand from the Core List (see migration 0053,
-- "fix brand from store_links"). Swapping it would silently change which
-- rows a Brand filter returns — out of scope here.
--
-- Function bodies are otherwise byte-for-byte identical to 0094
-- (dashboard_summary), 0096 (dashboard_filters) and 0090
-- (ads_dashboard_summary). Signatures are unchanged, so no PGRST203 risk
-- and no frontend change.
-- =====================================================================

create or replace function dashboard_summary(
  p_client_id uuid,
  p_year  int  default null,
  p_month text default null,
  p_city  text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with base as (
    select r.year, r.city, r.store_name, r.source, r.month, r.week, r.ad_type,
           r.sales_idr, r.visitors, r.in_cart, r.orders, r.orders_ready, r.orders_created,
           r.product_views, r.visitor_cart_adds, r.ad_cost, r.clicks, r.add_to_cart,
           r.item_name, r.brand, r.product_type
    from dashboard_rollup r
    where r.client_id = p_client_id
      and (p_year  is null or r.year       = p_year)
      and (p_city  is null or r.city       = p_city)
      and (p_store is null or r.store_name = p_store)
      and (p_owner is null or r.owner      = p_owner)
      and (p_brand is null or r.store_name in (
            select sl.store_name from store_links sl where sl.client_id = p_client_id and sl.brand = p_brand and sl.store_name is not null))
  ),
  f_real as (
    select * from base
    where (p_month is null or month = p_month)
      and (p_month is not null or coalesce(lower(trim(month)), '') <> 'baseline')
  ),
  trend_by_store as (
    select store_name,
           coalesce(jsonb_agg(x order by array_position(
             array['Januari','Februari','Maret','April','Mei','Juni','Juli',
                   'Agustus','September','Oktober','November','Desember'], x.month)), '[]') as trend
    from (
      select b.store_name, b.month,
             sum(b.sales_idr)   filter (where b.source='spos') as sales,
             sum(b.ad_cost)     filter (where b.source='ads')  as ad_cost
      from base b
      join dashboard_month_completeness c
        on c.store_name = b.store_name and c.month = b.month and c.week_count >= 4
      where b.store_name is not null
        and b.source in ('spos','ads')
        and coalesce(lower(trim(b.month)), '') <> 'baseline'
      group by b.store_name, b.month
    ) x
    group by store_name
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'sales',          coalesce(sum(sales_idr) filter (where source='spos'),0),
        'gmv',            coalesce(sum(sales_idr) filter (where source='perf'),0),
        'traffic',        coalesce(sum(visitors)  filter (where source='spos'),0),
        'in_cart',        coalesce(sum(in_cart)   filter (where source='spos'),0),
        'orders',         coalesce(sum(orders)    filter (where source='spos'),0),
        'transactions',   coalesce(sum(orders_ready)      filter (where source='spos'),0),
        'orders_created', coalesce(sum(orders_created)    filter (where source='spos'),0),
        'product_views',  coalesce(sum(product_views)     filter (where source='spos'),0),
        'visitor_cart_adds', coalesce(sum(visitor_cart_adds) filter (where source='spos'),0),
        'ad_cost',        coalesce(sum(ad_cost)   filter (where source='ads'),0),
        'roas',           coalesce(sum(sales_idr) filter (where source='spos'),0)
                          / nullif(sum(ad_cost) filter (where source='ads'),0)
      ) from f_real
    ),
    'perf_trend', (select coalesce(jsonb_agg(x),'[]') from (
        select (case when p_month is null then month else week end) as bucket,
               coalesce(sum(sales_idr) filter (where source='spos'),0) sales,
               coalesce(sum(visitors)  filter (where source='spos'),0) traffic,
               coalesce(sum(in_cart)   filter (where source='spos'),0) in_cart
        from f_real
        where (case when p_month is null then month else week end) is not null
        group by (case when p_month is null then month else week end)) x),
    'monthly_sales', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(sales_idr) sales
        from f_real where source='spos' and month is not null
        group by month) x),
    'store_monthly', (select coalesce(jsonb_agg(x),'[]') from (
        select month, sum(sales_idr) gmv
        from f_real where source='perf' and month is not null
        group by month) x),
    'top_products', (select coalesce(jsonb_agg(x),'[]') from (
        select item_name name, sum(sales_idr) sales
        from f_real where source='spos' and item_name is not null
        group by item_name order by sum(sales_idr) desc nulls last limit 10) x),
    'brand_share', (select coalesce(jsonb_agg(x order by x.sales desc),'[]') from (
        select brand, sum(sales_idr) sales
        from f_real where source='spos' and brand is not null
        group by brand) x),
    'by_category', (select coalesce(jsonb_agg(x order by x.sales desc),'[]') from (
        select coalesce(product_type,'Others') category, sum(sales_idr) sales
        from f_real where source='spos'
        group by product_type) x),
    'cost_roas', (select coalesce(jsonb_agg(x),'[]') from (
        select month,
               coalesce(sum(ad_cost) filter (where source='ads'),0) cost,
               coalesce(sum(sales_idr) filter (where source='spos'),0)
                 / nullif(sum(ad_cost) filter (where source='ads'),0) roas
        from f_real where month is not null group by month) x),
    'traffic_trend', (select coalesce(jsonb_agg(x),'[]') from (
        select month,
               coalesce(sum(visitors) filter (where source='spos'),0) traffic,
               coalesce(sum(in_cart)  filter (where source='spos'),0) in_cart,
               coalesce(sum(orders_ready) filter (where source='spos'),0) transactions,
               coalesce(sum(visitor_cart_adds) filter (where source='spos'),0) visitor_cart_adds
        from f_real where month is not null group by month) x),
    'avg_store_trend', (select coalesce(jsonb_agg(x order by x.avg_sales desc),'[]') from (
        select store_name, sum(store_sales) / count(distinct month) avg_sales
        from (
          select store_name, month, sum(sales_idr) store_sales
          from base
          where source='spos' and store_name is not null
            and coalesce(lower(trim(month)),'') <> 'baseline'
          group by store_name, month
        ) y
        group by store_name) x),
    'top_campaigns', (select coalesce(jsonb_agg(x),'[]') from (
        select item_name name, store_name,
               sum(visitors) views, sum(clicks) clicks, sum(add_to_cart) add_to_cart,
               sum(orders) orders, sum(sales_idr) sales, sum(ad_cost) ad_cost
        from f_real
        where source='ads' and item_name is not null and sales_idr is not null
          and item_name <> 'Shop GMV Max' and ad_type is not null
        group by item_name, store_name order by sum(sales_idr) desc nulls last limit 8) x),
    'dealers', (select coalesce(jsonb_agg(y order by y.sales desc nulls last),'[]') from (
        select x.*, coalesce(tbs.trend, '[]') as trend
        from (
          select
            d.store_name, d.city,
            coalesce(sum(d.sales_idr) filter (where d.source='spos'),0) sales,
            coalesce(sum(d.visitors)  filter (where d.source='spos'),0) traffic,
            coalesce(sum(d.in_cart)   filter (where d.source='spos'),0) in_cart,
            coalesce(sum(d.orders)    filter (where d.source='spos'),0) orders,
            coalesce(sum(d.ad_cost)   filter (where d.source='ads'),0)  ad_cost,
            coalesce(sum(d.sales_idr) filter (where d.source='spos'),0)
              / nullif(sum(d.ad_cost) filter (where d.source='ads'),0)  roas
          from f_real d
          where d.store_name is not null
          group by d.store_name, d.city
        ) x
        left join trend_by_store tbs on tbs.store_name = x.store_name
      ) y)
  );
$$;

create or replace function dashboard_filters(p_client_id uuid default null, p_owner text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'years',  coalesce((select jsonb_agg(distinct year order by year desc)
                         from dashboard_rollup r
                         where r.year is not null
                           and (p_client_id is null or r.client_id = p_client_id)
                           and (p_owner is null or r.owner = p_owner)), '[]'),
    'months', coalesce((select jsonb_agg(distinct month)
                         from dashboard_rollup r
                         where r.month is not null
                           and (p_client_id is null or r.client_id = p_client_id)
                           and (p_owner is null or r.owner = p_owner)), '[]'),
    'stores', coalesce((select jsonb_agg(distinct store_name order by store_name)
                         from store_links
                         where store_name is not null
                           and (p_client_id is null or client_id = p_client_id)
                           and (p_owner is null or owner = p_owner)), '[]')
  );
$$;

create or replace function ads_dashboard_summary(
  p_year  int  default null,
  p_month text default null,
  p_owner text default null,
  p_brand text default null,
  p_store text default null
) returns jsonb
language sql stable
as $$
  with base as (
    select source, year, month, week, store_name, item_name, kode_produk, ads_level,
           ads_cost, sales, view, click, add_to_cart, orders, item_sold
    from ads_rollup
    where (p_year  is null or year  = p_year)
      and (p_month is null or month = p_month)
      and (p_store is null or store_name = p_store)
      and (p_owner is null or owner = p_owner)
      and (p_brand is null or store_name in (select sl.store_name from store_links sl where sl.brand = p_brand and sl.store_name is not null))
  ),
  ads_base    as (select * from base where source = 'total'),
  grp_totals  as (select * from base where source = 'group'),
  grp_products as (select * from base where source = 'product'),
  gmv_rows   as (select * from grp_totals where ads_level = 'incubation' or item_name = 'Shop GMV Max'),
  group_rows as (select * from grp_totals where not (ads_level = 'incubation' or item_name = 'Shop GMV Max')),

  t_total as (
    select coalesce(sum(ads_cost),0) ads_cost, coalesce(sum(sales),0) sales,
           coalesce(sum(view),0) view, coalesce(sum(click),0) click,
           coalesce(sum(add_to_cart),0) add_to_cart,
           coalesce(sum(orders),0) orders, coalesce(sum(item_sold),0) item_sold
    from ads_base
  ),
  t_gmv as (
    select coalesce(sum(ads_cost),0) ads_cost, coalesce(sum(sales),0) sales,
           coalesce(sum(view),0) view, coalesce(sum(click),0) click,
           coalesce(sum(orders),0) orders, coalesce(sum(item_sold),0) item_sold
    from gmv_rows
  ),
  t_group as (
    select coalesce(sum(ads_cost),0) ads_cost, coalesce(sum(sales),0) sales,
           coalesce(sum(view),0) view, coalesce(sum(click),0) click,
           coalesce(sum(orders),0) orders, coalesce(sum(item_sold),0) item_sold
    from group_rows
  ),

  products_ads as (
    select kode_produk, item_name as nama_produk, ads_cost, sales, view, click, orders, item_sold
    from ads_base where kode_produk is not null
  ),
  products_grp as (
    select kode_produk, item_name as nama_produk, ads_cost, sales, view, click, orders, item_sold
    from grp_products where kode_produk is not null
  ),
  products_all as (select * from products_ads union all select * from products_grp)

  select jsonb_build_object(
    'totals', jsonb_build_object(
      'total', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'sales', t.sales, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.sales / nullif(t.ads_cost,0)
      ) from t_total t),
      'gmv_max', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'sales', t.sales, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.sales / nullif(t.ads_cost,0)
      ) from t_gmv t),
      'group_ads', (select jsonb_build_object(
        'ads_cost', t.ads_cost, 'sales', t.sales, 'view', t.view, 'click', t.click,
        'orders', t.orders, 'item_sold', t.item_sold,
        'roas', t.sales / nullif(t.ads_cost,0)
      ) from t_group t),
      'independent', (select jsonb_build_object(
        'ads_cost', tot.ads_cost - g.ads_cost - grp.ads_cost,
        'sales',    tot.sales    - g.sales    - grp.sales,
        'view',     tot.view     - g.view     - grp.view,
        'click',    tot.click    - g.click    - grp.click,
        'orders',   tot.orders   - g.orders   - grp.orders,
        'item_sold',tot.item_sold- g.item_sold- grp.item_sold,
        'roas',     (tot.sales - g.sales - grp.sales)
                    / nullif(tot.ads_cost - g.ads_cost - grp.ads_cost, 0)
      ) from t_total tot, t_gmv g, t_group grp)
    ),
    'funnel', (select jsonb_build_object(
      'view', t.view, 'click', t.click, 'add_to_cart', t.add_to_cart, 'orders', t.orders
    ) from t_total t),
    'monthly', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      with buckets as (
        select distinct (case when p_month is null then month else week end) as b from ads_base   where (case when p_month is null then month else week end) is not null
        union select distinct (case when p_month is null then month else week end) from gmv_rows   where (case when p_month is null then month else week end) is not null
        union select distinct (case when p_month is null then month else week end) from group_rows where (case when p_month is null then month else week end) is not null
      ),
      a  as (select (case when p_month is null then month else week end) as b, sum(sales) sales, sum(ads_cost) ads_cost from ads_base   group by 1),
      gm as (select (case when p_month is null then month else week end) as b, sum(sales) sales                        from gmv_rows   group by 1),
      gr as (select (case when p_month is null then month else week end) as b, sum(sales) sales                        from group_rows group by 1)
      select
        bk.b as month,
        coalesce(gm.sales,0) gmv_max_sales,
        coalesce(gr.sales,0) group_sales,
        coalesce(a.sales,0) - coalesce(gm.sales,0) - coalesce(gr.sales,0) as independent_sales,
        coalesce(a.sales,0) / nullif(coalesce(a.ads_cost,0),0) as roas
      from buckets bk
      left join a  on a.b  = bk.b
      left join gm on gm.b = bk.b
      left join gr on gr.b = bk.b
    ) x),
    'sold_sales_trend', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
      select (case when p_month is null then month else week end) as month,
             sum(item_sold) item_sold, sum(sales) sales
      from ads_base
      where (case when p_month is null then month else week end) is not null
      group by (case when p_month is null then month else week end)
    ) x),
    'groups', (select coalesce(jsonb_agg(x order by x.sales desc nulls last), '[]') from (
        select
          (array_agg(item_name order by item_name))[1] as nama_iklan,
          sum(ads_cost) ads_cost, sum(sales) sales,
          sum(sales) / nullif(sum(ads_cost),0) roas,
          sum(view) view, sum(click) click, sum(orders) orders, sum(item_sold) item_sold
        from grp_totals
        where item_name is not null
        group by lower(trim(item_name))
    ) x),
    'products', (select coalesce(jsonb_agg(x order by x.sales desc nulls last), '[]') from (
      select kode_produk,
             (array_agg(nama_produk) filter (where nama_produk is not null))[1] as nama_produk,
             sum(ads_cost) ads_cost, sum(sales) sales,
             sum(sales) / nullif(sum(ads_cost),0) roas,
             sum(view) view, sum(click) click, sum(orders) orders, sum(item_sold) item_sold
      from products_all
      group by kode_produk
    ) x)
  );
$$;

notify pgrst, 'reload config';
