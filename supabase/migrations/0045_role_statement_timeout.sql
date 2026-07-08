-- =====================================================================
-- 0045: Re-apply role-level statement_timeout.
--
-- dashboard_summary() is timing out with 57014 on this project. Migration
-- 0029 fixed this exact error before with a role-level timeout bump (the
-- only lever that actually works for PostgREST RPC calls -- see the
-- comment in 0029 for why function-level SET does nothing). That fix
-- appears to have never landed on this database, so reapplying it here.
-- =====================================================================

alter role authenticated set statement_timeout = '20s';
alter role anon          set statement_timeout = '20s';
alter role service_role  set statement_timeout = '20s';

notify pgrst, 'reload config';
