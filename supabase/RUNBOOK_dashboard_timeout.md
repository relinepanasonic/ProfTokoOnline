# Runbook — the 57014 dashboard timeout

## The actual cause (measured, not guessed)

Production diagnostics, 2026-07-30:

| table | size | live rows | dead rows | bloat |
|---|---|---|---|---|
| `sales_rows` | 203 MB | 129,017 | 0 | **0.0%** |
| `dashboard_rollup` | 46 MB | 87,901 | 0 | **0.0%** |
| duplicate rows | — | 104 of 129,017 | — | **0.08%** |

**There was never a bloat problem.** A clean 87k-row / 46 MB table cannot take
20 seconds on volume alone — that should be milliseconds.

The cause is **RLS helper functions evaluated once per row**:

```sql
create or replace function my_role() returns user_role
  language sql stable security definer as $$
  select role from profiles where id = auth.uid()
$$;
```

Called bare in a policy (`my_role() = 'superadmin'`), Postgres re-runs that
`profiles` lookup for **every candidate row** — ~87,901 times per dashboard
load, across several OR'd policies. That is the measured
**7.8 ms without RLS vs 12.1 s with RLS** (~1500x).

**Migration 0108** wraps every such call as `(select my_role())`, which
Postgres hoists into an InitPlan evaluated **once per query**. Policy logic,
access, and security posture are unchanged.

### Why it took so long to find

0060 → 0102 → 0103 → 0104 → 0105 → 0106 → 0107 all attacked **data volume**
(timeouts, scoping, dedup, vacuum). Volume was never the problem, so each fix
appeared to help briefly and then the symptom returned. 0097 *did* fix a
per-row RLS cost — but only the `store_links` subquery, and only in the
branch_manager policy. That is precisely why Owners got fast while Super Admin
kept failing: Super Admin reads through `rollup_admin_read`, which still had
bare `my_role()` calls.

---

## Apply

**1. Run `migrations/0108_rls_initplan_optimization.sql`.**
It rewrites the policies programmatically from `pg_policies` (reading each
policy's own expression and wrapping only the function calls), so no predicate
is retyped by hand. Idempotent — safe to run twice.

**2. Verify the rewrite landed.**
```sql
select tablename, policyname, qual
from pg_policies
where schemaname = 'public' and tablename = 'dashboard_rollup';
```
Every `qual` should now read `( SELECT my_role() ...)`, not a bare `my_role()`.

**3. Verify the speed.** Reload the Dashboard as Super Admin. Expect an
instant load. To measure directly:
```sql
explain (analyze, buffers) select dashboard_summary('<your-client-id>'::uuid);
```
The helper calls should appear **once** as an InitPlan near the top of the
plan, not inside a per-row `Filter`.

---

## Optional, unrelated to the timeout

These are real but minor — neither causes the 57014:

- **`ad_groups` is 8.6% dead** and was last autovacuumed 6 days ago.
  Migration 0107 already set aggressive autovacuum on it; it will self-correct.
  To reclaim now: `VACUUM (ANALYZE) ad_groups;` (plain `VACUUM`, **not** `FULL`
  — no exclusive lock, no downtime).
- **104 duplicate rows** from re-uploads (`migrations/0106_dedupe_sales_rows.sql`).
  0.08% of the table, so it will not change performance — but it *does* slightly
  double-count 4 store-weeks. Worth applying for correctness, not for speed.
- Migration **0107** (slice-scoped refresh + idempotent uploads) is still
  worthwhile on its own merits: it keeps per-upload work constant as you grow,
  and stops retries from creating new duplicates. It just wasn't the fix for
  this symptom.

---

## If a timeout appears again

1. **Check RLS first.** Run the step-2 query above. If any policy shows a bare
   `my_role()` / `my_client_id()` / `auth.uid()`, a later migration regressed it
   — re-run 0108. (This is exactly how 0097 wiped 0060's `statement_timeout`:
   `CREATE OR REPLACE` silently drops what it doesn't restate.)
2. **Then check the plan** with `explain (analyze, buffers)`.
3. **Only then** consider data volume — and check `pg_stat_user_tables` for
   actual dead rows before assuming bloat.
4. **Never just raise `statement_timeout`.** That response produced this
   seven-migration cycle.
