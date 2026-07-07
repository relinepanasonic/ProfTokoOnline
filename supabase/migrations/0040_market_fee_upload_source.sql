-- =====================================================================
-- 0040: allow "market_fee" as an uploads.source value
--
-- The user now uploads the monthly fee sheet directly through the app
-- (CSV or Excel) instead of me pulling it from Google Sheets — same
-- upload-audit-trail convention as every other data source (one `uploads`
-- row per file, for history/delete-by-upload).
-- =====================================================================

alter type data_source add value if not exists 'market_fee';
