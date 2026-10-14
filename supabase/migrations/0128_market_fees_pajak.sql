-- =====================================================================
-- 0128: "Pajak" (tax, % of Harga Jual) on the Marketplace Fee table.
-- Uploaded with the marketplace fee file (header "Pajak"), editable inline,
-- and counted as a cost in the Price Calculator's Total Biaya.
-- Existing rows get 0 until a fee file with a Pajak column is uploaded.
-- =====================================================================

alter table market_fees      add column if not exists pajak_pct numeric not null default 0;
alter table market_fee_edits add column if not exists pajak_pct numeric;

notify pgrst, 'reload config';
