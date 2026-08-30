-- 0018_llm_spend.sql
--
-- Per-user LLM spend accounting and limits.
--
-- Why: `OPENROUTER_API_KEY` is one key in one env var, sign-up is open to
-- anyone who finds the URL, and until this migration nothing counted or capped
-- what an account spent. The Investment Council (0017) raised the worst case
-- from 2 model calls per action to 8. A stranger could sign up, run theses in a
-- loop, and the owner would learn about it from the bill.
--
-- Two tables: an append-only ledger of what was spent, and a sparse table of
-- per-user overrides to the env defaults.

create type llm_feature as enum
  ('thesis', 'memorandum', 'council_opinion', 'council_synthesis', 'journal');


-- llm_usage -----------------------------------------------------------------
--
-- One row per model call. Denominated in MONEY, not tokens: token prices change
-- and differ per model, so a token count is not a bill. OpenRouter reports the
-- actual charge on every response and that is what is recorded here; a token
-- estimate is the fallback, and it says so.
create table llm_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  feature llm_feature not null,
  model text not null,
  -- OpenRouter's generation id. Unique, so a retried write cannot double-count
  -- one call. Nullable because a call that threw never got one, and Postgres
  -- allows many NULLs under a unique constraint.
  generation_id text unique,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  -- 6 decimal places: a single cheap call can cost fractions of a cent, and
  -- rounding those to zero would make a loop of them free.
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  cost_source text not null default 'reported'
    check (cost_source in ('reported', 'estimated')),
  thesis_id uuid references theses(id) on delete set null,
  -- False when the call threw. Recorded rather than skipped: a failed call can
  -- still be billed upstream, and an unrecorded call is worse than a recorded
  -- zero.
  ok boolean not null default true
);

-- The only read pattern is "this user's spend since <timestamp>".
create index idx_llm_usage_user_created on llm_usage (user_id, created_at desc);


-- llm_budgets ---------------------------------------------------------------
--
-- Sparse on purpose. NO ROW means "use the env defaults", so every account is
-- capped from the moment it exists without anything having to create a row for
-- it. A row exists only to override, and a NULL column means no limit for that
-- window -- which is how the owner's own account runs uncapped.
create table llm_budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_usd numeric(10, 2) check (daily_usd is null or daily_usd >= 0),
  monthly_usd numeric(10, 2) check (monthly_usd is null or monthly_usd >= 0),
  -- Why this account was given an exception. There is no admin UI; these rows
  -- are written by hand in SQL, so the reason has to live with the row.
  note text
);


-- RLS: SELECT ONLY. This is the whole design. --------------------------------
--
-- Every other table in this schema uses `owner_all`. These two must not.
--
-- A ledger the user can write is not a ledger: under `for all`, an account that
-- hit its cap could `delete from llm_usage` and carry on spending. The limit
-- would be enforced against a number its subject controls. Likewise an editable
-- `llm_budgets` would let a user simply raise their own ceiling.
--
-- So `authenticated` may read both and write neither, and every insert goes
-- through the service-role client -- the same split `stocks` has used since
-- 0014, for the same reason: the app shows you your spend, it does not let you
-- negotiate it.
alter table llm_usage enable row level security;
alter table llm_budgets enable row level security;

create policy "llm_usage_owner_read" on llm_usage
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "llm_budgets_owner_read" on llm_budgets
  for select to authenticated
  using ((select auth.uid()) = user_id);


-- llm_budget_status ---------------------------------------------------------
--
-- One round trip for the pre-flight check on every LLM route: this session's
-- spend in both windows, and its two limits.
--
-- Takes NO user parameter, deliberately. An earlier draft took `p_user uuid`,
-- which combined with `security definer` would have let any authenticated user
-- read any other account's spend by passing their id. The session's own
-- identity is the only answer this function will give.
--
-- Windows are the UTC day and calendar month, matching OpenRouter's own
-- midnight-UTC reset so the two can never disagree about which day a call fell
-- in.
--
-- It does NOT return a verdict. Whether the spend is allowed depends on the env
-- defaults when no `llm_budgets` row exists, and the database does not know
-- those. NULL limits here mean "the caller applies its defaults", not
-- "unlimited" -- the distinction is `has_override`.
--
-- Failed calls (`ok = false`) still count toward spend. They can be billed
-- upstream, and excluding them would make a loop of failing requests free.
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
  spend as (
    select
      coalesce(sum(cost_usd) filter (
        where created_at >= date_trunc('day', now() at time zone 'utc')), 0) as d,
      coalesce(sum(cost_usd), 0) as m
      from llm_usage, me
     where user_id = me.uid
       -- Bounds the scan to the current month; the daily figure is a subset.
       and created_at >= date_trunc('month', now() at time zone 'utc')
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
