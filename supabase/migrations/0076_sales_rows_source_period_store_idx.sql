-- =====================================================================
-- 0076: product_profit_detail() still slow (10-15s) after migration 0075
-- dropped the order_rows join — traced to sales_rows itself, not the
-- join. Verified live: a plain filtered COUNT on sales_rows
-- (client_id + source='spos' + year + month + store_name, only 213
-- matching rows) took over a second by itself. The only composite index
-- covering this shape is sales_rows_client_dims_idx
-- (client_id, year, month, CITY, store_name, source) — city sits between
-- month and store_name and this query never filters by city, so Postgres
-- can't use the index past `month` for this query pattern (a B-tree
-- composite index can't skip an unconstrained middle column and still
-- use the columns after it). sales_rows_client_source_idx (0065) is
-- (client_id, source) only — too coarse to narrow past ~112k+ rows/client
-- before a heap filter for year/month/store_name.
--
-- New index matches exactly what product_profit_detail()'s base and
-- ads_by_product CTEs filter by, in that order.
-- =====================================================================

create index if not exists sales_rows_source_period_store_idx
  on sales_rows (client_id, source, year, month, store_name);

-- Give product_profit_detail() a safety margin in case RLS overhead on
-- top of the (now much cheaper) query still pushes it close to the 30s
-- role-level default — same pattern as 0060/0074.
alter function product_profit_detail(int, text, text, text, text, text)
  set statement_timeout = '45s';

notify pgrst, 'reload config';
