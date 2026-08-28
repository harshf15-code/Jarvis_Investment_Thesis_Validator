-- Candidate bake-off (Screen 1, Mode "thesis_only").
--
-- A macro thesis ("banks and NBFCs are at all-time-low NPAs") names no stock,
-- so before this table the flow dead-ended: Jarvis listed 2-3 tickers as bare
-- strings and the user had to re-run the whole thesis against one of them by
-- hand, losing the comparison. `thesis_candidates` persists the head-to-head —
-- every name Jarvis considered, the live market data it judged them on, and
-- its ranked verdict — so a macro thesis resolves to a concrete stock and the
-- downstream trade plan has a CMP to work from.

create type candidate_verdict as enum ('bet', 'watch', 'avoid');

create table thesis_candidates (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references theses(id) on delete cascade,
  -- Null when the ticker did not resolve on any exchange we try. The row is
  -- still kept: "Jarvis considered this and could not price it" is a real
  -- result the UI shows, not an error to swallow.
  stock_id uuid references stocks(id) on delete set null,
  ticker text not null,
  company_name text,
  yahoo_symbol text,
  exchange exchange_code,
  -- 1 = Jarvis's pick. Dense, contiguous, assigned by the analysis route.
  rank int not null,
  verdict candidate_verdict not null,
  score numeric(5,2),
  fit_rationale text,
  bull_case text,
  bear_case text,
  -- Snapshot at analysis time, NOT a live mirror: the whole point is to record
  -- what the model actually saw when it ranked these. Live prices are re-fetched
  -- for display via `stocks`/`/api/prices/refresh`.
  cmp numeric(14,4),
  fundamentals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (thesis_id, ticker)
);

create index thesis_candidates_thesis_id_rank_idx
  on thesis_candidates (thesis_id, rank);

-- The winner is whichever row the user promoted onto the thesis itself
-- (`theses.ticker`/`theses.stock_id`), so there is deliberately no `is_winner`
-- column here to drift out of sync with it.

-- Records why a macro thesis picked the name it did, so the Journal can show
-- "chose X over Y and Z" rather than just "X".
alter table theses
  add column selected_candidate_id uuid references thesis_candidates(id) on delete set null;

alter table thesis_candidates enable row level security;
-- Matches 0004: all access is through the service-role client behind the app's
-- own password gate; anon gets nothing.
