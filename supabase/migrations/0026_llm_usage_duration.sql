-- 0026_llm_usage_duration.sql
--
-- How long each model call took.
--
-- Why: the app has never measured this. `meteredGenerateText` has computed a
-- `startedAt` since 0018, but only to claim a late-reported cost on the error
-- path -- the elapsed time was thrown away. So `llm_usage` can answer "what did
-- this cost" and cannot answer "how long does this normally take", which turns
-- out to be the more operational of the two questions:
--
--   * `POST /api/theses` timed out at 60s in production on 2026-09-01 (#11).
--     Whether 60 was a sane ceiling was unanswerable from data; the fix had to
--     argue from the shape of the route instead.
--   * #12's progress stepper deliberately shows no estimate and no percentage,
--     because inventing one is worse than omitting it. A p50 per feature is the
--     only honest way to ever say "usually about 40 seconds", and it needs
--     history before it means anything. This column is that history starting.
--
-- NULLABLE, not `default 0`. Every row written before this migration has no
-- duration, and zero is a claim -- it would drag any average it appeared in
-- toward a number no call ever took. NULL says "not measured", which is the
-- truth, and `percentile_cont` skips it for free. Same reasoning as
-- `generation_id`, which is null for a call that threw before it got one.
--
-- No index. The read this anticipates is a percentile per feature over a recent
-- window, which `idx_llm_usage_user_created` already narrows; adding a second
-- index for a query nothing runs yet would be speculation.
alter table llm_usage
  add column duration_ms int check (duration_ms is null or duration_ms >= 0);

comment on column llm_usage.duration_ms is
  'Wall-clock milliseconds for the model call, measured around generateText. '
  'NULL for rows written before 0026, and for any call whose duration was not '
  'measured -- never 0, which would be a claim rather than an absence.';
