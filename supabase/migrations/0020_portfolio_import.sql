-- 0020_portfolio_import.sql
--
-- Lets a trader bring holdings they already own into Jarvis.
--
-- Why: `positions.thesis_id` and `positions.trade_plan_id` are both NOT NULL
-- and both produced by the thesis -> memorandum flow, so every position has to
-- be BORN here. A book that predates this app is structurally invisible to it:
-- the Cockpit cannot total it, `poll-prices` cannot watch it, and the Journal
-- has nothing to review. That is most traders on day one.
--
-- The fix is deliberately NOT a second, parallel "holdings" table. An import
-- creates ordinary rows in the existing theses -> trade_plans -> positions ->
-- entries chain, with a minimal synthetic thesis and an all-null trade plan.
-- Every screen, every metric and the alert poller then work on imported
-- holdings for free, with no changes at all. The only genuinely new tables are
-- the two with no existing analog: an import audit log and the portfolio-level
-- objective.
--
-- Both follow the 0013/0017 template exactly: `user_id` defaulting to
-- auth.uid(), an index on it, and a single owner_all policy.

create type thesis_source as enum ('jarvis', 'imported');

-- Provenance. A trader must be able to tell which positions have a real trade
-- plan behind them (entry, stop, targets) and which are just "I own this" --
-- rendering an all-null plan identically to an analysed one would be a lie of
-- omission. Later phases (the per-holding watch) also scope their work by this
-- column, which is why it is an enum and not a boolean.
alter table theses add column source thesis_source not null default 'jarvis';

-- Partial: the only query anyone ever writes against this column is "the
-- imported ones". Indexing the 'jarvis' majority would be dead weight.
create index idx_theses_source on theses (source) where source = 'imported';


-- portfolio_imports ---------------------------------------------------------
--
-- One row per CSV upload. Exists so a trader can answer "what did I import
-- last Tuesday, and did anything fail" months later, and so an unresolvable
-- row leaves a record of WHY it was skipped rather than vanishing.
create table portfolio_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  source_filename text not null,
  -- A batch prices against exactly one market. INFY quotes on the NSE and as a
  -- NYSE ADR at different numbers in different currencies, so probing every
  -- live exchange would silently price part of an Indian book in dollars.
  market market_code not null,
  -- A holdings export carries an average cost, not purchase dates. This is the
  -- single approximate date stamped on every entry in the batch.
  as_of_date date not null,
  total_rows int not null check (total_rows >= 0),
  imported_rows int not null default 0 check (imported_rows >= 0),
  skipped_rows int not null default 0 check (skipped_rows >= 0),
  -- Defaults to 'failed' ON PURPOSE. This row is written BEFORE the holdings
  -- and updated after they land, so a run that dies midway leaves an honest
  -- record instead of no record or a falsely successful one.
  status text not null default 'failed' check (status in ('completed', 'partial', 'failed')),
  -- [{ row: int, ticker: text, reason: text }] -- why each skipped row was skipped.
  errors jsonb not null default '[]'
);

create index idx_portfolio_imports_user_id on portfolio_imports (user_id);

alter table portfolio_imports enable row level security;

create policy "portfolio_imports_owner_all" on portfolio_imports
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- `on delete set null`, not cascade: deleting an audit record must never take
-- the trader's positions with it.
alter table theses add column import_batch_id uuid
  references portfolio_imports(id) on delete set null;

create index idx_theses_import_batch on theses (import_batch_id)
  where import_batch_id is not null;


-- portfolio_profiles --------------------------------------------------------
--
-- One row per user, and only if they chose to answer. What the trader is
-- trying to do with the book as a whole -- the thing an advisor asks before
-- looking at any single position. Nothing in this migration reads it; it is
-- collected here because the import flow is the one moment a trader is already
-- thinking about their portfolio as a portfolio, and asking later means never.
create table portfolio_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  objective text,
  updated_at timestamptz not null default now()
);

alter table portfolio_profiles enable row level security;

create policy "portfolio_profiles_owner_all" on portfolio_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
