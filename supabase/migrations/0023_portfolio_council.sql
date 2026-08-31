-- 0023_portfolio_council.sql
--
-- Phase 3 of docs/prd-portfolio-import.md: the Investment Council consulted on
-- the whole book rather than one thesis at a time.
--
-- Reuses the SAME `council_members` roster as the thesis-level Council (0017).
-- There is no second roster to manage and no second set of personas to keep in
-- sync -- a trader who has tuned three philosophies has tuned them for both
-- surfaces.

-- Two features, because the ledger must be able to tell the panel apart from
-- the synthesis, exactly as it does for the thesis Council. Their own
-- statements: Postgres will not let a new enum value be used in the
-- transaction that adds it, and nothing below uses them.
alter type llm_feature add value if not exists 'portfolio_council_opinion';
alter type llm_feature add value if not exists 'portfolio_council_synthesis';

-- Append-only, and DELIBERATELY WITHOUT the `unique (thesis_id, market)` that
-- makes `thesis_council_reports` a replace-in-place upsert.
--
-- That constraint is right there and wrong here. A memorandum is rewritten on
-- every re-run, so an old council report on a superseded memo is stale by
-- definition. A portfolio is not rewritten -- it changes -- and "what did the
-- Council say about this book last quarter, and what does it say now" is the
-- question this feature exists to make answerable.
create table portfolio_council_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  -- The validated report: one document per run, read whole, re-validated on
  -- read so a row written by an older schema degrades to "re-run this".
  document jsonb not null,
  -- What was actually reviewed, and at what prices. Without this a report
  -- silently reads as current after the book has moved on -- and a Council
  -- verdict about holdings you no longer own is worse than no verdict.
  holdings_snapshot jsonb not null,
  raw_llm_response text
);

create index idx_portfolio_council_reports_user_created
  on portfolio_council_reports (user_id, created_at desc);

alter table portfolio_council_reports enable row level security;
create policy "portfolio_council_reports_owner_all" on portfolio_council_reports
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
