# Crypto Holdings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trader hold, price, and be alerted on the top-ten cryptocurrencies inside the multi-portfolio books that shipped in PR #14.

**Architecture:** A coin becomes a `stocks` row keyed on **(coin, currency)** with a synthetic `yahoo_symbol`, which buys the entire existing pricing, staleness and alerting pipeline unchanged. Prices come from CoinGecko in the book's own currency, so there is no FX layer. The "create a holding from nothing" sequence is extracted from the CSV import route so that the import and a new manual-add route share one implementation.

**Tech Stack:** Next.js (App Router, RSC), TypeScript, Supabase/Postgres 17.6, Vitest, Deno (Edge Functions), CoinGecko Demo API.

**Spec:** `docs/superpowers/specs/2026-09-04-crypto-holdings-design.md` (committed at `917f842`)

## Global Constraints

- **Migrations are applied by hand**, one file per transaction: `node --env-file=.env.local scripts/apply-migration.mjs <file>`. Use `/opt/homebrew/bin/node` (v25.5.0); the default `node` on PATH is too old.
- **`alter type … add value` may not be USED in the transaction that adds it.** Verified on PostgreSQL 17.6. A migration may add `CRYPTO` to an enum, but must not then reference `'CRYPTO'` anywhere in the same file. If a statement needs the value, it goes in a later migration.
- **`git` must be invoked as `/usr/bin/git`** — an old git 2.15.0 shadows it on PATH.
- **The repo is public.** No keys, no secrets, nothing identifying in any commit. `COINGECKO_API_KEY` lives only in `.env.local`, which is gitignored.
- **`docs/reel-script-intro.md` and `docs/thumbnail-reel-intro.png` are the user's own untracked files.** Never `git add` them.
- **CoinGecko attribution is mandatory**, verbatim: the text `Price data by CoinGecko` hyperlinked to `https://www.coingecko.com`, rendered close to the data (above or below the data set), on every surface showing a coin price. A missing attribution is a failed acceptance criterion, not a polish item.
- **CoinGecko Demo tier:** 100 calls/min, 10,000 credits/month. Auth is the `x-cg-demo-api-key` header against `https://api.coingecko.com/api/v3`. A Pro key uses a different header *and* host and is not a drop-in swap.
- **Verification after every task:** `npm test && npm run lint && npx tsc --noEmit`. The suite is **609 tests across 53 files** at the start of this plan.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0029_widen_numerics.sql` | Widen quantity/price columns. Nothing else. |
| `supabase/migrations/0030_crypto.sql` | `asset_class`, `coingecko_id`, enum values, `crypto_universe`. |
| `lib/types.ts` | Hand-maintained row/insert types. Gains `AssetClass`, `CryptoUniverseRow`, widened `MarketCode`/`ExchangeCode`. |
| `lib/markets.ts` | `MARKETS.CRYPTO` entry and the flag that keeps it out of the thesis picker. |
| `lib/crypto-data.ts` | The CoinGecko client. Prices, the top-ten universe, and the synthetic-key helper. Sibling of `lib/market-data.ts`, not a branch inside it. |
| `lib/portfolio/create-holding.ts` | The five-insert "holding from nothing" sequence, extracted from the import route so both entry paths share it. |
| `app/api/holdings/route.ts` | `POST` — manual add of a single coin. |
| `app/api/crypto/universe/route.ts` | `POST` — refresh the top ten. Cron-triggered, bearer-guarded. |
| `components/shared/coingecko-attribution.tsx` | The mandated attribution, in one place so the wording cannot drift. |
| `supabase/functions/poll-prices/index.ts` | Gains a `market=CRYPTO` branch that bypasses `isMarketOpen`. |

---

### Task 1: Migration 0029 — widen the numeric columns

Safe on their own, unpleasant to discover mid-import, and strictly better for equities too. They land first and alone.

**Files:**
- Create: `supabase/migrations/0029_widen_numerics.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `entries.quantity`/`exits.quantity` as `numeric(28,10)`; `entries.price`, `exits.price`, `stocks.last_price` and all seven `trade_plans` price levels as `numeric(20,10)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0029_widen_numerics.sql`:

```sql
-- Widen every quantity and price column ahead of crypto holdings.
--
-- See docs/superpowers/specs/2026-09-04-crypto-holdings-design.md. These are
-- separate from the crypto schema itself because they are safe on their own,
-- strictly better for equities too, and horrible to discover halfway through an
-- import that has already written half a batch.
--
-- The PRD's diagnosis was half right. `quantity` at numeric(18,6) holds 0.0043
-- BTC exactly, so widening it only matters for satoshi-level lots. The column
-- that actually BREAKS is `price`: numeric(14,4) rounds a sub-cent coin to
-- 0.0000, and `check (price > 0)` then rejects the row outright — so the
-- failure is a refused insert, not a quiet rounding.
--
-- `stocks.last_price` is absent from the PRD's list entirely. Without it a
-- sub-cent coin still collapses to 0.0000 on the display and polling path, and
-- the widening would look done without being done.
--
-- All plain `alter column type` widenings: no data loss, and no rewrite risk at
-- this table size.

alter table entries alter column quantity type numeric(28,10);
alter table exits   alter column quantity type numeric(28,10);

alter table entries alter column price type numeric(20,10);
alter table exits   alter column price type numeric(20,10);

alter table stocks  alter column last_price type numeric(20,10);

alter table trade_plans alter column entry_zone_low   type numeric(20,10);
alter table trade_plans alter column entry_zone_high  type numeric(20,10);
alter table trade_plans alter column stop_loss        type numeric(20,10);
alter table trade_plans alter column target_1         type numeric(20,10);
alter table trade_plans alter column target_2         type numeric(20,10);
alter table trade_plans alter column add_tranche_low  type numeric(20,10);
alter table trade_plans alter column add_tranche_high type numeric(20,10);
```

- [ ] **Step 2: Dry-run it against production, rolled back**

Write `/tmp/dryrun.mjs` (throwaway — do not commit):

```js
import { readFileSync } from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query("begin");
  await c.query(readFileSync(process.argv[2], "utf8"));
  console.log("OK  parses and applies");
  // A sub-cent price and a ten-decimal quantity must now survive.
  const { rows } = await c.query(`
    select 0.0000123456::numeric(20,10) as price,
           0.0000000001::numeric(28,10) as qty`);
  console.log("  price:", rows[0].price, " qty:", rows[0].qty);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("rolled back");
}
```

Run:

```bash
cp /tmp/dryrun.mjs ./.dryrun-tmp.mjs
/opt/homebrew/bin/node --env-file=.env.local ./.dryrun-tmp.mjs supabase/migrations/0029_widen_numerics.sql
rm -f ./.dryrun-tmp.mjs
```

Expected: `OK  parses and applies`, a non-zero `price`, then `rolled back`.

> The copy into the repo root is not decoration: `pg` resolves from the script's own directory, so a script left in `/tmp` fails with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Apply it for real**

```bash
/opt/homebrew/bin/node --env-file=.env.local scripts/apply-migration.mjs supabase/migrations/0029_widen_numerics.sql
```

Expected: `applied supabase/migrations/0029_widen_numerics.sql`

- [ ] **Step 4: Verify the live schema changed**

```bash
/opt/homebrew/bin/node --env-file=.env.local -e '
import("pg").then(async ({default: pg}) => {
  const c = new pg.Client({connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
  await c.connect();
  const {rows} = await c.query(`
    select table_name||"."||column_name t, numeric_precision p, numeric_scale s
    from information_schema.columns
    where table_schema=\x27public\x27 and data_type=\x27numeric\x27
      and table_name in (\x27entries\x27,\x27exits\x27,\x27trade_plans\x27,\x27stocks\x27)
    order by 1`.replace(/"/g, "\x27\x27"));
  for (const r of rows) console.log(`  ${r.t}  numeric(${r.p},${r.s})`);
  await c.end();
});'
```

Expected: every listed column reads `numeric(20,10)` or `numeric(28,10)`. `trade_plans.max_portfolio_pct` and `position_size_pct` stay `numeric(6,3)` — they are percentages and deliberately untouched.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add supabase/migrations/0029_widen_numerics.sql
/usr/bin/git commit -m "$(cat <<'EOF'
feat(schema): widen quantity and price columns for crypto

numeric(14,4) rounds a sub-cent coin to 0.0000 and `check (price > 0)` then
refuses the row, so the failure is a rejected insert rather than a quiet
rounding. `stocks.last_price` is included though the PRD omits it — without it
a coin still collapses to zero on the display and polling path.

Applied to production. Plain widenings: no data loss, no rewrite risk at this
size, and strictly safer for equities too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 0030 — the crypto schema

**Files:**
- Create: `supabase/migrations/0030_crypto.sql`

**Interfaces:**
- Consumes: Task 1's widened columns.
- Produces: `asset_class` enum (`equity` | `crypto`); `stocks.asset_class`, `stocks.coingecko_id`; `CRYPTO` added to `exchange_code` and `market_code`; table `crypto_universe(coingecko_id pk, symbol, name, market_cap_rank, refreshed_at)`.

