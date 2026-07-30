# Runbook — permanently fixing the 57014 / bloat cycle

Run these **in order**, in the Supabase SQL Editor. Steps 1–2 are diagnosis
(safe, read-only). Step 5 briefly takes the dashboard offline — do it outside
working hours.

---

## Why this keeps happening

Every upload re-aggregated the client's **entire history** to produce numbers
for **one week of one store**. That cost grows forever; the timeouts don't.
Migrations 0060 → 0102 → 0103 → 0104 → 0105 each made that same unbounded work
cheaper without changing its shape, so the failure kept coming back on a
slightly later date.

On top of that, uploads were **append-only with no dedup** — every retry
appended a complete duplicate copy of that week. Given how many uploads
failed-then-were-retried during this saga, that inflated both the table size
and the KPI numbers themselves.

**0107** makes per-upload work proportional to the slice being uploaded
(constant, ~milliseconds, forever). **0106** removes the duplicates already
accumulated. The steps below apply both and reclaim the disk space.

---

## 1. Diagnose — how bad is it?

```sql
select
  relname                                                  as table,
  pg_size_pretty(pg_total_relation_size(relid))            as total_size,
  n_live_tup                                               as live_rows,
  n_dead_tup                                               as dead_rows,
  round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) as pct_dead,
  last_autovacuum
from pg_stat_user_tables
where relname in ('sales_rows','ad_groups','dashboard_rollup','ads_rollup',
                  'dashboard_month_completeness','product_catalog','uploads')
order by pg_total_relation_size(relid) desc;
```

`pct_dead` above ~20% means real bloat. Note `total_size` for `sales_rows` —
compare it again after step 5.

## 2. Diagnose — how many duplicate uploads?

Run the two `PREVIEW` queries at the top of
`migrations/0106_dedupe_sales_rows.sql`. The first gives you
`rows_to_delete` vs `rows_total`. If `rows_to_delete` is a large fraction,
that is both your bloat and your inflated KPI numbers.

## 3. Apply the structural fix

Run `migrations/0107_slice_scoped_rollup_refresh.sql` in full. This adds the
slice-scoped refresh functions, the supporting indexes, and aggressive
autovacuum on the derived tables (which 0104/0105 turned into churn tables
without tuning them). Safe, non-destructive.

## 4. Remove the accumulated duplicates

In `migrations/0106_dedupe_sales_rows.sql`, uncomment the `APPLY` block and
run it. It keeps the newest upload per slice and deletes older copies, then
rebuilds every derived table once from the clean data.

> After this, dashboard numbers may **drop** — that is the double-counting
> being corrected, not data loss. Sanity-check a store/month you know the
> real figures for.

## 5. Reclaim the disk space

`VACUUM FULL` physically rewrites the table and returns space to disk. Plain
autovacuum only marks space reusable, so it can't shrink what's already
bloated.

**This takes an exclusive lock — the dashboard will be unavailable while it
runs (possibly several minutes on a large table). Run it off-hours.** Run each
as its own statement, not inside a migration or a transaction:

```sql
VACUUM (FULL, ANALYZE) sales_rows;
```
```sql
VACUUM (FULL, ANALYZE) ad_groups;
```
```sql
VACUUM (FULL, ANALYZE) dashboard_rollup;
```
```sql
VACUUM (FULL, ANALYZE) ads_rollup;
```

## 6. Verify

Re-run the step-1 query — sizes should be substantially smaller and
`dead_rows` near zero. Then upload a single file and confirm it finishes fast
with no `⚠` warning in the upload log.

---

## What changed in the app (already deployed)

- **Uploads are now idempotent.** Re-uploading a given
  (client, source, year, month, week, store) replaces that slice instead of
  appending a duplicate. Retries are now safe.
- **Refresh is slice-scoped.** `refresh_dashboard_rollup_slice()` /
  `refresh_ads_rollup_slice()` recompute only the uploaded slice.
  `refresh_product_catalog_for_upload()` touches only the products in the file.
- The full-rebuild functions still exist for manual use in the SQL editor:
  `select refresh_dashboard_rollup();` etc.

## If a timeout ever appears again

It should now be a genuine signal rather than growth catching up with you.
Check in this order:

1. Step-1 query — is a table bloated again? (If so, autovacuum isn't keeping
   up; investigate rather than raising a timeout.)
2. Is the failing call a *slice* refresh or a *full* refresh? A full rebuild
   in the logs means the slice key was missing and it fell back — check the
   upload form is sending Year/Month/Week/Store.
3. Only then consider the query plan. **Do not** simply raise a
   `statement_timeout` — that is what produced this five-migration cycle.
