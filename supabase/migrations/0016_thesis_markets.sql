-- 0016_thesis_markets.sql
--
-- Makes the market an explicit input to a thesis, and lets one thesis carry
-- one memorandum PER MARKET instead of exactly one overall.
--
-- Why: a robotics thesis run before this migration produced a memorandum
-- concluding ZBRA -- a name the trader never mentioned. Two faults combined,
-- and this migration addresses the half that is schema:
--
--   1. The shortlist had no notion of a universe, so it named Tokyo-listed
--      companies (FANUC, Nidec) that `resolveCandidate` can only ever fail to
--      price -- they were then dropped from contention, leaving whichever
--      names happened to be US-listed to win by default.
--   2. There was nowhere to record which market a candidate or memo belonged
--      to, so "run this thesis against India AND the US" was unrepresentable.
--
-- `market_code` is deliberately NOT `exchange_code`. A market is what the
-- trader picks (India); an exchange is where a listing lives (NSE, BSE). India
-- is one market across two exchanges, so the two concepts cannot share a type.
--
-- CN/EU/EM exist in the enum but are not selectable in the app (see
-- lib/markets.ts). Pricing them needs a currency column on `stocks` and
-- FX-aware trade-plan geometry; until that exists, a half-priced report is
-- worse than none.

create type market_code as enum ('US', 'IN', 'CN', 'EU', 'EM');

-- Which markets the trader chose for this thesis. Defaults to US so existing
-- rows stay valid; new rows always pass an explicit array.
alter table theses
  add column markets market_code[] not null default '{US}';

alter table thesis_memorandums add column market market_code;
alter table thesis_candidates  add column market market_code;

-- Backfill from the exchange we already resolved. Candidates that never
-- priced (exchange is null -- exactly the FANUC/Nidec case) fall back to their
-- thesis's first chosen market rather than guessing a listing that was never
-- established.
update thesis_candidates
   set market = case when exchange = 'US' then 'US'::market_code
                     when exchange in ('NSE', 'BSE') then 'IN'::market_code
                     else null end
 where market is null;

update thesis_candidates c
   set market = coalesce(t.markets[1], 'US'::market_code)
  from theses t
 where c.thesis_id = t.id
   and c.market is null;

-- A memo belongs to the market most of its priced candidates came from.
update thesis_memorandums m
   set market = coalesce(
         (select c.market
            from thesis_candidates c
           where c.thesis_id = m.thesis_id and c.market is not null
           group by c.market
           order by count(*) desc
           limit 1),
         'US'::market_code)
 where m.market is null;

alter table thesis_memorandums alter column market set not null;
alter table thesis_candidates  alter column market set not null;

-- The `default '{US}'` above kept existing rows valid, but it is wrong for a
-- thesis whose candidates are all NSE-listed. Correct each existing thesis to
-- the markets its own candidates actually came from.
update theses t
   set markets = sub.markets
  from (select thesis_id, array_agg(distinct market) as markets
          from thesis_candidates group by thesis_id) sub
 where t.id = sub.thesis_id;

-- One report per market, not per thesis. Both of these previously encoded the
-- one-memo-per-thesis assumption, and a second market's run would have
-- collided with (candidates) or been rejected by (memos) the first's rows.
alter table thesis_memorandums
  drop constraint thesis_memorandums_thesis_id_key,
  add  constraint thesis_memorandums_thesis_market_key unique (thesis_id, market);

alter table thesis_candidates
  drop constraint thesis_candidates_thesis_id_ticker_key,
  add  constraint thesis_candidates_thesis_market_ticker_key unique (thesis_id, market, ticker);

-- Every read of either table is now scoped by (thesis_id, market).
create index idx_thesis_candidates_thesis_market on thesis_candidates (thesis_id, market);
create index idx_thesis_memorandums_thesis_market on thesis_memorandums (thesis_id, market);