> **Read the Global Constraint on enums before writing this file.** This migration adds `CRYPTO` to two existing enums and must not reference `'CRYPTO'` again anywhere in the same file — no seed row, no default, no check constraint. Postgres will reject it with `unsafe use of new value "CRYPTO"`, which reads like a quirk rather than like "split this file."

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0030_crypto.sql`:

```sql
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
```

- [ ] **Step 2: Dry-run it**

```bash
cp /tmp/dryrun.mjs ./.dryrun-tmp.mjs
/opt/homebrew/bin/node --env-file=.env.local ./.dryrun-tmp.mjs supabase/migrations/0030_crypto.sql
rm -f ./.dryrun-tmp.mjs
```

Expected: `OK  parses and applies`, then `rolled back`. If it fails with `unsafe use of new value "CRYPTO"`, a statement below the `alter type` lines is referencing the value — move it to 0031.

- [ ] **Step 3: Apply it**

```bash
/opt/homebrew/bin/node --env-file=.env.local scripts/apply-migration.mjs supabase/migrations/0030_crypto.sql
```

- [ ] **Step 4: Verify**

```bash
/opt/homebrew/bin/node --env-file=.env.local -e '
import("pg").then(async ({default: pg}) => {
  const c = new pg.Client({connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
  await c.connect();
  const q = async (s) => (await c.query(s)).rows;
  const e = await q(`select t.typname, string_agg(e.enumlabel, \x27,\x27 order by e.enumsortorder) v
    from pg_type t join pg_enum e on e.enumtypid=t.oid
    where t.typname in (\x27asset_class\x27,\x27exchange_code\x27,\x27market_code\x27) group by 1 order by 1`);
  for (const r of e) console.log(`  ${r.typname}: ${r.v}`);
  console.log("  crypto_universe:", (await q("select to_regclass(\x27public.crypto_universe\x27) t"))[0].t);
  console.log("  equities untouched:", (await q("select count(*)::int n from stocks where asset_class=\x27equity\x27"))[0].n);
  await c.end();
});'
```

Expected: `asset_class: equity,crypto`; `exchange_code: NSE,BSE,US,CRYPTO`; `market_code: US,IN,CN,EU,EM,CRYPTO`; `crypto_universe: crypto_universe`; and every pre-existing `stocks` row defaulted to `equity`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add supabase/migrations/0030_crypto.sql
/usr/bin/git commit -m "$(cat <<'EOF'
feat(schema): asset class, CoinGecko id, and the top-ten universe

A coin becomes a `stocks` row, because `stocks` is what the whole pricing and
alerting pipeline reads. The grain is one row per (coin, currency): `stocks`
carries last_price AND currency on the row, so one shared 'bitcoin' row could
hold only one price in one currency, and an INR book and a USD book could not
both be right.

The unique index is therefore on (coingecko_id, currency). The PRD's
single-column version would forbid the design rather than support it.

This file deliberately never mentions 'CRYPTO' after adding it: Postgres
refuses to use an enum value in the transaction that added it, and
apply-migration.mjs wraps each file in one transaction.

Applied to production.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Types and market config

**Files:**
- Modify: `lib/types.ts:12` (`ExchangeCode`), `:19` (`MarketCode`), `:78-93` (`Stock`)
- Modify: `lib/markets.ts:22-33` (`MarketMeta`), `:35` (`MARKETS`), `:65` (`MARKET_ORDER`)
- Test: `lib/__tests__/markets.test.ts` (exists — extend it)

**Interfaces:**
- Consumes: Task 2's schema.
- Produces: `AssetClass = "equity" | "crypto"`; `Stock.asset_class: AssetClass`; `Stock.coingecko_id: string | null`; `CryptoUniverseRow`; `MarketCode` and `ExchangeCode` both including `"CRYPTO"`; `MarketMeta.tradable: boolean`; `THESIS_MARKETS: MarketCode[]`.

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/markets.test.ts`:

```ts
describe("CRYPTO market", () => {
  it("is live, so a holding can be imported into it", () => {
    expect(MARKETS.CRYPTO.live).toBe(true);
  });

  it("is not offered for a thesis", () => {
    // Crypto is holdings-only in v1: there is no Discovery shortlist for it and
    // no memorandum to write. A market picker that offers it would produce a
    // thesis the rest of the app cannot service.
    expect(MARKETS.CRYPTO.tradable).toBe(false);
    expect(THESIS_MARKETS).not.toContain("CRYPTO");
    expect(THESIS_MARKETS).toContain("IN");
    expect(THESIS_MARKETS).toContain("US");
  });

  it("has no exchanges, because a coin is not listed anywhere", () => {
    expect(MARKETS.CRYPTO.exchanges).toEqual([]);
  });

  it("keeps every equity market tradable", () => {
    // Guards against `tradable` being added and then silently defaulting the
    // existing markets to false.
    expect(MARKETS.IN.tradable).toBe(true);
    expect(MARKETS.US.tradable).toBe(true);
  });
});
```

Add to `lib/__tests__/market-data.test.ts` (it exists — extend it):

```ts
describe("resolveYahooSymbol on a crypto row", () => {
  it("throws rather than returning a symbol Yahoo will happily answer", () => {
    // This is the defect the whole feature replaces, asserted directly.
    // resolveYahooSymbol("BTC-USD","US") returns "BTC-USD" unchanged today, and
    // Yahoo answers it with a real quote whose currency passes the import's
    // gate — so a coin persists as exchange 'US' and is then polled on US
    // market hours. Reaching this function with a coin now means a caller lost
    // track of asset class, and that must be loud, not silently plausible.
    expect(() => resolveYahooSymbol("BTC", "CRYPTO")).toThrow(MarketDataError);
    expect(() => resolveYahooSymbol("BTC", "CRYPTO")).toThrow(/CoinGecko/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run lib/__tests__/markets.test.ts
```

Expected: FAIL — `MARKETS.CRYPTO` is undefined and `THESIS_MARKETS` is not exported.

- [ ] **Step 3: Widen the types**

In `lib/types.ts`, replace line 12 and line 19:

```ts
export type ExchangeCode = "NSE" | "BSE" | "US" | "CRYPTO";
```

```ts
export type MarketCode = "US" | "IN" | "CN" | "EU" | "EM" | "CRYPTO";
```

Add above the `Stock` type:

```ts
/**
 * What KIND of instrument a `stocks` row is (0030).
 *
 * The discriminator that decides which price source answers for a row:
 * `equity` goes to Yahoo via `yahoo_symbol`, `crypto` goes to CoinGecko via
 * `coingecko_id`. Deliberately not inferred from `exchange` — asset class is a
 * property of the instrument, and the venue is a separate fact about it.
 */
export type AssetClass = "equity" | "crypto";
```

Add to the `Stock` type, after `currency`:

```ts
  asset_class: AssetClass;
  /**
   * CoinGecko's stable id ('bitcoin'), null for equities. Not the ticker:
   * 'BTC' is ambiguous and resolves on Yahoo to a US-listed trust, which is
   * the wrong asset with no error.
   */
  coingecko_id: string | null;
```

Add near the other row types:

```ts
/** A row of the top-ten-by-market-cap reference table (0030). */
export type CryptoUniverseRow = {
  coingecko_id: string;
  symbol: string;
  name: string;
  market_cap_rank: number;
  refreshed_at: string;
};
```

- [ ] **Step 4: Add the market entry**

In `lib/markets.ts`, add to `MarketMeta`:

```ts
  /**
   * Offered when picking a market for a THESIS. False for crypto, which is
   * holdings-only in v1 — there is no shortlist to build and no memorandum to
   * write, so offering it would produce a thesis the app cannot service.
   * `live` still governs whether holdings may be imported.
   */
  tradable: boolean;
```

Set `tradable: true` on `US` and `IN`, and `tradable: false` on `CN`, `EU`, `EM` (they are not live either). Add the entry:

```ts
  CRYPTO: {
    label: "Crypto",
    live: true,
    tradable: false,
    // A coin is not listed on an exchange. `stocks.exchange` gets the sentinel
    // 'CRYPTO' so the NOT NULL column has an honest value, but nothing resolves
    // an exchange for a coin the way `exchangesFor` does for an equity.
    exchanges: [],
    // INERT, AND MUST NOT BE READ FOR A CRYPTO ROW. Every other market has one
    // fixed currency; crypto's comes from the portfolio's `base_currency`, and
    // the currency of record is `stocks.currency`, which is what the positions
    // table already prefers. These three exist because `MarketMeta` requires
    // them, not because they mean anything here.
    currency: "USD",
    symbol: "$",
    locale: "en-US",
  },
```

Extend `MARKET_ORDER` and add the thesis list:

```ts
export const MARKET_ORDER: MarketCode[] = ["US", "IN", "CN", "EU", "EM", "CRYPTO"];

/**
 * The markets a THESIS may be about — every live market except crypto.
 *
 * Separate from `LIVE_MARKETS` because "can I hold this" and "can Jarvis write
 * a memorandum about this" stopped being the same question when crypto arrived.
 */
export const THESIS_MARKETS: MarketCode[] = MARKET_ORDER.filter(
  (m) => MARKETS[m].live && MARKETS[m].tradable,
);
```

- [ ] **Step 5: Point the thesis pickers at `THESIS_MARKETS`**

```bash
grep -rn "LIVE_MARKETS\|MARKET_ORDER" app components lib --include="*.ts" --include="*.tsx" | grep -v __tests__
```

Every site that offers markets for a **thesis** switches to `THESIS_MARKETS`. The **import wizard's** picker stays on a live-markets list, because importing a coin is exactly what this feature adds. Read each call site before changing it.

- [ ] **Step 6: Run tests**

```bash
npm test && npx tsc --noEmit
```

Expected: PASS. `tsc` will flag any `switch` over `MarketCode`/`ExchangeCode` that is now non-exhaustive — notably `resolveYahooSymbol` (`lib/market-data.ts:30-43`). Fix it by throwing:

```ts
    case "CRYPTO":
      // Reaching here is a bug, not a missing feature: a crypto row is priced
      // by `lib/crypto-data.ts` and never has a Yahoo symbol to build. Throwing
      // names the caller that lost track of asset class.
      throw new MarketDataError(
        `resolveYahooSymbol called for a crypto row (${ticker}) — crypto prices come from CoinGecko`,
      );
```

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add lib/types.ts lib/markets.ts lib/__tests__/markets.test.ts
/usr/bin/git commit -m "$(cat <<'EOF'
feat(crypto): asset class in the types, CRYPTO in the market table

Splits "can I hold this" from "can Jarvis write a memorandum about this" —
they were the same question until crypto arrived. `live` still governs imports;
the new `tradable` governs the thesis picker, and THESIS_MARKETS is what those
pickers now read.

`resolveYahooSymbol` throws on a crypto row rather than falling through. It is
the function that today resolves BTC-USD to a real Yahoo quote and persists the
coin as exchange 'US'; reaching it now means a caller lost track of asset class,
and that should say so loudly.

MARKETS.CRYPTO's currency/symbol/locale are inert and commented as such: every
other market has one fixed currency, and crypto's comes from the book.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `lib/crypto-data.ts` — the CoinGecko client

**Files:**
- Create: `lib/crypto-data.ts`
- Test: `lib/__tests__/crypto-data.test.ts`

**Interfaces:**
- Consumes: `withRetry` from `lib/market-data.ts:105`; `CryptoUniverseRow` from Task 3.
- Produces:
  - `cryptoStockKey(coingeckoId: string, currency: string): string` → `'coingecko:bitcoin:inr'`
  - `getCryptoPrices(ids: string[], currency: string): Promise<Map<string, { price: number; asOf: Date }>>`
  - `fetchTopCoins(limit: number): Promise<Omit<CryptoUniverseRow, "refreshed_at">[]>`
  - `class CryptoDataError extends Error`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/crypto-data.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CryptoDataError, cryptoStockKey, fetchTopCoins, getCryptoPrices } from "@/lib/crypto-data";

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  vi.stubEnv("COINGECKO_API_KEY", "test-key");
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("cryptoStockKey", () => {
  it("builds a key that cannot collide with a Yahoo symbol", () => {
    // Yahoo symbols are uppercase and contain no colons, so this namespace is
    // unreachable from the equity side.
    expect(cryptoStockKey("bitcoin", "INR")).toBe("coingecko:bitcoin:inr");
  });

  it("lower-cases the currency so one coin in one book is one key", () => {
    expect(cryptoStockKey("bitcoin", "inr")).toBe(cryptoStockKey("bitcoin", "INR"));
  });
});

describe("getCryptoPrices", () => {
  it("prices every coin in one call, in the currency asked for", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({
        bitcoin: { inr: 7515223, last_updated_at: 1788544990 },
        ethereum: { inr: 231262, last_updated_at: 1788544990 },
      }),
    );

    const prices = await getCryptoPrices(["bitcoin", "ethereum"], "INR");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("ids=bitcoin%2Cethereum");
    expect(url).toContain("vs_currencies=inr");
    expect(prices.get("bitcoin")?.price).toBe(7515223);
    expect(prices.get("ethereum")?.asOf).toEqual(new Date(1788544990 * 1000));
  });

  it("sends the demo key as a header, never in the query string", async () => {
    // A key in a URL ends up in logs, referrers and error reports.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ bitcoin: { usd: 1 } }));
    await getCryptoPrices(["bitcoin"], "USD");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("test-key");
    expect((init?.headers as Record<string, string>)["x-cg-demo-api-key"]).toBe("test-key");
  });

  it("omits a coin the response does not mention rather than inventing a zero", async () => {
    // A missing price must not read as a price of nothing: `last_price` stays
    // null and the UI says "Price unavailable".
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ bitcoin: { usd: 79551 } }));
    const prices = await getCryptoPrices(["bitcoin", "dogecoin"], "USD");
    expect(prices.has("dogecoin")).toBe(false);
    expect(prices.size).toBe(1);
  });

  it("throws on a rate limit rather than returning an empty book", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, status: 429, json: async () => ({}),
    } as Response);
    await expect(getCryptoPrices(["bitcoin"], "USD")).rejects.toThrow(CryptoDataError);
  });

  it("does not call the API at all for an empty id list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect((await getCryptoPrices([], "INR")).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchTopCoins", () => {
  it("returns the ranked universe", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok([
        { id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1 },
        { id: "ethereum", symbol: "eth", name: "Ethereum", market_cap_rank: 2 },
      ]),
    );

    const coins = await fetchTopCoins(10);

    expect(coins).toEqual([
      { coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 },
      { coingecko_id: "ethereum", symbol: "ETH", name: "Ethereum", market_cap_rank: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run lib/__tests__/crypto-data.test.ts
```

Expected: FAIL — cannot resolve `@/lib/crypto-data`.

- [ ] **Step 3: Implement the client**

Create `lib/crypto-data.ts`:

```ts
import { withRetry } from "@/lib/market-data";
import type { CryptoUniverseRow } from "@/lib/types";

/**
 * CoinGecko, for crypto holdings (0030).
 *
 * A SIBLING of `lib/market-data.ts`, not a branch inside it. The two share
 * nothing but `withRetry`: Yahoo is per-symbol and exchange-suffixed, CoinGecko
 * is batched and currency-native, and `resolveYahooSymbol` is never called for
 * a coin. Folding them together would produce a function whose every line is an
 * `if` on asset class.
 *
 * Two properties of the API make this cheap. `/simple/price` is BATCHED, so one
 * request prices every coin held in a currency; and it takes `vs_currency`
 * NATIVELY, so a coin in a rupee book prices in rupees and the existing
 * per-currency totals (0021) do the rest with no FX conversion anywhere.
 *
 * Auth is the `x-cg-demo-api-key` HEADER against api.coingecko.com. A Pro key
 * uses a different header AND a different host, so it is not a drop-in swap.
 * Demo tier allows 100 calls/min and 10,000 credits/month; hourly polling of a
 * handful of coins uses roughly 7-15% of that.
 */

const BASE = "https://api.coingecko.com/api/v3";

export class CryptoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoDataError";
  }
}

/**
 * The synthetic `stocks.yahoo_symbol` for a coin priced in one currency.
 *
 * `stocks` carries `last_price` and `currency` on the row, so the grain has to
 * be (coin, currency) or an INR book and a USD book holding the same coin
 * cannot both be right. Real Yahoo symbols are uppercase and contain no colons,
 * so this namespace can never collide with one.
 *
 * The column is named `yahoo_symbol` and this is not a Yahoo symbol. That is a
 * deliberate lie, and it buys the whole existing pipeline — the `onConflict:
 * "yahoo_symbol"` upsert, `last_price_at` staleness, every alert trigger —
 * unchanged. The alternative costs a branch in roughly fifteen call sites.
 */
export function cryptoStockKey(coingeckoId: string, currency: string): string {
  return `coingecko:${coingeckoId.toLowerCase()}:${currency.toLowerCase()}`;
}

function apiKey(): string {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) {
    throw new CryptoDataError(
      "COINGECKO_API_KEY is not set — crypto prices cannot be fetched.",
    );
  }
  return key;
}

async function getJson<T>(path: string): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-cg-demo-api-key": apiKey(), accept: "application/json" },
    });
    if (!res.ok) {
      throw new CryptoDataError(`CoinGecko ${path} failed with HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  });
}

/**
 * Current price per coin, keyed by CoinGecko id.
 *
 * A coin the response does not mention is OMITTED rather than defaulted. A
 * missing price must never read as a price of zero: `last_price` stays null and
 * the UI says "Price unavailable", which is true, where a zero would render a
 * holding as a total loss.
 */
export async function getCryptoPrices(
  ids: string[],
  currency: string,
): Promise<Map<string, { price: number; asOf: Date }>> {
  const out = new Map<string, { price: number; asOf: Date }>();
  if (ids.length === 0) return out;

  const vs = currency.toLowerCase();
  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: vs,
    include_last_updated_at: "true",
  });

  const body = await getJson<Record<string, Record<string, number>>>(
    `/simple/price?${params.toString()}`,
  );

  for (const id of ids) {
    const row = body[id];
    const price = row?.[vs];
    if (typeof price !== "number") continue;
    const stamp = row.last_updated_at;
    out.set(id, {
      price,
      asOf: typeof stamp === "number" ? new Date(stamp * 1000) : new Date(),
    });
  }
  return out;
}

/** The top `limit` coins by market cap, ranked. Feeds `crypto_universe`. */
export async function fetchTopCoins(
  limit: number,
): Promise<Omit<CryptoUniverseRow, "refreshed_at">[]> {
  const params = new URLSearchParams({
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: String(limit),
    page: "1",
  });

  const body = await getJson<
    { id: string; symbol: string; name: string; market_cap_rank: number }[]
  >(`/coins/markets?${params.toString()}`);

  return body.map((c) => ({
    coingecko_id: c.id,
    // Upper-cased here so the ticker a trader types matches what is stored.
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    market_cap_rank: c.market_cap_rank,
  }));
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run lib/__tests__/crypto-data.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add lib/crypto-data.ts lib/__tests__/crypto-data.test.ts
/usr/bin/git commit -m "$(cat <<'EOF'
feat(crypto): the CoinGecko client

A sibling of lib/market-data.ts rather than a branch inside it. The two share
nothing but withRetry: Yahoo is per-symbol and exchange-suffixed, CoinGecko is
batched and currency-native. Folding them together would produce a function
whose every line is an `if` on asset class.

Batched and currency-native is what makes this cheap: one request prices every
coin held in a currency, and it prices them in that currency directly, so the
per-currency totals from 0021 work with no FX layer anywhere.

A coin missing from a response is omitted, never defaulted to zero. A zero
would render a holding as a total loss; a null renders as "Price unavailable",
which is what is actually known.

The key goes in a header, never the query string, so it stays out of logs and
error reports.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The universe refresh route

**Files:**
- Create: `app/api/crypto/universe/route.ts`
- Test: `app/api/crypto/universe/__tests__/route.test.ts`
- Modify: `supabase/migrations/0003_pg_cron_jobs.sql.example`

**Interfaces:**
- Consumes: `fetchTopCoins` (Task 4).
- Produces: `POST /api/crypto/universe` → `{ refreshed: number }`. Bearer-guarded by `HOLDING_WATCH_SECRET`.

> Reuses the existing cron secret rather than minting a second one. Both endpoints are "a scheduled job may call this and nobody else may", the secret is already in Supabase Vault, and a second secret is a second thing to rotate for no additional isolation.

- [ ] **Step 1: Write the failing test**

Create `app/api/crypto/universe/__tests__/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/crypto-data", () => ({ fetchTopCoins: vi.fn() }));

import { fetchTopCoins } from "@/lib/crypto-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

let upserted: unknown[] | null = null;

function mockAdmin(error: { message: string } | null = null) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table !== "crypto_universe") throw new Error(`unexpected table ${table}`);
      return { upsert: async (rows: unknown[]) => { upserted = rows; return { error }; } };
    }),
  };
}

