-- 0009_upload_store_summary.sql
-- Per-store aggregated metrics for the Upload page "Data per Store" table.
-- Uses SECURITY INVOKER so RLS on sales_rows is respected (caller's permissions apply).

create or replace function upload_store_summary()
returns table (
  store_name  text,
  pic_client  text,
  gmv         numeric,
  traffic     numeric,
  in_cart     numeric,
  ad_cost     numeric
)
language sql
security invoker
set search_path = public
as $$
  select
    coalesce(store_name, '—')  as store_name,
    coalesce(pic_client, '—')  as pic_client,
    -- GMV: SPOS parent rows "Siap Kirim" sales
    sum(case when source = 'spos' and is_parent = true then coalesce(sales_idr, 0) else 0 end) as gmv,
    -- Traffic: SPOS parent rows visitors
    sum(case when source = 'spos' and is_parent = true then coalesce(visitors,  0) else 0 end) as traffic,
    -- In-Cart: SPOS parent rows
    sum(case when source = 'spos' and is_parent = true then coalesce(in_cart,   0) else 0 end) as in_cart,
    -- Ads Cost: Ads source
    sum(case when source = 'ads'                       then coalesce(ad_cost,   0) else 0 end) as ad_cost
  from sales_rows
  where store_name is not null
  group by store_name, pic_client
  order by gmv desc nulls last
$$;

grant execute on function upload_store_summary() to authenticated;
