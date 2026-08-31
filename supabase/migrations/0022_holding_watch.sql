-- 0022_holding_watch.sql
--
-- Phase 2 of docs/prd-portfolio-import.md: an initial read on every imported
-- holding, and a recurring watch that flags an approaching or newly-passed
-- earnings date and a material shift in fundamentals.
--
-- The watch runs WEEKLY per holding. Earnings dates and fundamentals do not
-- move at `poll-prices` speed and each trigger costs a model call, so checking
-- daily would spend real money to re-read numbers that had not changed.
--
-- Three things this migration has to create, and one it has to fix.

-- 1. A feature the spend ledger can name -------------------------------------
--
-- `llm_usage.feature` is an enum, so a call the ledger cannot label is a call
-- it cannot record. Added as its own statement: Postgres will not let a new
-- enum value be USED in the transaction that adds it, and nothing here uses it.
alter type llm_feature add value if not exists 'holding_review';


-- 2. The reviews themselves ---------------------------------------------------

create type holding_review_trigger as enum
  ('manual', 'earnings_calendar', 'fundamentals_delta', 'scheduled');

-- Append-only. A trader must be able to read what Jarvis thought about this
-- holding three months ago and compare it to now -- replacing in place would
-- destroy exactly the history that makes a recurring watch worth having.
create table holding_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  thesis_id uuid not null references theses(id) on delete cascade,
  position_id uuid not null references positions(id) on delete cascade,
  trigger holding_review_trigger not null,
  -- One validated blob, same discipline as `thesis_memorandums.document`:
  -- produced whole by a single model call, read whole, re-validated on read so
  -- a row written by an older schema degrades to "re-run this" rather than
  -- crashing the page.
  document jsonb not null,
  raw_llm_response text
);

create index idx_holding_reviews_user_id on holding_reviews (user_id);
-- The position page's query: this holding's reviews, newest first.
create index idx_holding_reviews_position on holding_reviews (position_id, created_at desc);

alter table holding_reviews enable row level security;
create policy "holding_reviews_owner_all" on holding_reviews
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


-- 3. Somewhere to diff against ------------------------------------------------
--
-- Nothing in this schema stores a fundamentals time series. The v1
-- `fundamentals` table was dropped in 0006, and `thesis_candidates.fundamentals`
-- is a point-in-time record of what the model saw when it ranked candidates --
-- keyed by (thesis_id, ticker), never refreshed. So "has P/E moved 15% since
-- the last check" is not answerable from anything that exists today.
--
-- One row per watched position, UPDATED IN PLACE rather than appended: the
-- question is always "since the last check", never "what did this look like in
-- June", and an append-only snapshot table would grow a row per holding per
-- week to answer a question nobody asks.
create table holding_watch_state (
  position_id uuid primary key references positions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  -- NULL means never reviewed. That is the queue: an import writes these rows
  -- with a null here, and the drain picks up nulls before anything else.
  last_checked_at timestamptz,
  fundamentals jsonb not null default '{}',
  -- The next earnings date Yahoo knew about at the last check, and the one we
  -- have already told the trader has passed. Two columns, because "an earnings
  -- date is approaching" and "an earnings date has been and gone" are
  -- different triggers that must each fire exactly once.
  next_earnings_date date,
  last_earnings_seen date
);

create index idx_holding_watch_state_user_id on holding_watch_state (user_id);
-- The drain's query: oldest unchecked first, nulls before anything.
create index idx_holding_watch_state_due on holding_watch_state (last_checked_at nulls first);

alter table holding_watch_state enable row level security;
create policy "holding_watch_state_owner_all" on holding_watch_state
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


-- 4. The digest can see a Feed item -------------------------------------------
--
-- `daily-digest` already emails unsent `position_alerts` and marks them with
-- `emailed_at`. `intelligence_signals` -- the table `/feed` renders -- has no
-- such column, so a watch flag could reach the Feed but never the email. Same
-- column, same meaning, so the digest can do for signals exactly what it
-- already does for alerts.
alter table intelligence_signals add column emailed_at timestamptz;


-- 5. The budget check has to work without a session ---------------------------
--
-- `llm_budget_status()` reads `auth.uid()`. A scheduled job acts as no one, so
-- as written the weekly watch would spend model calls on every user's behalf
-- while passing NOBODY's cap -- the ledger would record the spend and the
-- limit would simply never apply to it.
--
-- Split into a function that takes the user explicitly and one that supplies
-- `auth.uid()` to it, so there is exactly ONE definition of the budget rule.
-- The parameterised one is service_role only: `authenticated` must never be
-- able to read another account's spend by passing their id.
create or replace function public.llm_budget_status_for(uid uuid)
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
  with bounds as (
    select
      (date_trunc('day', (now() at time zone 'utc')) at time zone 'utc') as day_start,
      (date_trunc('month', (now() at time zone 'utc')) at time zone 'utc') as month_start
  ),
  spend as (
    select
      coalesce(sum(u.cost_usd) filter (where u.created_at >= bounds.day_start), 0) as d,
      coalesce(sum(u.cost_usd), 0) as m
      from llm_usage u, bounds
     where u.user_id = uid
       and u.created_at >= bounds.month_start
  ),
  lim as (
    select b.daily_usd, b.monthly_usd from llm_budgets b where b.user_id = uid
  )
  select
    spend.d,
    spend.m,
    (select daily_usd from lim),
    (select monthly_usd from lim),
    exists (select 1 from lim)
    from spend;
$$;

revoke all on function public.llm_budget_status_for(uuid) from public;
grant execute on function public.llm_budget_status_for(uuid) to service_role;

-- Now a thin wrapper. Same signature, same grants, same behaviour for every
-- existing caller.
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
  select * from public.llm_budget_status_for(auth.uid());
$$;

revoke all on function public.llm_budget_status() from public;
grant execute on function public.llm_budget_status() to authenticated;
