# Crypto holdings — design

Phase 3 of `docs/prd-multi-portfolio-crypto-and-naming.md`. Phases 1 and 2
(portfolios, named theses) shipped in PR #14 and their migrations — 0027 and
0028 — are applied to production.

Phase 4, the Council and pattern-read prompt work, is **not** in this spec. Its
own PRD says it is best done "when there is a real mixed, multi-book dataset to
evaluate the output against," and that dataset does not exist until this ships
and gets used for a few days. Writing those prompts now would mean tuning them
blind and tuning them again later.

## The problem

Every instrument in this app is an equity on an exchange, and that assumption is
load-bearing in more places than the PRD lists:

- `stocks.exchange` is `exchange_code`, which is `NSE | BSE | US`, `not null`.
- `stocks.yahoo_symbol` is `not null` and carries a unique index that the CSV
  import upserts against (`app/api/portfolio/imports/route.ts:204`).
- `resolveYahooSymbol` (`lib/market-data.ts:30-43`) has a `switch` with three
  arms and no default.
- `poll-prices` rejects any `market` that is not `NSE` or `US`
  (`supabase/functions/poll-prices/index.ts:258-269`), and gates on
  `isMarketOpen` before doing anything.
- `positions.thesis_id` and `positions.trade_plan_id` are both `not null`.

The last one is the one that shapes this design. There is **no path in the app
today that creates a holding from nothing.** `POST /api/positions` requires a
`thesis_id`, `trade_plan_id` and `stock_id` that already exist, and both of its
callers — `manual-execution-modal.tsx:60` and `back-trade-dialog.tsx:107` —
start from a trade plan Jarvis produced. The CSV import is the only thing that
mints those stubs, and it does so inline in its route handler.

A coin has no thesis, no trade plan, no exchange and no Yahoo symbol.

### The failure that exists today

`resolveYahooSymbol("BTC-USD", "US")` returns `BTC-USD` unchanged, Yahoo answers
with a real quote, and its `currency: "USD"` satisfies the import's currency
gate. So a coin can already be imported **right now**, and it persists as
`exchange: 'US'` — which then drives market-hours polling and the display
timezone. A bare `BTC` resolves to a US-listed Bitcoin trust: the wrong asset,
with no error. This is not a gap to fill so much as a wrong answer to stop
giving.

## Decisions taken

| | |
|---|---|
| Scope | Phase 3 only. Phase 4 after real data exists |
| Entry paths | CSV import **and** manual add |
| Coin currency | The portfolio's `base_currency` (0027 gave every book one) |
| Polling | A `poll-prices-crypto` cron: hourly, all seven days, `isMarketOpen` bypassed |
| `stocks` shape | One row per **(coin, currency)** — see below |

## Architecture

### One `stocks` row per (coin, currency)

`stocks` carries `last_price` *and* `currency` on the row. So a single shared
`bitcoin` row can hold exactly one price in one currency — and an INR book and a
USD book that both hold BTC cannot both be right. The row therefore keys on the
pair:

```
yahoo_symbol = 'coingecko:bitcoin:inr'   -- synthetic
coingecko_id = 'bitcoin'
asset_class  = 'crypto'
exchange     = 'CRYPTO'
currency     = 'INR'
last_price   = 7515223.00                -- priced in INR directly; no FX
```

Two books in different currencies get two rows, which is correct: those are
genuinely two price series, not one price rendered twice.

**The synthetic `yahoo_symbol` is a deliberate lie and must be commented as
one.** It buys the entire existing pipeline unchanged — the `onConflict:
"yahoo_symbol"` upsert, `last_price_at` staleness, the positions table's
`row.stock?.currency`, and every alert trigger. The alternative (nullable
`yahoo_symbol`, dedupe on `coingecko_id`) is more honest in one column and costs
a branch in roughly fifteen call sites, and it still needs a per-currency price
row, so it is this design with extra steps.

The format cannot collide with a real Yahoo symbol: those are uppercase and
contain no colons.

### Pricing lives in its own module

`lib/crypto-data.ts`, a sibling of `lib/market-data.ts` rather than a branch
inside it. The two share nothing but the `withRetry` backoff, which is lifted to
where both can use it. `resolveYahooSymbol` is never called for a coin.

- **Prices:** `/simple/price?ids=…&vs_currencies=…`. Batched, so it is **one
  call per distinct currency** and that call prices every coin held in it.
- **Universe:** `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10`.
- **Auth:** the `x-cg-demo-api-key` header against `api.coingecko.com`. A Pro
  key uses a different header *and* a different host and is not a drop-in swap.
  Verified working against the live API.

