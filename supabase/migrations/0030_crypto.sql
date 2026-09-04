-- Crypto holdings: asset class, the CoinGecko id, and the top-ten universe.
--
-- See docs/superpowers/specs/2026-09-04-crypto-holdings-design.md.
--
-- A coin becomes a `stocks` row like anything else, because `stocks` is what
-- the entire pricing, staleness and alerting pipeline reads. The one twist is
-- that `stocks` carries `last_price` AND `currency` ON THE ROW, so a single
-- shared 'bitcoin' row could hold exactly one price in one currency -- and an
-- INR book and a USD book that both hold BTC could not both be right.
--
-- So the grain is one row per (coin, currency), with a synthetic yahoo_symbol:
--
--   yahoo_symbol = 'coingecko:bitcoin:inr'   currency = 'INR'
--   yahoo_symbol = 'coingecko:bitcoin:usd'   currency = 'USD'
--
-- Those are genuinely two price series, not one price rendered twice.
--
-- WHY THIS FILE NEVER MENTIONS 'CRYPTO' AGAIN: `alter type ... add value`
-- cannot be USED in the transaction that adds it, and apply-migration.mjs wraps
-- each file in exactly one transaction. Adding the value is fine; a seed row or
-- a default referencing it is not. Anything that needs the value goes in 0031.

create type asset_class as enum ('equity', 'crypto');

alter table stocks add column asset_class asset_class not null default 'equity';
alter table stocks add column coingecko_id text;

-- On the PAIR, not on coingecko_id alone as the PRD has it. A single-column
-- index would forbid the (coin, currency) grain that is the whole design.
create unique index idx_stocks_coingecko_currency
  on stocks (coingecko_id, currency)
  where coingecko_id is not null;

alter type exchange_code add value 'CRYPTO';
alter type market_code   add value 'CRYPTO';

-- The universe governs what can be ADDED, never what can be held. A coin that
-- falls out of the top ten keeps its position, its history and its alerts; it
-- simply stops being offered for new holdings.
create table crypto_universe (
  coingecko_id    text primary key,
  symbol          text not null,
  name            text not null,
  market_cap_rank int not null,
  refreshed_at    timestamptz not null default now()
);

-- Shared reference data, exactly like `stocks` (0014): every signed-in trader
-- reads the same rows, and only the service-role client writes them.
alter table crypto_universe enable row level security;
create policy "crypto_universe_read" on crypto_universe
  for select to authenticated
  using (true);
