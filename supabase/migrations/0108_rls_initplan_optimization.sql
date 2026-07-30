-- =====================================================================
-- 0108: THE root cause of the entire 57014 saga — RLS helper functions
-- evaluated once PER ROW instead of once per query.
--
-- ── THE EVIDENCE ─────────────────────────────────────────────────────
-- Production diagnostics (2026-07-30), taken to test the bloat theory:
--     sales_rows        203 MB   129,017 live   0 dead   0.0% bloat
--     dashboard_rollup   46 MB    87,901 live   0 dead   0.0% bloat
--     duplicate rows: 104 out of 129,017  (0.08%)
-- There is NO bloat and NO meaningful duplication. A clean 87k-row /
-- 46 MB table timing out at 20s is impossible on data volume alone — it
-- should return in milliseconds. Every previous migration in this chain
-- (0060, 0102, 0103, 0104, 0105, 0106, 0107) attacked data volume, which
-- was never the problem. This one attacks the real cause.
--
-- The earlier measurement was the tell all along:
--     without RLS:  7.8 ms
--     with RLS:     12.1 s        (~1500x)
-- That ratio is the signature of a per-row function call, not of scanning
-- or bloat.
--
-- ── WHY ──────────────────────────────────────────────────────────────
-- my_role(), my_client_id(), my_scope_owner(), my_scope_store() each run
--     select <col> from profiles where id = auth.uid()
-- (0001_init.sql / 0020). They are declared STABLE, but a BARE call in an
-- RLS USING clause is treated as part of the per-row filter, so Postgres
-- re-executes it for EVERY candidate row. Reading dashboard_rollup means
-- ~87,901 executions of that profiles lookup, times several OR'd
-- permissive policies. That is the 12 seconds.
--
-- 0097 fixed a DIFFERENT per-row cost (the store_links IN (...) subquery)
-- and only in the branch_manager policy. The bare helper calls survived in
-- every policy — including rollup_admin_read, the one Super Admin reads
-- through. That is exactly why Owners got fast and Super Admin did not.
--
-- ── THE FIX ──────────────────────────────────────────────────────────
-- Wrap each call in a scalar subquery: my_role() -> (select my_role()).
-- Postgres then hoists it into an InitPlan, evaluating it ONCE per query
-- and reusing the constant for every row. This is the documented Supabase
-- RLS performance pattern. No policy LOGIC changes — same predicates,
-- same access, same security posture.
--
-- Rather than retyping ~40 policies by hand (and risking a typo that
-- silently widens or breaks access), this rewrites them programmatically
-- from pg_policies: it reads each existing policy's own expression, wraps
-- only the function calls inside it, and recreates it verbatim otherwise.
-- The transformation is idempotent — re-running normalizes already-wrapped
-- calls before wrapping, so it can be applied twice safely.
-- =====================================================================

-- ── 1. Expression rewriter ───────────────────────────────────────────
create or replace function _rls_optimize_expr(expr text) returns text
language plpgsql immutable as $$
declare
  fns  text[] := array['my_role','my_client_id','my_scope_owner','my_scope_store','my_scope_city'];
  f    text;
  outx text := expr;
begin
  if outx is null then return null; end if;

  -- Normalize any already-wrapped call back to the bare form first, so
  -- running this migration twice can't produce nested subqueries.
  -- pg_get_expr renders a scalar subquery as "( SELECT fn() AS fn)".
  foreach f in array fns loop
    outx := regexp_replace(outx,
      '\(\s*SELECT\s+' || f || '\(\)\s+AS\s+' || f || '\s*\)', f || '()', 'gi');
  end loop;
  outx := regexp_replace(outx,
    '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', 'auth.uid()', 'gi');

  -- Wrap: bare call -> InitPlan subquery.
  foreach f in array fns loop
    outx := regexp_replace(outx, '\m' || f || '\(\)', '(select ' || f || '())', 'g');
  end loop;
  outx := regexp_replace(outx, '\mauth\.uid\(\)', '(select auth.uid())', 'g');

  return outx;
end $$;

-- ── 2. Rewrite every policy on the hot tables ────────────────────────
-- Scoped to the tables the dashboards actually scan at volume. Small
-- lookup tables (profiles, clients, store_links) are left alone: the
-- per-row cost there is negligible and every touch is a security risk
-- worth avoiding.
do $$
declare
  r        record;
  v_using  text;
  v_check  text;
  v_roles  text;
  v_cmd    text;
  ddl      text;
  n        int := 0;
begin
  for r in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'dashboard_rollup', 'ads_rollup', 'dashboard_month_completeness',
        'sales_rows', 'ad_groups', 'product_catalog',
        'finance_rows', 'order_rows', 'uploads'
      )
      -- only policies that actually reference a helper (skip the rest)
      and (coalesce(qual, '') || coalesce(with_check, '')) ~
          '(my_role|my_client_id|my_scope_owner|my_scope_store|my_scope_city|auth\.uid)\('
  loop
    v_using := _rls_optimize_expr(r.qual);
    v_check := _rls_optimize_expr(r.with_check);
    v_roles := array_to_string(r.roles, ', ');
    v_cmd   := case r.cmd
                 when 'ALL'    then 'ALL'
                 when 'SELECT' then 'SELECT'
                 when 'INSERT' then 'INSERT'
                 when 'UPDATE' then 'UPDATE'
                 when 'DELETE' then 'DELETE'
               end;

    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);

    ddl := format('create policy %I on %I.%I as %s for %s to %s',
                  r.policyname, r.schemaname, r.tablename,
                  case when r.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
                  v_cmd, v_roles);

    -- INSERT policies carry only WITH CHECK; everything else may carry USING.
    if v_cmd <> 'INSERT' and v_using is not null then
      ddl := ddl || format(' using (%s)', v_using);
    end if;
    if v_check is not null then
      ddl := ddl || format(' with check (%s)', v_check);
    end if;

    execute ddl;
    n := n + 1;
  end loop;

  raise notice 'RLS InitPlan optimization applied to % policies', n;
end $$;

drop function if exists _rls_optimize_expr(text);

analyze dashboard_rollup;
analyze ads_rollup;
analyze sales_rows;
analyze ad_groups;

notify pgrst, 'reload config';

-- ── 3. VERIFY (run separately, as the authenticated role) ────────────
-- Confirm the rewrite landed — every policy below should now show
-- "( SELECT my_role() ...)" rather than a bare "my_role()":
--
--   select tablename, policyname, qual
--   from pg_policies
--   where schemaname = 'public' and tablename = 'dashboard_rollup';
--
-- Then time the real query. It should drop from ~12s to double-digit ms:
--
--   explain (analyze, buffers)
--   select dashboard_summary('<your-client-id>'::uuid);
--
-- In the plan, the helper calls should now appear ONCE as an InitPlan
-- near the top, not inside the per-row Filter.