**Budget.** The Demo tier allows 100 calls/min and 10,000 credits/month. Hourly
polling is ~730 invocations/month at 1–2 calls each, plus ~4 universe refreshes:
roughly 730–1,460 calls, or 7–15% of the monthly allowance. Comfortable, with
room for the cadence to tighten later.

### `crypto_universe` — what can be added, not what can be held

A shared reference table like `stocks`: select-only for `authenticated`, written
by the service-role client, refreshed weekly. Market-cap rank does not churn.

It exists to resolve `BTC` → `bitcoin` deterministically, which is what stops
the "US-listed Bitcoin trust" failure above. **A holding whose coin drops out of
the top ten is never dropped from the book** — the universe governs what can be
*added*.

### `lib/portfolio/create-holding.ts`

The "create a holding from nothing" sequence — stock upsert, stub thesis
(`source: 'imported'`), stub trade plan, position, entry — is extracted from the
import route so both entry paths call one implementation.

This is a change to working code that is not strictly in scope, and it earns its
place: without it, manual add is a second copy of a five-insert sequence with a
rollback path, and the two copies drift the first time either is touched. The
import route keeps its batch bookkeeping, its duplicate detection and its error
rows; only the minting moves.

### Entry paths

**CSV import.** The wizard's market picker gains `CRYPTO` beside IN and US. In
that mode the ticker column resolves against `crypto_universe` instead of Yahoo,
and the currency comes from the book rather than from `MARKETS`.

`MARKETS.CRYPTO` needs a `MarketMeta`, and two of its fields do not really
apply. `exchanges: []` (a coin has none) and `currency`/`symbol`/`locale` are
the awkward pair: every other market has one fixed currency and crypto's
depends on the book. They are set to the USD/`$`/`en-US` triple as an inert
default and **must never be read for a crypto row** — the currency of record is
`stocks.currency`, which the positions table already prefers
(`row.stock?.currency ?? currencyForExchange(…)`). `MarketMeta` also gains a
flag excluding CRYPTO from the thesis market picker, since crypto is
holdings-only.

**Manual add.** A new `POST /api/holdings` taking
`{ portfolio_id, coingecko_id, quantity, price, date }`, calling
`create-holding`. Scoped like every other write: one book, named explicitly,
never `all`.

Neither path asks the trader for a currency. Both read the book's
`base_currency`.

### Polling and the weekend

A `poll-prices-crypto` cron entry: **hourly, all seven days.** `poll-prices`
accepts `market=CRYPTO`, and that branch **skips `isMarketOpen` entirely** rather
than consulting it — a coin has no session, so asking the question is itself the
bug.

The existing stop / target / time-exit trigger logic is untouched. It reads
`last_price` and does not care what wrote it.

This closes the PRD's Open Question 1 rather than shipping around it. The PRD's
own Part 2 proposed the opposite — crypto priced only when `poll-prices` is
already awake for NSE or US hours — and explicitly warned that the consequence
would be "a crypto stop or target that breaches over a weekend is not detected
until Monday." Polling hourly means it is detected. **This spec supersedes the
PRD on that point.**

The weekend assumption lives in three places and all three must agree: the cron
expression (`* * 1-5`), the edge `isMarketOpen`, and the `market` query-param
whitelist. A fix to fewer than three is not a fix.

### Attribution is a build requirement

CoinGecko's attribution guide mandates visible, hyperlinked attribution **close
to the data, above or below the data set** — not a footer and not an About page.

