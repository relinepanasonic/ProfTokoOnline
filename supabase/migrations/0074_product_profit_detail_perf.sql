-- =====================================================================
-- 0074: "Detail Product Profit" locked even with the exact right filters
-- (Owner=Nico, Store=nicotest official, Year=2026, Month=Juni — verified
-- has_orders=true and 178 rows when called via service role, bypassing
-- RLS). Timed the same call: 13.5s with RLS BYPASSED entirely — already
-- within striking distance of the function's 30s statement_timeout. Under
-- Nico's real RLS-scoped session (branch_manager) the extra RLS check on
-- order_rows/finance_rows very plausibly pushes it over 30s, the RPC
-- errors out (57014), product_profit_detail() returns nothing, and the
-- frontend's `pd` stays null — has_orders silently defaults to false,
-- which is exactly the locked state reported.
--
-- Root cause of the 13.5s: no index on order_no for either finance_rows
-- or order_rows — the finance<->order proration bridge (migration 0073)
-- joins ord_items(1754 rows) -> order_totals -> fin(1302 rows) on that
-- column with nothing but a sequential scan to find matches.
-- =====================================================================

create index if not exists finance_rows_order_no_idx on finance_rows (client_id, order_no);
create index if not exists order_rows_order_no_idx on order_rows (client_id, order_no);

-- Give this specific function a safer timeout margin than the default
-- 20s role-level limit — same reasoning as refresh_dashboard_rollup()
-- (migration 0060): a function-level SET survives independently of the
-- role limit. The index above is the actual fix; this is the safety net
-- so a slow run fails loud (58014) well before it would otherwise, or —
-- more likely, given the index — just isn't needed anymore.
alter function product_profit_detail(int, text, text, text, text, text)
  set statement_timeout = '45s';

notify pgrst, 'reload config';
