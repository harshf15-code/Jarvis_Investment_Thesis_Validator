-- The Jarvis memorandum: one generated decision document per thesis.
--
-- Replaces the click-through wizard (thesis -> pick a candidate -> stress test
-- -> trade plan) with what the reference deliverable actually is: Jarvis runs
-- the whole comparison and hands back a finished memo — comparative grid, the
-- winner's thesis, four failure modes, a costed trade plan and exit discipline
-- — all at once. The user's only decision is whether to back the trade.
--
-- The body is stored as one jsonb document rather than ~40 columns because it
-- is produced and replaced atomically by a single model call, and is only ever
-- read whole. `lib/jarvis-memorandum.ts`'s zod schema is the contract; the
-- promoted scalar columns below exist only so other screens can filter without
-- parsing the document.

create table thesis_memorandums (
  id uuid primary key default gen_random_uuid(),
  -- One live memo per thesis. Re-running replaces it (see the route's upsert),
  -- so this is a plain unique FK rather than a versioned history table.
  thesis_id uuid not null unique references theses(id) on delete cascade,

  sector_theme text,
  memo_title text,
  data_source text,

  -- Promoted out of `document` for cheap lookups. `primary_candidate_id` is the
  -- name Jarvis picked; it is NOT the same as `theses.selected_candidate_id`,
  -- which records what the *user* chose to back.
  primary_candidate_id uuid references thesis_candidates(id) on delete set null,
  secondary_candidate_id uuid references thesis_candidates(id) on delete set null,
  conviction_score numeric(5,2),

  document jsonb not null,
  raw_llm_response text,
  created_at timestamptz not null default now()
);

create index thesis_memorandums_thesis_id_idx on thesis_memorandums (thesis_id);

alter table thesis_memorandums enable row level security;

-- Grid fields the comparative table shows that Yahoo does not supply.
-- `market_cap` and the 52-week range are strings/numerics mirrored out of
-- `fundamentals` so the grid renders without re-deriving them per paint.
alter table thesis_candidates
  add column tagline text,
  add column operational_share text,
  add column valuation_metric text,
  add column market_cap text,
  add column range_low numeric(14,4),
  add column range_high numeric(14,4);