Every surface that shows a coin price carries "Price data by
[CoinGecko](https://www.coingecko.com)": the cockpit, the positions table, and
the position detail screen. One shared component so the wording cannot drift.

This is a term of use with a legal edge, so it is scoped as a requirement rather
than as polish, and a missing attribution is a failed acceptance criterion.

### What crypto is excluded from, and why

- **The weekly `holding_reviews` watch (0022)**, scoped to
  `asset_class = 'equity'`. Its two triggers are `earnings_calendar` and
  `fundamentals_delta`; neither exists for a coin, and running it anyway would
  spend a model call to report "no earnings date found" forever.
- **The thesis market picker** and **Discovery's shortlist** — crypto is
  holdings-only in v1.

### What crypto is included in

The cockpit and all totals; stop / target / time-exit alerts through the
unchanged trigger logic; and the imported-holding Exit Plan Builder, which uses
a geometry check and does not depend on fundamentals.

## Migrations

**0029 — numeric widenings, alone.** Safe on their own and unpleasant to
discover mid-import, so they land separately and first.

| Column | From | To |
|---|---|---|
| `entries.quantity`, `exits.quantity` | `numeric(18,6)` | `numeric(28,10)` |
| `entries.price`, `exits.price` | `numeric(14,4)` | `numeric(20,10)` |
| `trade_plans` — all seven price levels | `numeric(14,4)` | `numeric(20,10)` |
| `stocks.last_price` | `numeric(14,4)` | `numeric(20,10)` |

`stocks.last_price` is **not** in the PRD's list. Without it a sub-cent coin
rounds to `0.0000` on the display and polling path even after the PRD's own fix,
so the widening would look done and not be.

The PRD's diagnosis of `quantity` is also half right: `numeric(18,6)` holds
0.0043 BTC exactly, so the widening there is only needed for satoshi-level lots.
The column that actually breaks is `price`, where `numeric(14,4)` rounds a
sub-cent coin to zero and then `check (price > 0)` rejects the row outright.

All are plain `alter column type` widenings: no data loss, no rewrite risk at
this table size, and strictly safer for equities too.

**0030 — crypto.**

```sql
create type asset_class as enum ('equity', 'crypto');
alter table stocks add column asset_class asset_class not null default 'equity';
alter table stocks add column coingecko_id text;
create unique index on stocks (coingecko_id, currency) where coingecko_id is not null;

alter type exchange_code add value 'CRYPTO';
alter type market_code   add value 'CRYPTO';

create table crypto_universe (
  coingecko_id     text primary key,
  symbol           text not null,
  name             text not null,
  market_cap_rank  int  not null,
  refreshed_at     timestamptz not null default now()
);
```

`crypto_universe` gets RLS with a select-only policy for `authenticated`,
matching `stocks`.

Note the unique index is on `(coingecko_id, currency)`, not `coingecko_id`
alone as the PRD has it — one row per coin *per currency* is the whole point of
the design above, and the PRD's single-column index would forbid it.

#### A constraint on how 0030 may be written

`scripts/apply-migration.mjs` runs each file inside one transaction, and
Postgres refuses to **use** an enum value that was added by `alter type … add
value` in that same transaction. Verified against the live database
(PostgreSQL 17.6):

| In one transaction | Result |
|---|---|
| `add value 'CRYPTO'`, then `select 'CRYPTO'::exchange_code` | `unsafe use of new value "CRYPTO"` |
| `add value 'CRYPTO'` and nothing more | OK |
| `create type asset_class …` then use it as a column default | OK — the restriction is on `ALTER TYPE`, not `CREATE TYPE` |

0030 as specified is therefore safe: it adds `CRYPTO` to two existing enums and
never mentions it again, and `asset_class` is a new type, which is unrestricted.

**This is fragile and must be stated where the migration is written.** Adding
so much as a seed row with `exchange = 'CRYPTO'` to 0030 breaks it, with an
error that reads as a Postgres quirk rather than as "split this file." If a
statement ever needs to use `CRYPTO`, it belongs in 0031, not at the bottom of
0030.

**Deploy ordering.** Unlike 0027, neither migration breaks the deployed code:
0029 is a widening and 0030 is additive with a default. They can land before the
deploy without a coordinated window.

## Testing

- **Migration invariants.** A `numeric(28,10)` quantity round-trips ten
  decimals; a sub-cent price survives insert instead of failing `check (price >
  0)`; existing equity rows are unchanged.
- **`lib/crypto-data.ts`** against recorded fixtures: a batched multi-coin
  response, a 429, and a coin absent from the response.
- **`create-holding`** produces identical rows through both the import path and
  `POST /api/holdings`.
- **Currency routing.** A coin in an INR book prices in INR; the same coin in a
  USD book gets its own `stocks` row and prices in USD; the cockpit sums an INR
  coin with an INR equity into one bucket and the USD coin into another.
- **`resolveYahooSymbol` is never reached for a crypto row** — asserted
  directly, since that is the defect this replaces.
- **`poll-prices`** with `market=CRYPTO` does not consult `isMarketOpen`, and
  still fires a stop breach.
- **Attribution** renders on every surface showing a coin price.

## Out of scope

- Phase 4 — Council and pattern-read asset-class prompt work.
- Crypto in Discovery, the thesis flow, or the `holding_reviews` watch.
- Coins outside the top ten by market cap.
- Any FX conversion. Currencies stay separate, as they have since 0021.
- `supabase/functions/daily-digest/index.ts:96-157`, which groups alerts by
  `user_id` and should say which book an alert came from. Pre-existing, made
  more visible by portfolios, not caused by crypto.
