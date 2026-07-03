-- =====================================================================
-- 0025: Make ad_formulation thresholds unique PER STORE (not client-wide)
-- Previously one row per (client_id, year, month) meant every store shared
-- the same thresholds — saving for one store silently overwrote the value
-- shown for every other store. Add store_name and re-key the uniqueness.
-- =====================================================================

alter table ad_formulation add column if not exists store_name text;

-- drop the old client-wide unique constraint, add the per-store one.
-- store_name is required (an empty '' bucket is used for "no store picked"
-- so upsert onConflict always has a stable target — NULL can't be used in
-- a plain UNIQUE constraint match for ON CONFLICT).
alter table ad_formulation alter column store_name set default '';
update ad_formulation set store_name = '' where store_name is null;
alter table ad_formulation alter column store_name set not null;

alter table ad_formulation drop constraint if exists ad_formulation_client_id_year_month_key;
alter table ad_formulation add constraint ad_formulation_client_store_year_month_key
  unique (client_id, store_name, year, month);
