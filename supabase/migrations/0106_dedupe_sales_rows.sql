-- =====================================================================
-- 0106: One-time cleanup — remove duplicate re-uploads from sales_rows
-- and ad_groups.
--
-- THE PROBLEM: uploads are append-only with no dedup. Every row from one
-- upload shares the same (client_id, source, year, month, week,
-- store_name) — see mapRow() in src/lib/parse.ts, which stamps all of
-- those from the uploader's manual selection. So re-uploading the same
-- file (or the same week after a failed attempt) appends a COMPLETE
-- SECOND COPY rather than replacing the first.
--
-- Across the long run of upload failures that led here (0102/0104/0105 —
-- rollups silently timing out, uploads reporting success, the team
-- retrying), this has very likely accumulated several duplicate copies of
-- the same weeks. That is both a bloat source AND a correctness bug:
-- duplicated rows double-count sales, traffic and ad spend on every
-- dashboard.
--
-- THE RULE: for each (client_id, source, year, month, week, store_name)
-- slice, only the MOST RECENT upload's rows are kept; rows from older
-- uploads of the same slice are deleted. That is exactly the semantics
-- the new idempotent upload path enforces going forward (see 0107 +
-- /api/upload's delete-before-insert).
--
-- ── RUN THE TWO PREVIEW QUERIES FIRST. Look at the numbers before you
-- uncomment the deletes. This removes real rows. ──
-- =====================================================================

-- ── PREVIEW 1: how many duplicate slices exist, and how many rows would
-- be removed. `keep_upload` is the upload that survives per slice. ──
with slices as (
  select
    s.client_id, s.source, s.year, s.month, s.week, s.store_name,
    s.upload_id,
    count(*) as rows_in_upload,
    max(u.created_at) as uploaded_at
  from sales_rows s
  join uploads u on u.id = s.upload_id
  group by s.client_id, s.source, s.year, s.month, s.week, s.store_name, s.upload_id
),
ranked as (
  select *, row_number() over (
    partition by client_id, source, year, month, week, store_name
    order by uploaded_at desc, upload_id desc
  ) as rn
  from slices
)
select
  count(*) filter (where rn > 1)                         as duplicate_uploads,
  coalesce(sum(rows_in_upload) filter (where rn > 1), 0) as rows_to_delete,
  coalesce(sum(rows_in_upload), 0)                       as rows_total
from ranked;

-- ── PREVIEW 2: the affected slices in detail, worst first. ──
with slices as (
  select
    s.client_id, s.source, s.year, s.month, s.week, s.store_name,
    s.upload_id,
    count(*) as rows_in_upload,
    max(u.created_at) as uploaded_at
  from sales_rows s
  join uploads u on u.id = s.upload_id
  group by s.client_id, s.source, s.year, s.month, s.week, s.store_name, s.upload_id
),
ranked as (
  select *, row_number() over (
    partition by client_id, source, year, month, week, store_name
    order by uploaded_at desc, upload_id desc
  ) as rn
  from slices
)
select store_name, source, year, month, week,
       count(*)              as copies,
       sum(rows_in_upload)   as total_rows,
       sum(rows_in_upload) filter (where rn > 1) as rows_to_delete
from ranked
group by client_id, source, year, month, week, store_name
having count(*) > 1
order by sum(rows_in_upload) filter (where rn > 1) desc nulls last
limit 100;


-- ─────────────────────────────────────────────────────────────────────
-- APPLY — uncomment after the previews look right.
-- ─────────────────────────────────────────────────────────────────────
--
-- delete from sales_rows s
-- using (
--   with slices as (
--     select s2.upload_id, s2.client_id, s2.source, s2.year, s2.month, s2.week, s2.store_name,
--            max(u.created_at) as uploaded_at
--     from sales_rows s2
--     join uploads u on u.id = s2.upload_id
--     group by s2.upload_id, s2.client_id, s2.source, s2.year, s2.month, s2.week, s2.store_name
--   ),
--   ranked as (
--     select *, row_number() over (
--       partition by client_id, source, year, month, week, store_name
--       order by uploaded_at desc, upload_id desc
--     ) as rn
--     from slices
--   )
--   select upload_id from ranked where rn > 1
-- ) stale
-- where s.upload_id = stale.upload_id;
--
-- -- Same rule for the ad-group landing table (Inkubasi / Group Ads
-- -- re-uploads duplicate identically). Its slice key has no `source`.
-- delete from ad_groups g
-- using (
--   with slices as (
--     select g2.upload_id, g2.client_id, g2.year, g2.month, g2.week, g2.store_name, g2.grup_iklan,
--            max(u.created_at) as uploaded_at
--     from ad_groups g2
--     join uploads u on u.id = g2.upload_id
--     group by g2.upload_id, g2.client_id, g2.year, g2.month, g2.week, g2.store_name, g2.grup_iklan
--   ),
--   ranked as (
--     select *, row_number() over (
--       partition by client_id, year, month, week, store_name, grup_iklan
--       order by uploaded_at desc, upload_id desc
--     ) as rn
--     from slices
--   )
--   select upload_id from ranked where rn > 1
-- ) stale
-- where g.upload_id = stale.upload_id;
--
-- -- Mark the superseded upload log entries so the Upload Log reflects
-- -- reality instead of showing rows that no longer exist.
-- update uploads set row_count = 0
-- where id in (
--   select u.id from uploads u
--   where not exists (select 1 from sales_rows s where s.upload_id = u.id)
--     and not exists (select 1 from ad_groups g where g.upload_id = u.id)
--     and u.row_count > 0
-- );
--
-- -- Rebuild every derived table once from the now-clean data.
-- select refresh_dashboard_rollup();
-- select refresh_ads_rollup();
-- select refresh_product_catalog();
