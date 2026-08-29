-- 0015_finish_user_accounts.sql
--
-- The two things 0013 deliberately deferred until the first account existed.
-- Safe to run now: the first sign-up has happened and the backfill claimed
-- every pre-existing row (verified: 0 rows with a null user_id across all 12
-- tables before this migration).


-- 1. Retire the single-use claim trigger -------------------------------------
--
-- It existed to hand rows created before accounts existed to the first account
-- created. That has happened, so from here it can only be a liability: it runs
-- on every insert into `auth.users` forever, and its whole body is dead code
-- once a second account exists.
drop trigger if exists claim_orphans_on_first_signup on auth.users;
drop function if exists public.claim_orphan_rows();


-- 2. user_id becomes NOT NULL ------------------------------------------------
--
-- 0013 had to leave these nullable because there was no user to point them at
-- yet. Nullable was never the intent: a row with a null owner satisfies no RLS
-- policy, so it is invisible to every caller including whoever created it —
-- data that exists but can never be read again.
--
-- With the column NOT NULL, that state is unrepresentable. A writer with no
-- session now fails loudly on the insert (the `default auth.uid()` resolves to
-- null and Postgres rejects it) instead of quietly producing an orphan. That
-- is exactly what should happen to, say, an Edge Function that forgets to pass
-- an owner.

alter table theses alter column user_id set not null;
alter table trade_plans alter column user_id set not null;
alter table positions alter column user_id set not null;
alter table entries alter column user_id set not null;
alter table exits alter column user_id set not null;
alter table jarvis_recommendations alter column user_id set not null;
alter table trade_journal_entries alter column user_id set not null;
alter table position_alerts alter column user_id set not null;
alter table intelligence_signals alter column user_id set not null;
alter table opportunities alter column user_id set not null;
alter table thesis_candidates alter column user_id set not null;
alter table thesis_memorandums alter column user_id set not null;
