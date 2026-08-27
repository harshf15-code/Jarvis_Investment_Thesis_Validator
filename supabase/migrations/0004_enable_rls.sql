-- 0004_enable_rls.sql
--
-- CRITICAL fix (final whole-branch review): `0001_init.sql` created every
-- table without ever enabling Row-Level Security. `lib/supabase/admin.ts`'s
-- own docblock (and the architecture plan) state the security model is
-- "RLS on every table is deny-all for `anon`" -- but RLS was never actually
-- turned on, so the publicly-distributable `NEXT_PUBLIC_SUPABASE_ANON_KEY`
-- would have unrestricted read/write access to all 7 tables via PostgREST.
--
-- This migration enables RLS on every table from `0001_init.sql` and adds
-- NO policies. With RLS enabled and zero policies defined, every role other
-- than the table owner / a role with `bypassrls` is denied all access by
-- default -- that absence-of-policies IS the deny-all-from-anon posture
-- described in the plan. No application code changes are needed: every
-- server-side read/write in this app goes through
-- `lib/supabase/admin.ts`'s `createAdminClient()`, which authenticates with
-- `SUPABASE_SERVICE_ROLE_KEY` -- the Supabase service-role key bypasses RLS
-- by design, so admin-client access is unaffected by this change.

alter table stocks enable row level security;
alter table holdings enable row level security;
alter table jarvis_analyses enable row level security;
alter table alert_criteria enable row level security;
alter table price_cache enable row level security;
alter table fundamentals enable row level security;
alter table alert_log enable row level security;