const post = (secret = "s3cret") =>
  new Request("http://test/api/crypto/universe", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });

beforeEach(() => {
  vi.clearAllMocks();
  upserted = null;
  vi.stubEnv("HOLDING_WATCH_SECRET", "s3cret");
  vi.mocked(createAdminClient).mockReturnValue(mockAdmin() as never);
  vi.mocked(fetchTopCoins).mockResolvedValue([
    { coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 },
  ] as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/crypto/universe", () => {
  it("stores the ranked top ten", async () => {
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect((await res.json()).refreshed).toBe(1);
    expect(upserted).toEqual([
      expect.objectContaining({ coingecko_id: "bitcoin", symbol: "BTC", market_cap_rank: 1 }),
    ]);
  });

  it("stamps refreshed_at so staleness is visible", async () => {
    await POST(post());
    expect((upserted as Record<string, unknown>[])[0].refreshed_at).toEqual(expect.any(String));
  });

  it("refuses a request with the wrong secret", async () => {
    const res = await POST(post("wrong"));
    expect(res.status).toBe(401);
    expect(fetchTopCoins).not.toHaveBeenCalled();
  });

  it("refuses every request while the secret is unset, rather than failing open", async () => {
    vi.stubEnv("HOLDING_WATCH_SECRET", "");
    expect((await POST(post())).status).toBe(503);
    expect(fetchTopCoins).not.toHaveBeenCalled();
  });

  it("500s when the write fails, so a silent no-op cannot look like a refresh", async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin({ message: "boom" }) as never);
    expect((await POST(post())).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run app/api/crypto/universe/__tests__/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Read the existing bearer guard, then implement**

```bash
grep -n "HOLDING_WATCH_SECRET" -B 4 -A 14 app/api/portfolio/holding-watch/route.ts | head -40
```

Create `app/api/crypto/universe/route.ts`, following that guard exactly:

```ts
import { NextResponse } from "next/server";

import { fetchTopCoins } from "@/lib/crypto-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Refreshes the top-ten crypto universe. Called by pg_cron, weekly.
 *
 * Weekly is ample: market-cap rank does not churn, and this table only governs
 * what can be ADDED. A coin that falls out of the top ten keeps its positions,
 * its history and its alerts — it simply stops being offered for new holdings.
 *
 * Guarded by the same bearer secret as the holding watch. Both are "a scheduled
 * job may call this and nobody else may", the secret is already in Supabase
 * Vault, and a second one would be a second thing to rotate for no extra
 * isolation. Like that route, this REFUSES while the secret is unset rather
 * than failing open.
 */
export const dynamic = "force-dynamic";

const UNIVERSE_SIZE = 10;

export async function POST(request: Request) {
  const secret = process.env.HOLDING_WATCH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "This endpoint is not configured." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let coins;
  try {
    coins = await fetchTopCoins(UNIVERSE_SIZE);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach CoinGecko." },
      { status: 502 },
    );
  }

  const refreshed_at = new Date().toISOString();
  // Shared reference data: service-role writes, `authenticated` only reads.
  const { error } = await createAdminClient()
    .from("crypto_universe")
    .upsert(coins.map((c) => ({ ...c, refreshed_at })));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ refreshed: coins.length });
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run app/api/crypto/universe/__tests__/route.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Seed the universe for real**

```bash
npm run dev &
sleep 8
set -a; . ./.env.local; set +a
curl -s -X POST -H "authorization: Bearer $HOLDING_WATCH_SECRET" http://localhost:3000/api/crypto/universe
kill %1
```

Expected: `{"refreshed":10}`. Then confirm the rows landed:

```bash
/opt/homebrew/bin/node --env-file=.env.local -e '
import("pg").then(async ({default: pg}) => {
  const c = new pg.Client({connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
  await c.connect();
  const {rows} = await c.query("select market_cap_rank r, symbol, coingecko_id from crypto_universe order by r");
  for (const x of rows) console.log(`  ${x.r}. ${x.symbol} (${x.coingecko_id})`);
  await c.end();
});'
```

- [ ] **Step 6: Document the cron entry**

Append to `supabase/migrations/0003_pg_cron_jobs.sql.example`, matching the file's existing style and its Vault-not-literal-key rule:

```sql
-- - crypto-universe: the top ten by market cap, weekly. Rank does not churn,
--   and this table governs only what can be ADDED, never what can be held.
--   Sunday 02:00 UTC, well away from either equity session.
select cron.schedule(
  'crypto-universe',
  '0 2 * * 0',
  $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/../api/crypto/universe',
    headers:= jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holding_watch_secret')
    )
  );
  $$
);
```

> Replace the `url` with the deployed Next.js origin — this route is a Next API route, not an Edge Function, so it does not live under `/functions/v1/`. Read the neighbouring `holding-watch` entry in the same file and copy its URL shape exactly.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add app/api/crypto/universe supabase/migrations/0003_pg_cron_jobs.sql.example
/usr/bin/git commit -m "$(cat <<'EOF'
feat(crypto): refresh the top-ten universe weekly

The universe governs what can be ADDED, never what can be held: a coin that
falls out of the top ten keeps its positions, its history and its alerts. That
is why weekly is ample and why a stale table is harmless.

Reuses the holding-watch bearer secret rather than minting a second one. Both
endpoints are "a scheduled job may call this and nobody else may", it is
already in Vault, and a second secret is a second thing to rotate for no extra
isolation. Refuses while unset rather than failing open, same as that route.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Extract `create-holding.ts`

The five-insert sequence currently inlined at `app/api/portfolio/imports/route.ts:237-302`. Extracted so the import and the manual add share one implementation instead of drifting apart.

**Files:**
- Create: `lib/portfolio/create-holding.ts`
- Modify: `app/api/portfolio/imports/route.ts:237-302`
- Test: `lib/__tests__/create-holding.test.ts`

**Interfaces:**
- Consumes: `lib/testing/supabase-mock.ts` (`buildSupabaseMock`).
- Produces:

```ts
export type HoldingDraft = {
  ticker: string;
  stockId: string;
  quantity: number;
  price: number;
  date: string;
  note?: string;
  entryNote: string;
  assetClass: AssetClass;
};

export type HoldingRows = {
  theses: ThesisInsert[];
  tradePlans: TradePlanInsert[];
  positions: PositionInsert[];
  entries: EntryInsert[];
  watchState: HoldingWatchStateInsert[];
};

export function buildHoldingRows(
  drafts: HoldingDraft[],
  ctx: { portfolioId: string; market: MarketCode; importBatchId: string | null },
): HoldingRows;
```

> **Pure row-building, not writing.** The import needs its own rollback (`delete from theses`, which cascades) and its own batch bookkeeping; the manual add needs neither. Returning rows keeps the shared part shared and leaves each caller its own failure handling.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/create-holding.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildHoldingRows, type HoldingDraft } from "@/lib/portfolio/create-holding";

const PF1 = "11111111-1111-4111-8111-111111111111";

const draft = (over: Partial<HoldingDraft> = {}): HoldingDraft => ({
  ticker: "INFY",
  stockId: "stock-1",
  quantity: 10,
  price: 1500,
  date: "2026-01-15",
  entryNote: "Imported from broker.csv.",
  assetClass: "equity",
  ...over,
});

describe("buildHoldingRows", () => {
  it("mints a thesis, a plan, a position and an entry per holding", () => {
    const rows = buildHoldingRows([draft()], { portfolioId: PF1, market: "IN", importBatchId: "b1" });

    expect(rows.theses).toHaveLength(1);
    expect(rows.tradePlans).toHaveLength(1);
    expect(rows.positions).toHaveLength(1);
    expect(rows.entries).toHaveLength(1);
  });

  it("wires the four rows to each other by id", () => {
    // `positions.thesis_id` and `.trade_plan_id` are NOT NULL, which is the
    // whole reason the stubs exist.
    const { theses, tradePlans, positions, entries } = buildHoldingRows(
      [draft()], { portfolioId: PF1, market: "IN", importBatchId: "b1" },
    );
    expect(positions[0].thesis_id).toBe(theses[0].id);
    expect(positions[0].trade_plan_id).toBe(tradePlans[0].id);
    expect(tradePlans[0].thesis_id).toBe(theses[0].id);
    expect(entries[0].position_id).toBe(positions[0].id);
  });

  it("files the position in the book it was told, never a default", () => {
    const { positions } = buildHoldingRows([draft()], { portfolioId: PF1, market: "IN", importBatchId: null });
    expect(positions[0].portfolio_id).toBe(PF1);
  });

  it("leaves every trade-plan level null", () => {
    // No analysis produced a plan. Inventing a stop for a position this app
    // never sized would be worse than admitting there isn't one.
    const { tradePlans } = buildHoldingRows([draft()], { portfolioId: PF1, market: "IN", importBatchId: "b1" });
    expect(tradePlans[0].stop_loss ?? null).toBeNull();
    expect(tradePlans[0].target_1 ?? null).toBeNull();
  });

  it("queues an equity for the weekly holding watch", () => {
    const { watchState, positions } = buildHoldingRows(
      [draft()], { portfolioId: PF1, market: "IN", importBatchId: "b1" },
    );
    expect(watchState).toEqual([{ position_id: positions[0].id }]);
  });

  it("does NOT queue a coin for the holding watch", () => {
    // The watch's two triggers are earnings and fundamentals deltas. Neither
    // exists for a coin, so queueing one spends a model call to report "no
    // earnings date found" every week, forever.
    const { watchState } = buildHoldingRows(
      [draft({ ticker: "BTC", assetClass: "crypto" })],
      { portfolioId: PF1, market: "CRYPTO", importBatchId: null },
    );
    expect(watchState).toEqual([]);
  });

  it("uses the trader's own words as the thesis input when they gave any", () => {
    const { theses } = buildHoldingRows(
      [draft({ note: "Bought on the dip." })],
      { portfolioId: PF1, market: "IN", importBatchId: "b1" },
    );
    expect(theses[0].input_text).toBe("Bought on the dip.");
  });

  it("still says something when they gave none", () => {
    // `theses.input_text` is NOT NULL, and a later per-holding review is only
    // as grounded as this string.
    const { theses } = buildHoldingRows([draft()], { portfolioId: PF1, market: "IN", importBatchId: "b1" });
    expect(theses[0].input_text).toContain("INFY");
    expect(theses[0].input_text!.length).toBeGreaterThan(0);
  });

  it("carries a null batch id for a manual add", () => {
    const { theses } = buildHoldingRows([draft()], { portfolioId: PF1, market: "CRYPTO", importBatchId: null });
    expect(theses[0].import_batch_id).toBeNull();
  });

  it("gives every row a distinct id across a multi-row batch", () => {
    const { positions } = buildHoldingRows(
      [draft(), draft({ ticker: "TCS" })],
      { portfolioId: PF1, market: "IN", importBatchId: "b1" },
    );
    expect(positions[0].id).not.toBe(positions[1].id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run lib/__tests__/create-holding.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Read the code being extracted, then write the module**

```bash
sed -n '237,305p' app/api/portfolio/imports/route.ts
grep -n "importRationalePlaceholder" -A 8 lib/portfolio-import.ts
```

Create `lib/portfolio/create-holding.ts`, preserving every comment from the original:

```ts
import { importRationalePlaceholder } from "@/lib/portfolio-import";
import type {
  AssetClass,
  EntryInsert,
  HoldingWatchStateInsert,
  MarketCode,
  PositionInsert,
  ThesisInsert,
  TradePlanInsert,
} from "@/lib/types";

/**
 * The rows that make a holding out of nothing.
 *
 * `positions.thesis_id` and `positions.trade_plan_id` are both NOT NULL, so a
 * holding the app did not analyse still needs a thesis and a plan behind it.
 * Until crypto there was exactly one caller — the CSV import — and this lived
 * inline in its route. There are two now, and a five-insert sequence copied
 * twice drifts the first time either copy is touched.
 *
 * PURE. It returns rows and writes nothing: the import needs a rollback that
 * deletes theses (everything else cascades) and a batch audit row, the manual
 * add needs neither, and pushing that difference in here would mean a function
 * with two modes. Each caller owns its own failure handling.
 */

export type HoldingDraft = {
  ticker: string;
  stockId: string;
  quantity: number;
  price: number;
  date: string;
  /** The trader's own words, if they gave any. */
  note?: string;
  /** Provenance for the entry row — which file, or that it was added by hand. */
  entryNote: string;
  /** Decides whether the weekly holding watch is queued. */
  assetClass: AssetClass;
};

export type HoldingRows = {
  theses: ThesisInsert[];
  tradePlans: TradePlanInsert[];
  positions: PositionInsert[];
  entries: EntryInsert[];
  watchState: HoldingWatchStateInsert[];
};

export function buildHoldingRows(
  drafts: HoldingDraft[],
  ctx: { portfolioId: string; market: MarketCode; importBatchId: string | null },
): HoldingRows {
  const rows: HoldingRows = {
    theses: [], tradePlans: [], positions: [], entries: [], watchState: [],
  };

  for (const draft of drafts) {
    // Ids are generated up front so nothing depends on PostgREST returning
    // inserted rows in the order they were sent.
    const thesisId = crypto.randomUUID();
    const tradePlanId = crypto.randomUUID();
    const positionId = crypto.randomUUID();
    const note = draft.note?.trim();

    rows.theses.push({
      id: thesisId,
      // NOT NULL, so it always says something. The trader's own words when
      // they gave them: a later per-holding review is only as grounded as this.
      input_text: note && note.length > 0 ? note : importRationalePlaceholder(draft.ticker),
      mode: "stock_only",
      status: "active",
      markets: [ctx.market],
      // Setting `ticker` is exactly what this field is for: it may only ever be
      // set when the TRADER named the stock, and owning it is the strongest
      // form of naming it.
      ticker: draft.ticker,
      stock_id: draft.stockId,
      source: "imported",
      import_batch_id: ctx.importBatchId,
    });

    // Every level null: no analysis produced a trade plan, and inventing an
    // entry zone or a stop for a position this app never sized would be worse
    // than admitting there isn't one. The row exists because
    // `positions.trade_plan_id` is NOT NULL and the position detail page reads
    // it with `.single()`.
    rows.tradePlans.push({ id: tradePlanId, thesis_id: thesisId });

    rows.positions.push({
      id: positionId,
      portfolio_id: ctx.portfolioId,
      thesis_id: thesisId,
      trade_plan_id: tradePlanId,
      stock_id: draft.stockId,
      ticker: draft.ticker,
      status: "active",
    });

    rows.entries.push({
      id: crypto.randomUUID(),
      position_id: positionId,
      date: draft.date,
      quantity: draft.quantity,
      price: draft.price,
      tranche: "T1",
      notes: draft.entryNote,
    });

    // Queues the initial read rather than running it here (0022) -- but ONLY
    // for an equity. The watch's two triggers are `earnings_calendar` and
    // `fundamentals_delta`, and a coin has neither, so queueing one would spend
    // a model call every week to report "no earnings date found" forever.
    // Skipping the insert IS the scoping: what is never queued is never
    // drained.
    if (draft.assetClass === "equity") {
      rows.watchState.push({ position_id: positionId });
    }
  }

  return rows;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run lib/__tests__/create-holding.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Rewrite the import route to use it**

Replace the loop at `app/api/portfolio/imports/route.ts:237-302` with a call. The `accepted` rows already carry everything the draft needs:

```ts
  // The rows themselves are built by the shared helper, which the manual-add
  // route also calls. What stays here is what is genuinely the IMPORT's: the
  // batch audit row above, and the rollback below.
  const { theses, tradePlans, positions, entries, watchState } = buildHoldingRows(
    accepted.map((row) => ({
      ticker: row.ticker,
      stockId: stockIdBySymbol.get(row.yahooSymbol!)!,
      quantity: row.quantity!,
      price: row.averagePrice!,
      date: row.date ?? input.as_of_date,
      note: input.rows[row.index]?.note?.trim(),
      entryNote: `Imported from ${input.source_filename}. Cost basis is a broker average; the date is approximate.`,
      assetClass: market === "CRYPTO" ? "crypto" : "equity",
    })),
    { portfolioId: input.portfolio_id, market, importBatchId: batch.id },
  );
```

Add the import at the top of the file, and delete the now-unused `ThesisInsert`/`TradePlanInsert`/etc. imports if `tsc` reports them unused.

- [ ] **Step 6: Verify nothing regressed**

```bash
npm test && npm run lint && npx tsc --noEmit
```

Expected: PASS. The existing import suite is the real check here — it exercised this logic before the move and must still pass **unchanged**. If a test needs editing, the extraction changed behaviour and is wrong.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add lib/portfolio/create-holding.ts lib/__tests__/create-holding.test.ts app/api/portfolio/imports/route.ts
/usr/bin/git commit -m "$(cat <<'EOF'
refactor(portfolio): extract the "holding from nothing" sequence

`positions.thesis_id` and `.trade_plan_id` are NOT NULL, so a holding the app
did not analyse still needs a thesis and a plan behind it. That five-insert
sequence had exactly one caller and lived inline in the import route; crypto's
manual add is the second, and a copy of it would drift the first time either
was touched.

Pure by design: it returns rows and writes nothing. The import needs a rollback
that deletes theses (the rest cascades) and a batch audit row, the manual add
needs neither, and pushing that difference inside would mean a function with
two modes.

It also gains the one crypto-shaped decision: a coin is never queued for the
weekly holding watch, because the watch's triggers are earnings and
fundamentals deltas and a coin has neither. Not queueing IS the scoping — what
is never queued is never drained.

The existing import suite passes unchanged, which is what makes this a move
rather than a rewrite.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `POST /api/holdings` — manual add

**Files:**
- Create: `app/api/holdings/route.ts`
- Test: `app/api/holdings/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `buildHoldingRows` (Task 6), `cryptoStockKey`/`getCryptoPrices` (Task 4), `requireVisibleBook` (`lib/portfolio/active.ts`).
- Produces: `POST /api/holdings` with body `{ portfolio_id, coingecko_id, quantity, price, date }` → `201 { position }`.

- [ ] **Step 1: Write the failing test**

Create `app/api/holdings/__tests__/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/crypto-data", () => ({
  getCryptoPrices: vi.fn(),
  cryptoStockKey: (id: string, cur: string) => `coingecko:${id}:${cur.toLowerCase()}`,
}));

import { currentUser } from "@/lib/auth/user";
import { getCryptoPrices } from "@/lib/crypto-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

const PF1 = "11111111-1111-4111-8111-111111111111";

let stockUpsert: Record<string, unknown> | null = null;
let inserted: Record<string, unknown[]> = {};

function mockClients(opts: { book?: { base_currency: string } | null; coin?: boolean } = {}) {
  const book = opts.book === undefined ? { base_currency: "INR" } : opts.book;
  const user = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "portfolios") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: book ? { id: PF1, ...book } : null, error: null }) }) }) };
      }
      if (table === "crypto_universe") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: opts.coin === false ? null : { coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin" }, error: null }) }) }) };
      }
      return { insert: async (rows: unknown[]) => { inserted[table] = rows as unknown[]; return { error: null }; },
               delete: () => ({ in: async () => ({ error: null }) }) };
    }),
  };
  const admin = {
    from: vi.fn().mockImplementation(() => ({
      upsert: (row: Record<string, unknown>) => { stockUpsert = row; return {
        select: () => ({ single: async () => ({ data: { id: "stock-1" }, error: null }) }) }; },
    })),
  };
  return { user, admin };
}

