-- 0013_user_accounts.sql
--
-- Turns the single shared-password app into a real multi-user one, backed by
-- Supabase Auth. Until now every table had RLS enabled with ZERO policies
-- (see 0004) -- a deny-all posture that worked only because every query ran
-- through the service-role key, which bypasses RLS. That is exactly the wrong
-- shape once there is more than one account: isolation would depend on every
-- one of ~60 query sites remembering to filter, and a single omission would
-- silently show one user another's book.
--
-- So isolation moves into the database. Two pieces do all the work:
--
--   1. `default auth.uid()` on user_id  -> INSERTs need not mention the owner.
--   2. a `user_id = auth.uid()` policy  -> SELECTs need not filter by it.
--
-- Application code therefore keeps its existing queries verbatim and only
-- swaps which client it builds (service-role -> request-scoped anon client).
--
-- `stocks` is deliberately NOT per-user; see the bottom of this file.

-- theses
alter table theses
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_theses_user_id on theses (user_id);

create policy "theses_owner_all" on theses
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- trade_plans
alter table trade_plans
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_trade_plans_user_id on trade_plans (user_id);

create policy "trade_plans_owner_all" on trade_plans
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- positions
alter table positions
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_positions_user_id on positions (user_id);

create policy "positions_owner_all" on positions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- entries
alter table entries
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_entries_user_id on entries (user_id);

create policy "entries_owner_all" on entries
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- exits
alter table exits
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_exits_user_id on exits (user_id);

create policy "exits_owner_all" on exits
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- jarvis_recommendations
alter table jarvis_recommendations
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_jarvis_recommendations_user_id on jarvis_recommendations (user_id);

create policy "jarvis_recommendations_owner_all" on jarvis_recommendations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- trade_journal_entries
alter table trade_journal_entries
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_trade_journal_entries_user_id on trade_journal_entries (user_id);

create policy "trade_journal_entries_owner_all" on trade_journal_entries
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- position_alerts
alter table position_alerts
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_position_alerts_user_id on position_alerts (user_id);

create policy "position_alerts_owner_all" on position_alerts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- intelligence_signals
alter table intelligence_signals
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_intelligence_signals_user_id on intelligence_signals (user_id);

create policy "intelligence_signals_owner_all" on intelligence_signals
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- opportunities
alter table opportunities
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_opportunities_user_id on opportunities (user_id);

create policy "opportunities_owner_all" on opportunities
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- thesis_candidates
alter table thesis_candidates
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_thesis_candidates_user_id on thesis_candidates (user_id);

create policy "thesis_candidates_owner_all" on thesis_candidates
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- thesis_memorandums
alter table thesis_memorandums
  add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Indexed because it is the sole predicate of the policy below, and RLS turns
-- that predicate into a WHERE clause on every single read of this table.
create index idx_thesis_memorandums_user_id on thesis_memorandums (user_id);

create policy "thesis_memorandums_owner_all" on thesis_memorandums
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- `stocks` stays global -----------------------------------------------------
--
-- It is a shared ticker/price cache: `ticker`, `yahoo_symbol`, `last_price`.
-- Nothing in it is personal, it carries `unique (yahoo_symbol)` (so it cannot
-- be partitioned per user without a compound key), and the `poll-prices` Edge
-- Function writes it on a schedule for everyone. Two users watching
-- RELIANCE.NS should share one row and one price poll, not two.
--
-- It still needs a policy, because RLS is on and a policy-less table is
-- unreadable by `authenticated`. Permissive on purpose.
create policy "stocks_shared_market_data" on stocks
  for all to authenticated
  using (true)
  with check (true);


-- Claiming the rows that predate accounts -----------------------------------
--
-- The new columns are nullable because there is no user to point them at yet:
-- this migration necessarily runs before anyone has signed up. A NULL user_id
-- fails `= auth.uid()` for every caller, so those rows are invisible to
-- everyone rather than visible to anyone -- the gap fails closed.
--
-- The first account created inherits them. `security definer` is required:
-- the trigger runs as the signing-up user, who by definition cannot yet see
-- the orphan rows it needs to update.
create or replace function public.claim_orphan_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Strictly the first account. A later signup must never sweep up rows.
  if (select count(*) from auth.users) <> 1 then
    return new;
  end if;

  update theses set user_id = new.id where user_id is null;
  update trade_plans set user_id = new.id where user_id is null;
  update positions set user_id = new.id where user_id is null;
  update entries set user_id = new.id where user_id is null;
  update exits set user_id = new.id where user_id is null;
  update jarvis_recommendations set user_id = new.id where user_id is null;
  update trade_journal_entries set user_id = new.id where user_id is null;
  update position_alerts set user_id = new.id where user_id is null;
  update intelligence_signals set user_id = new.id where user_id is null;
  update opportunities set user_id = new.id where user_id is null;
  update thesis_candidates set user_id = new.id where user_id is null;
  update thesis_memorandums set user_id = new.id where user_id is null;

  return new;
end;
$$;

create trigger claim_orphans_on_first_signup
  after insert on auth.users
  for each row execute function public.claim_orphan_rows();
