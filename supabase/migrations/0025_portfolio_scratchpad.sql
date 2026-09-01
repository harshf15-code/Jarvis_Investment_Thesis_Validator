-- 0025_portfolio_scratchpad.sql
--
-- Part 2 of docs/prd-exit-ladder-and-scratchpad.md: the Portfolio Scratchpad --
-- a place to jot an idea, and Jarvis's on-demand read of what the whole book
-- says about the trader's own taste.
--
-- Two tables, because neither fits anything that already exists. `theses` with
-- `status = 'draft'` is the closest thing to a note, and it is a half-finished
-- formal thesis rather than a scratchpad -- the PRD decides explicitly against
-- reusing it, and rationalising the two is deferred until the overlap is
-- understood in practice rather than assumed.
--
-- `llm_usage.feature` is an enum, so a call the ledger cannot label is a call
-- it cannot record. Its own statement: Postgres will not let a new enum value
-- be USED in the transaction that adds it, and nothing below uses it.
alter type llm_feature add value if not exists 'portfolio_pattern_read';

-- The trader's own ideas, in their own words.
--
-- `ticker` is free text and deliberately NOT a foreign key to `stocks`. The
-- whole point of a scratchpad is that an idea can be written down before it
-- resolves to anything -- a symbol the app has never seen, a sector, a
-- half-remembered name. A constraint here would reject exactly the notes this
-- table exists to hold.
--
-- `archived_at` rather than a delete: a note is a record of what the trader was
-- thinking, and "I stopped believing this" is worth keeping.
create table scratchpad_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  body text not null,
  ticker text,
  archived_at timestamptz
);

-- The list query: this trader's notes, newest first.
create index idx_scratchpad_notes_user_created on scratchpad_notes (user_id, created_at desc);

alter table scratchpad_notes enable row level security;
create policy "scratchpad_notes_owner_all" on scratchpad_notes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Append-only, for the same reason `portfolio_council_reports` (0023) is.
--
-- A portfolio is not rewritten -- it changes -- and "what did Jarvis say my
-- pattern was in June, and what does it say now" is the question this feature
-- exists to make answerable. Replacing the row in place would destroy the only
-- record of how a trader's taste moved.
create table portfolio_pattern_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  -- The validated read: one document per run, read whole, re-validated on read
  -- so a row written by an older schema degrades to "read again" rather than
  -- crashing the page.
  document jsonb not null,
  -- What was actually reviewed. Without this an old read silently presents as
  -- current after the book has moved on -- and a claim about the pattern in
  -- holdings the trader no longer owns is worse than no claim at all.
  holdings_snapshot jsonb not null,
  raw_llm_response text
);

create index idx_portfolio_pattern_reads_user_created
  on portfolio_pattern_reads (user_id, created_at desc);

alter table portfolio_pattern_reads enable row level security;
create policy "portfolio_pattern_reads_owner_all" on portfolio_pattern_reads
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
