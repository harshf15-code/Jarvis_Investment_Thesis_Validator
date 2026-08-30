-- 0019_llm_spend_fixes.sql
--
-- Two corrections to 0018, both found in review of that migration.

-- 1. The spend windows were only accidentally UTC ---------------------------
--
-- `date_trunc('day', now() at time zone 'utc')` returns `timestamp WITHOUT time
-- zone`. Comparing it against `llm_usage.created_at` (which is `timestamptz`)
-- makes Postgres interpret the bound in the SESSION's TimeZone, not in UTC.
--
-- Measured against this database:
--
--   session TZ         boundary actually used
--   UTC                2026-08-30T00:00:00Z   <- correct, by luck
--   Asia/Kolkata       2026-08-29T18:30:00Z   <- 5.5h early
--   America/New_York   2026-08-30T04:00:00Z   <- 4h late
--
-- Supabase's default session TimeZone is UTC, so 0018 behaves correctly today.
-- But it would silently start counting a different day if that ever changed --
-- and a spend window that quietly moves is exactly the kind of bug nobody
-- notices until the bill does not match the ledger. Casting the bound back with
-- `at time zone 'utc'` makes it a real timestamptz and the window independent of
-- the session.
create or replace function public.llm_budget_status()
returns table (
  daily_spent numeric,
  monthly_spent numeric,
  daily_limit numeric,
  monthly_limit numeric,
  has_override boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  bounds as (
    select
      (date_trunc('day', (now() at time zone 'utc')) at time zone 'utc') as day_start,
      (date_trunc('month', (now() at time zone 'utc')) at time zone 'utc') as month_start
  ),
  spend as (
    select
      coalesce(sum(u.cost_usd) filter (where u.created_at >= bounds.day_start), 0) as d,
      coalesce(sum(u.cost_usd), 0) as m
      from llm_usage u, me, bounds
     where u.user_id = me.uid
       and u.created_at >= bounds.month_start
  ),
  lim as (
    select b.daily_usd, b.monthly_usd from llm_budgets b, me where b.user_id = me.uid
  )
  select
    spend.d,
    spend.m,
    (select daily_usd from lim),
    (select monthly_usd from lim),
    exists (select 1 from lim)
    from spend;
$$;

revoke all on function public.llm_budget_status() from public;
grant execute on function public.llm_budget_status() to authenticated;


-- 2. The per-feature breakdown was silently truncated ------------------------
--
-- The Settings panel built its breakdown by selecting every `llm_usage` row for
-- the month and grouping them in TypeScript. PostgREST caps a response at 1000
-- rows by default, so an account past 1000 calls in a month -- reachable
-- precisely for the uncapped owner account this feature exists to support --
-- would silently see understated totals, and the Council's cost estimate would
-- be computed from a truncated sample.
--
-- Aggregating in SQL removes the ceiling and moves far less data.
create or replace function public.llm_usage_by_feature()
returns table (feature llm_feature, cost_usd numeric, calls bigint, estimated_calls bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.feature,
    coalesce(sum(u.cost_usd), 0),
    count(*),
    count(*) filter (where u.cost_source = 'estimated' and u.ok)
    from llm_usage u
   where u.user_id = auth.uid()
     and u.created_at >= (date_trunc('month', (now() at time zone 'utc')) at time zone 'utc')
   group by u.feature
   order by 2 desc;
$$;

revoke all on function public.llm_usage_by_feature() from public;
grant execute on function public.llm_usage_by_feature() to authenticated;