const post = (body: Record<string, unknown> = {}) =>
  new Request("http://test/api/holdings", {
    method: "POST",
    body: JSON.stringify({
      portfolio_id: PF1, coingecko_id: "bitcoin", quantity: 0.0043, price: 7515223, date: "2026-09-01", ...body,
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  stockUpsert = null;
  inserted = {};
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  const { user, admin } = mockClients();
  vi.mocked(createClient).mockResolvedValue(user as never);
  vi.mocked(createAdminClient).mockReturnValue(admin as never);
  vi.mocked(getCryptoPrices).mockResolvedValue(
    new Map([["bitcoin", { price: 7515223, asOf: new Date("2026-09-04T00:00:00Z") }]]) as never,
  );
});

describe("POST /api/holdings", () => {
  it("creates a position, a thesis and a plan for the coin", async () => {
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(inserted.positions).toHaveLength(1);
    expect(inserted.theses).toHaveLength(1);
    expect(inserted.trade_plans).toHaveLength(1);
    expect(inserted.entries).toHaveLength(1);
  });

  it("prices the coin in the BOOK's currency, asking the trader nothing", async () => {
    await POST(post());
    expect(getCryptoPrices).toHaveBeenCalledWith(["bitcoin"], "INR");
    expect(stockUpsert).toMatchObject({
      yahoo_symbol: "coingecko:bitcoin:inr",
      coingecko_id: "bitcoin",
      asset_class: "crypto",
      exchange: "CRYPTO",
      currency: "INR",
    });
  });

  it("never queues a coin for the weekly holding watch", async () => {
    await POST(post());
    expect(inserted.holding_watch_state ?? []).toHaveLength(0);
  });

  it("refuses a book this trader cannot see", async () => {
    const { user, admin } = mockClients({ book: null });
    vi.mocked(createClient).mockResolvedValue(user as never);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    expect((await POST(post())).status).toBe(404);
  });

  it("refuses a coin outside the tracked universe", async () => {
    // Guards the failure this feature exists to stop: a free-text ticker
    // resolving to the wrong asset with no error.
    const { user, admin } = mockClients({ coin: false });
    vi.mocked(createClient).mockResolvedValue(user as never);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const res = await POST(post({ coingecko_id: "not-a-coin" }));
    expect(res.status).toBe(400);
  });

  it("refuses a non-positive quantity before writing anything", async () => {
    expect((await POST(post({ quantity: 0 }))).status).toBe(400);
    expect(inserted.positions).toBeUndefined();
  });

  it("accepts a ten-decimal quantity, which is why 0029 widened the column", async () => {
    const res = await POST(post({ quantity: 0.0000000001 }));
    expect(res.status).toBe(201);
    expect((inserted.entries[0] as { quantity: number }).quantity).toBe(0.0000000001);
  });

  it("401s when not signed in", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    expect((await POST(post())).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run app/api/holdings/__tests__/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/holdings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { cryptoStockKey, getCryptoPrices } from "@/lib/crypto-data";
import { buildHoldingRows } from "@/lib/portfolio/create-holding";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Adds ONE crypto holding by hand.
 *
 * The CSV import is the bulk path; this is the single-coin one, and without it
 * logging one BTC buy would mean writing a spreadsheet. Both build their rows
 * with `buildHoldingRows` so a holding is a holding however it arrived.
 *
 * Deliberately crypto-only. An equity added by hand would need a Yahoo
 * resolution step, an exchange choice and a duplicate check against the book —
 * all of which the import already does properly — and this route would become
 * a worse copy of it.
 */
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  portfolio_id: z.string().uuid("Choose which portfolio this holding belongs to."),
  coingecko_id: z.string().min(1),
  quantity: z.coerce.number().positive("Quantity must be more than zero."),
  price: z.coerce.number().positive("Price must be more than zero."),
  date: z.string().date(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const supabase = await createClient();

  // The book decides the currency, so it has to exist before anything else can
  // be decided. RLS hides another trader's row rather than erroring, so a
  // missing row is 404 — the same answer, and for the same reason.
  const { data: book, error: bookError } = await supabase
    .from("portfolios")
    .select("id, base_currency")
    .eq("id", input.portfolio_id)
    .maybeSingle();
  if (bookError) return NextResponse.json({ error: bookError.message }, { status: 500 });
  if (!book) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  // Only coins in the tracked universe. This is the check that stops the defect
  // the whole feature exists to remove: a free-text ticker like "BTC" resolving
  // to a US-listed Bitcoin trust — the wrong asset, with no error.
  const { data: coin, error: coinError } = await supabase
    .from("crypto_universe")
    .select("coingecko_id, symbol, name")
    .eq("coingecko_id", input.coingecko_id)
    .maybeSingle();
  if (coinError) return NextResponse.json({ error: coinError.message }, { status: 500 });
  if (!coin) {
    return NextResponse.json(
      { error: "That coin is not one of the tracked top ten." },
      { status: 400 },
    );
  }

  const currency = book.base_currency;

  // Best-effort: a holding is worth recording even if CoinGecko is down. A null
  // `last_price` renders as "Price unavailable" and the next poll fills it in.
  let lastPrice: number | null = null;
  let lastPriceAt: string | null = null;
  try {
    const quote = (await getCryptoPrices([coin.coingecko_id], currency)).get(coin.coingecko_id);
    if (quote) {
      lastPrice = quote.price;
      lastPriceAt = quote.asOf.toISOString();
    }
  } catch {
    // Deliberately swallowed — see above.
  }

  // Shared market data: `authenticated` reads it, service-role maintains it
  // (0014). Upsert on the same unique `yahoo_symbol` index the import uses.
  const { data: stock, error: stockError } = await createAdminClient()
    .from("stocks")
    .upsert(
      {
        ticker: coin.symbol,
        yahoo_symbol: cryptoStockKey(coin.coingecko_id, currency),
        coingecko_id: coin.coingecko_id,
        asset_class: "crypto",
        exchange: "CRYPTO",
        currency,
        last_price: lastPrice,
        last_price_at: lastPriceAt,
      },
      { onConflict: "yahoo_symbol" },
    )
    .select("id")
    .single();
  if (stockError || !stock) {
    return NextResponse.json(
      { error: stockError?.message ?? "Could not record that coin." },
      { status: 500 },
    );
  }

  const rows = buildHoldingRows(
    [{
      ticker: coin.symbol,
      stockId: stock.id,
      quantity: input.quantity,
      price: input.price,
      date: input.date,
      entryNote: "Added by hand.",
      assetClass: "crypto",
    }],
    { portfolioId: input.portfolio_id, market: "CRYPTO", importBatchId: null },
  );

  // Same order and same rollback as the import: everything cascades from
  // `theses`, so deleting them unwinds a half-written holding completely.
  const undo = async (message: string) => {
    await supabase.from("theses").delete().in("id", rows.theses.map((t) => t.id!));
    return NextResponse.json({ error: message }, { status: 500 });
  };

  for (const [table, payload] of [
    ["theses", rows.theses],
    ["trade_plans", rows.tradePlans],
    ["positions", rows.positions],
    ["entries", rows.entries],
  ] as const) {
    const { error } = await supabase.from(table).insert(payload as never);
    if (error) return undo(error.message);
  }

  return NextResponse.json({ position: rows.positions[0] }, { status: 201 });
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run app/api/holdings/__tests__/route.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/api/holdings
/usr/bin/git commit -m "$(cat <<'EOF'
feat(crypto): add a single coin by hand

The CSV import is the bulk path; without this one, logging a single BTC buy
means writing a spreadsheet. Both build their rows with buildHoldingRows, so a
holding is a holding however it arrived.

Only coins in the tracked universe are accepted. That check is the point: a
free-text ticker is exactly how "BTC" resolves today to a US-listed Bitcoin
trust — the wrong asset, with no error.

Currency comes from the book's base_currency and the trader is asked nothing.
Pricing is best-effort: a holding is worth recording even when CoinGecko is
down, and a null last_price renders as "Price unavailable" until the next poll,
which is true where a zero would read as a total loss.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The import wizard's CRYPTO path

**Files:**
- Modify: `lib/portfolio/resolve.ts:30+` (`resolveImportRows`)
- Modify: `components/positions/import/import-wizard.tsx` (market buttons)
- Test: `app/api/portfolio/resolve/__tests__/route.test.ts` (extend)

**Interfaces:**
- Consumes: `crypto_universe`, `cryptoStockKey`, `getCryptoPrices`, `MARKETS.CRYPTO`.
- Produces: `resolveImportRows(..., market: "CRYPTO", ...)` resolving tickers against `crypto_universe` and returning rows whose `exchange` is `"CRYPTO"` and whose `currency` is the book's.

- [ ] **Step 1: Read the resolver before changing it**

```bash
sed -n '1,140p' lib/portfolio/resolve.ts
```

Note where it calls `exchangesFor(market)` and `getQuote`. The CRYPTO branch replaces both; everything else — duplicate detection, the repeated-ticker pass, the row shape — stays exactly as it is.

- [ ] **Step 2: Write the failing test**

Append to `app/api/portfolio/resolve/__tests__/route.test.ts`:

```ts
describe("POST /api/portfolio/resolve — crypto", () => {
  it("resolves a ticker against the universe, not against Yahoo", async () => {
    // The defect this replaces: resolveYahooSymbol("BTC","US") returns a real
    // quote for a US-listed Bitcoin trust. Wrong asset, no error.
    vi.mocked(createClient).mockResolvedValue(buildCryptoMock() as never);
    const res = await POST(cryptoPost({ rows: [row({ ticker: "BTC" })] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rows[0].status).toBe("resolved");
    expect(body.rows[0].exchange).toBe("CRYPTO");
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("prices it in the book's currency", async () => {
    vi.mocked(createClient).mockResolvedValue(buildCryptoMock() as never);
    const body = await (await POST(cryptoPost({ rows: [row({ ticker: "BTC" })] }))).json();
    expect(body.rows[0].currency).toBe("INR");
  });

  it("skips a ticker that is not a tracked coin", async () => {
    vi.mocked(createClient).mockResolvedValue(buildCryptoMock() as never);
    const body = await (await POST(cryptoPost({ rows: [row({ ticker: "NOTACOIN" })] }))).json();
    expect(body.rows[0].status).toBe("skipped");
    expect(body.rows[0].reason).toMatch(/top ten|not tracked/i);
  });
});
```

Add the helpers beside the existing ones in that file:

```ts
/** A mock whose `crypto_universe` knows BTC and nothing else. */
function buildCryptoMock() {
  const base = buildSupabaseMock([]);
  return {
    ...base,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "crypto_universe") {
        return { select: () => ({ in: async () => ({
          data: [{ coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin" }], error: null }) }) };
      }
      if (table === "portfolios") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: PF1, base_currency: "INR" }, error: null }) }) }) };
      }
      return base.from(table);
    }),
  };
}

const cryptoPost = (body: Record<string, unknown>) =>
  new Request("http://test/api/portfolio/resolve", {
    method: "POST",
    body: JSON.stringify({ portfolio_id: PF1, market: "CRYPTO", ...body }),
  }) as never;
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run app/api/portfolio/resolve/__tests__/route.test.ts
```

Expected: FAIL — CRYPTO rows resolve through the Yahoo path.

- [ ] **Step 4: Branch the resolver**

In `lib/portfolio/resolve.ts`, at the top of `resolveImportRows`, split before the per-row Yahoo loop:

```ts
  // Crypto resolves against `crypto_universe`, never against Yahoo. This is not
  // an optimisation: `resolveYahooSymbol("BTC", "US")` returns a real quote for
  // a US-listed Bitcoin TRUST, so the equity path does not fail on a coin — it
  // succeeds with the wrong asset, which is worse.
  if (market === "CRYPTO") {
    return resolveCryptoRows(supabase, rows, portfolioId, knownRepeats);
  }
```

Add the branch below, reusing the file's existing duplicate-detection helper so "you already hold this" behaves identically:

```ts
async function resolveCryptoRows(
  supabase: UserClient,
  rows: DraftImportRow[],
  portfolioId: string,
  knownRepeats: number[],
): Promise<ResolvedImportRow[]> {
  const { data: book } = await supabase
    .from("portfolios").select("base_currency").eq("id", portfolioId).maybeSingle();
  const currency = book?.base_currency ?? "USD";

  const symbols = [...new Set(rows.map((r) => r.ticker.trim().toUpperCase()))];
  const { data: coins } = await supabase
    .from("crypto_universe").select("coingecko_id, symbol, name").in("symbol", symbols);
  const coinBySymbol = new Map((coins ?? []).map((c) => [c.symbol, c]));

  const ids = [...new Set([...coinBySymbol.values()].map((c) => c.coingecko_id))];
  // One call prices every coin in the file: `/simple/price` is batched.
  const prices = await getCryptoPrices(ids, currency);
  const held = await tickersAlreadyHeld(supabase, portfolioId);

  const knownRepeatSet = new Set(knownRepeats);

  return rows.map((row): ResolvedImportRow => {
    const symbol = row.ticker.trim().toUpperCase();
    const coin = coinBySymbol.get(symbol);

    // The same skeleton the equity path spreads at the top of
    // `resolveImportRows`. `ResolvedImportRow` is `DraftImportRow` plus seven
    // fields (`lib/portfolio-import.ts:200-215`), and every one of them is
    // non-optional — `reason` is `string | null`, not `string | undefined`.
    const base = {
      ...row,
      status: "resolved" as const,
      reason: null,
      companyName: null,
      exchange: null,
      yahooSymbol: null,
      lastPrice: null,
      currency: null,
    };

    if (!coin) {
      return { ...base, status: "skipped", reason: `${symbol} is not one of the tracked top ten coins.` };
    }

    const quote = prices.get(coin.coingecko_id);
    const duplicate = held.has(symbol) || knownRepeatSet.has(row.index);
    return {
      ...base,
      ticker: symbol,
      companyName: coin.name,
      yahooSymbol: cryptoStockKey(coin.coingecko_id, currency),
      exchange: "CRYPTO",
      currency,
      lastPrice: quote?.price ?? null,
      status: duplicate ? "duplicate" : "resolved",
      reason: duplicate ? `You already hold ${symbol} in this portfolio.` : null,
    };
  });
}
```

> `tickersAlreadyHeld` is this file's existing helper at `lib/portfolio/resolve.ts:139` — call it, do not write a second one. Note there is **no** currency gate here: that check exists on the equity path because a bare US ticker can return a foreign listing, and CoinGecko is asked for a currency directly rather than guessing one.

- [ ] **Step 5: Add the wizard button**

`components/positions/import/import-wizard.tsx` renders `MARKET_ORDER.map(...)`. It now includes CRYPTO, which is `live: true`, so the button appears with no change. Verify the heading still reads sensibly and adjust the copy:

```tsx
                2 · Which market is this portfolio?
```

becomes

```tsx
                2 · Which market is this?
```

- [ ] **Step 6: Run tests**

```bash
npm test && npm run lint && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add lib/portfolio/resolve.ts app/api/portfolio/resolve/__tests__/route.test.ts components/positions/import/import-wizard.tsx
/usr/bin/git commit -m "$(cat <<'EOF'
feat(crypto): import coins from a CSV

Crypto resolves against crypto_universe, never against Yahoo. That is not an
optimisation. resolveYahooSymbol("BTC","US") returns a real quote for a
US-listed Bitcoin trust, so the equity path does not FAIL on a coin — it
succeeds with the wrong asset, and persists it as exchange 'US', which then
drives market-hours polling and the display timezone.

Duplicate detection, the repeated-ticker pass and the row shape are untouched:
a coin already held in this book flags exactly like a share already held.

One call prices the whole file, because /simple/price is batched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: CoinGecko attribution

A term of use with a legal edge, not polish. A missing attribution is a failed acceptance criterion.

**Files:**
- Create: `components/shared/coingecko-attribution.tsx`
- Modify: `components/cockpit/cockpit-client.tsx`, `components/positions/positions-table.tsx`, `app/(app)/positions/[id]/page.tsx`

> **No unit test for this one.** This repo has no component-test setup — every
> test lives in `lib/__tests__` or `app/api/**/__tests__` and none render JSX.
> Standing up React Testing Library to assert one `<a>` is not worth it, so the
> check is the grep in Step 4 plus the browser pass. Said out loud because an
> untested legal requirement should be a decision, not an oversight.

- [ ] **Step 1: Write the component**

Create `components/shared/coingecko-attribution.tsx`:

```tsx
/**
 * CoinGecko's required attribution.
 *
 * MANDATORY, not decorative. Their attribution guide requires visible,
 * hyperlinked credit placed "close to where the data is displayed, i.e. above
 * or below the data set" — so this goes next to prices, never in a footer and
 * never on an About page.
 *
 * One component so the wording cannot drift between the four surfaces that
 * render a coin price. The text is one of their approved phrasings verbatim;
 * do not reword it.
 *
 * Renders nothing when no crypto is on screen: attribution for data that is
 * not shown is noise, and noise is what gets deleted later by someone who
 * assumes it is decorative.
 */
export function CoinGeckoAttribution({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <p className="text-[10px] text-on-surface-variant/60">
      Price data by{" "}
      <a
        href="https://www.coingecko.com"
        target="_blank"
        rel="noreferrer noopener"
        className="underline transition-colors hover:text-on-surface-variant"
      >
        CoinGecko
      </a>
    </p>
  );
}
```

- [ ] **Step 2: Render it wherever a coin price appears**

Each call site passes `show` so it appears only when crypto is actually on screen:

- `components/positions/positions-table.tsx` — directly beneath the `<table>`:
  ```tsx
  <CoinGeckoAttribution show={rows.some((r) => r.stock?.asset_class === "crypto")} />
  ```
  This requires `asset_class` on `PositionRow["stock"]`; add it to that type and to the `select` in `lib/queries.ts:listOpenPositions`.

- `components/cockpit/cockpit-client.tsx` — beneath the totals block, using the same predicate over its own rows.

- `app/(app)/positions/[id]/page.tsx` — beneath the price block, `show={stock.asset_class === "crypto"}`.

- [ ] **Step 3: Verify by eye**

```bash
npm run dev
```

Open `/positions?portfolio=<book with a coin>` and confirm the line renders directly under the table, and that it is **absent** on a book holding only equities.

- [ ] **Step 4: Assert the placement mechanically**

```bash
grep -rn "CoinGeckoAttribution" components app --include="*.tsx" | grep -v "coingecko-attribution.tsx"
```

Expected: three call sites — positions table, cockpit, position detail.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add components/shared/coingecko-attribution.tsx components/positions/positions-table.tsx components/cockpit/cockpit-client.tsx "app/(app)/positions/[id]/page.tsx" lib/queries.ts
/usr/bin/git commit -m "$(cat <<'EOF'
feat(crypto): CoinGecko attribution wherever a coin price shows

Required by their attribution guide, which asks for visible hyperlinked credit
"close to where the data is displayed, i.e. above or below the data set". So it
sits under the prices, not in a footer and not on an About page.

One component, because four copies of a required sentence is four chances for
one of them to be reworded into non-compliance. The phrasing is theirs
verbatim.

Hidden when no crypto is on screen: attribution for data that is not displayed
is noise, and noise is what someone deletes later assuming it was decorative.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Poll crypto prices around the clock

**Files:**
- Modify: `supabase/functions/poll-prices/index.ts:116` (`type Market`), `:258-275` (the whitelist and gate), and the pricing loop
- Modify: `supabase/migrations/0003_pg_cron_jobs.sql.example`

**Interfaces:**
- Consumes: the `stocks.asset_class` / `coingecko_id` columns from Task 2.
- Produces: `GET /functions/v1/poll-prices?market=CRYPTO` pricing every crypto row and firing the existing alert triggers.

> **Deno cannot import from `/lib`.** This function reimplements `withRetry` for that reason (see the note at `lib/market-data.ts:95-104`), and it must now reimplement `cryptoStockKey`'s inverse too — reading `coingecko_id` and `currency` straight off the `stocks` row rather than parsing the synthetic key. Do not parse the key; the columns are there.

- [ ] **Step 1: Read the existing shape**

```bash
sed -n '110,125p' supabase/functions/poll-prices/index.ts
sed -n '255,300p' supabase/functions/poll-prices/index.ts
```

- [ ] **Step 2: Widen the market type and the gate**

```ts
type Market = "NSE" | "US" | "CRYPTO";
```

Replace the whitelist and the `isMarketOpen` gate:

```ts
  if (marketParam !== "NSE" && marketParam !== "US" && marketParam !== "CRYPTO") {
    return jsonResponse({ error: 'market query param must be "NSE", "US" or "CRYPTO"' }, 400);
  }
  const market: Market = marketParam;

  // Crypto has no session, so asking whether the market is open is not a check
  // that passes — it is the wrong question. `isMarketOpen` knows two equity
  // sessions and would answer "closed" all weekend for an asset that trades
  // straight through it, which is exactly when a stop is most likely to breach
  // unwatched.
  if (market !== "CRYPTO" && !isMarketOpen(market, new Date())) {
    return jsonResponse({ skipped: true, reason: "market closed" }, 200);
  }
```

- [ ] **Step 3: Branch the price fetch**

Where the function selects stocks by exchange, select crypto rows by asset class instead, and price them in one batched call per currency:

```ts
  if (market === "CRYPTO") {
    const { data: cryptoStocks, error } = await supabase
      .from("stocks")
      .select("id, ticker, coingecko_id, currency")
      .eq("asset_class", "crypto");
    if (error) return jsonResponse({ error: error.message }, 500);

    // Grouped by currency because `/simple/price` takes one `vs_currencies` per
    // call and returns that currency's price for every id in the batch. Two
    // books in two currencies is two calls, not two calls per coin.
    const byCurrency = new Map<string, typeof cryptoStocks>();
    for (const s of cryptoStocks ?? []) {
      if (!s.coingecko_id) continue;
      const list = byCurrency.get(s.currency) ?? [];
      list.push(s);
      byCurrency.set(s.currency, list);
    }

    for (const [currency, group] of byCurrency) {
      const ids = [...new Set(group.map((s) => s.coingecko_id!))];
      const params = new URLSearchParams({
        ids: ids.join(","),
        vs_currencies: currency.toLowerCase(),
        include_last_updated_at: "true",
      });
      const res = await withRetry(() =>
        fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`, {
          headers: { "x-cg-demo-api-key": Deno.env.get("COINGECKO_API_KEY") ?? "" },
        }),
      );
      if (!res.ok) {
        console.error(`poll-prices: CoinGecko returned ${res.status} for ${currency}`);
        continue;
      }
      const body = await res.json();
      for (const stock of group) {
        const quoted = body[stock.coingecko_id!]?.[currency.toLowerCase()];
        if (typeof quoted !== "number") continue;
        await supabase
          .from("stocks")
          .update({ last_price: quoted, last_price_at: new Date().toISOString() })
          .eq("id", stock.id);
      }
    }
  }
```

The stop / target / time-exit evaluation below is **unchanged**. It reads `last_price` off the position's stock and does not care what wrote it.

- [ ] **Step 4: Set the function's secret and deploy**

```bash
supabase secrets set COINGECKO_API_KEY=<the key from .env.local>
supabase functions deploy poll-prices
```

> Read the value out of `.env.local`; do not paste it into a commit, a comment, or a shell history entry that gets committed.

- [ ] **Step 5: Exercise it against the deployed function**

```bash
set -a; . ./.env.local; set +a
curl -s "https://<PROJECT_REF>.supabase.co/functions/v1/poll-prices?market=CRYPTO" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" | head -20
```

Expected: a JSON summary, **not** `{"skipped":true,"reason":"market closed"}` — that response would mean the `isMarketOpen` bypass did not take. Then confirm prices moved:

```bash
/opt/homebrew/bin/node --env-file=.env.local -e '
import("pg").then(async ({default: pg}) => {
  const c = new pg.Client({connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
  await c.connect();
  const {rows} = await c.query("select ticker, currency, last_price, last_price_at from stocks where asset_class=\x27crypto\x27 order by ticker");
  for (const r of rows) console.log(`  ${r.ticker} ${r.currency} ${r.last_price} @ ${r.last_price_at}`);
  await c.end();
});'
```

- [ ] **Step 6: Add the cron entry**

Append to `supabase/migrations/0003_pg_cron_jobs.sql.example`:

```sql
-- - poll-prices-crypto: hourly, ALL SEVEN DAYS. Crypto has no session, so
--   unlike the two equity jobs this one has no window to widen and no
--   `isMarketOpen` behind it -- the function bypasses that check for CRYPTO
--   rather than consulting it.
--
--   This is the whole point. The PRD originally proposed pricing crypto only
--   when poll-prices was already awake for NSE or US hours, and said plainly
--   what that would cost: "a crypto stop or target that breaches over a
--   weekend is not detected until Monday." Hourly, seven days, means it is
--   detected. ~168 invocations a week at 1-2 CoinGecko calls each is roughly
--   7-15% of the Demo tier's 10,000 monthly credits.
select cron.schedule(
  'poll-prices-crypto',
  '0 * * * *',
  $$
  select net.http_get(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/poll-prices?market=CRYPTO',
    headers:= jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    )
  );
  $$
);
```

Match the neighbouring entries' exact `net.http_*` call shape and Vault secret name — read them rather than trusting the sketch above.

- [ ] **Step 7: Full verification and commit**

```bash
npm test && npm run lint && npx tsc --noEmit && npm run build
```

```bash
/usr/bin/git add supabase/functions/poll-prices/index.ts supabase/migrations/0003_pg_cron_jobs.sql.example
/usr/bin/git commit -m "$(cat <<'EOF'
feat(crypto): price coins hourly, seven days a week

Crypto has no session, so the CRYPTO branch BYPASSES isMarketOpen rather than
consulting it. Asking that question of a coin is not a check that passes — it
is the wrong question, and it answers "closed" all weekend for an asset that
trades straight through it.

That matters most exactly when it is worst: the PRD's original proposal was to
price crypto only when poll-prices was already awake for equity hours, and it
said plainly what that cost — "a crypto stop or target that breaches over a
weekend is not detected until Monday." Now it is detected.

The weekend assumption lived in three places — the cron expression, the edge
isMarketOpen, and the market query-param whitelist — and a fix to fewer than
three is not a fix. All three are handled here.

Prices are grouped by currency because /simple/price takes one vs_currencies
per call: two books in two currencies is two calls, not two per coin. The
stop/target/time-exit logic below is untouched; it reads last_price and does
not care what wrote it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `npm test` — expect **609 + ~40 new** tests, all passing
- [ ] `npm run lint` — clean
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run build` — succeeds
- [ ] **End to end in a browser**, which no part of this feature has had yet:
  1. Import a CSV with `BTC` and `ETH` into an INR book. Confirm both resolve, price in **rupees**, and the CoinGecko attribution appears under the table.
  2. Add `SOL` by hand into the same book. Confirm it lands beside the imported two.
  3. Add `BTC` to a **USD** book. Confirm a second `stocks` row exists (`coingecko:bitcoin:usd`), that its price is in dollars, and that the cockpit's `all` view shows an INR bucket and a USD bucket rather than one blended number.
  4. Re-import the same CSV. Confirm both coins flag as duplicates.
  5. Confirm a coin does **not** appear in the thesis market picker.
  6. Confirm `holding_watch_state` has no row for any crypto position:
     ```sql
     select count(*) from holding_watch_state w
       join positions p on p.id = w.position_id
       join stocks s on s.id = p.stock_id
      where s.asset_class = 'crypto';
     ```
     Expected: `0`.
- [ ] Add `COINGECKO_API_KEY` to **Vercel's environment variables** — `.env.local` is never uploaded, so the deployed build has no key without this.
- [ ] Open a PR and let CodeRabbit and Codex review it.

---

## Deferred, deliberately

- **Phase 4** — the Council and pattern-read asset-class prompt work. It wants a real mixed dataset to judge output against, and that dataset exists only after this ships and gets used.
- **`daily-digest` per-book grouping** (`supabase/functions/daily-digest/index.ts:96-157`) — groups alerts by `user_id`, so an email cannot say which book an alert came from. Pre-existing, made more visible by portfolios, not caused by crypto.
- **Coins outside the top ten**, FX conversion, and crypto in Discovery or the thesis flow.
