# PRD: Multiple Portfolios, Crypto Holdings & Named Theses

**Status:** Draft for review
**Author:** Drafted with Claude, from a conversation with Harsh
**Last updated:** 2026-09-04
**Related code:** `app/(app)/dashboard/page.tsx`, `app/api/cockpit/route.ts`, `components/layout/app-header.tsx`, `components/layout/nav-items.ts`, `components/thesis/thesis-list.tsx`, `components/feed/thesis-preview-drawer.tsx`, `components/feed/add-signal-modal.tsx`, `lib/markets.ts`, `lib/market-data.ts`, `lib/market-hours.ts`, `lib/jarvis-thesis-prompt.ts`, `lib/jarvis-thesis-parser.ts`, `lib/jarvis-portfolio-council.ts`, `lib/jarvis-scratchpad.ts`, `lib/portfolio-import.ts`, `supabase/functions/poll-prices/index.ts`, `supabase/migrations/0006_thesis_cockpit_schema.sql`, `supabase/migrations/0013_user_accounts.sql`, `supabase/migrations/0016_thesis_markets.sql`, `supabase/migrations/0020_portfolio_import.sql`, `supabase/migrations/0021_stock_currency.sql`, `supabase/migrations/0023_portfolio_council.sql`, `supabase/migrations/0025_portfolio_scratchpad.sql`

---

## Problem Statement

Four gaps, shipped together because three of them touch the same screen and the same reads.

**1. One user is one book, structurally.** Since 0013 every table is scoped to `user_id` and nothing finer. A trader who runs more than one book — his own and his mother's — has no way to say so. `GET /api/cockpit` selects *every* open position and sums them. `portfolio_profiles` is `user_id primary key`, so there is exactly one "what am I trying to do with this money" per human being. The portfolio Council (0023) reads one blended `holdings_snapshot`, and the Scratchpad's pattern read (0025) reads one blended book. That blending is not merely untidy — it is *wrong output*. A retirement book run for someone else and a personal high-conviction book have different objectives, different tolerance for concentration and different correct answers to "should I trim this." Averaged together, the Council's verdict is wrong for both.

**2. Crypto is unrepresentable.** `market_code` is `('US','IN','CN','EU','EM')`, `exchange_code` is `('NSE','BSE','US')`, `resolveYahooSymbol` builds exactly `.NS` / `.BO` / bare, and `isMarketOpen` knows two sessions. A coin has no exchange in that sense, no earnings calendar, no sector, and never closes. A real Indian book in 2026 frequently holds BTC or ETH next to HAL, and today that book cannot be imported completely — the crypto rows are skipped and the cockpit total silently understates the portfolio.

**3. The cockpit header carries a product name, not information.** `app/(app)/dashboard/page.tsx` renders `<h1>Velocity Cockpit</h1>`. It was fine when there was one book. The moment there are five, the single most valuable string on that screen is *which book am I looking at*.

**4. A thesis has no name.** `theses` has no title column. Three separate surfaces — `components/thesis/thesis-list.tsx`, `components/feed/thesis-preview-drawer.tsx`, `components/feed/add-signal-modal.tsx` — all render the same fallback, `t.ticker ?? "Macro Thesis"`. Every `thesis_only` and macro thesis is therefore called "Macro Thesis," and a list of six of them is a list of six identical rows. The thesis's actual content (`input_text`, `market_view`, `catalyst`) is sitting right there and is never used to distinguish them.

## Goals

1. Let one trader keep up to five separate books, each with its own objective, its own Council verdict and its own pattern read — with a hard structural guarantee that one book's holdings never appear in another's totals.
2. Make the owned/managed distinction mean something beyond a badge: it changes how Jarvis frames advice, and it keeps someone else's money out of the trader's own net-worth number.
3. Let a book contain crypto and be *complete* — priced, totalled, alerted on, and visible to the portfolio Council — without pretending a coin has fundamentals it does not have.
4. Make every thesis identifiable at a glance from a list, with no extra model calls and no manual naming step required.
5. Reuse the app's existing discipline: per-user RLS with `default auth.uid()`, Zod-validated fenced JSON, the `llm_usage` ledger, and the existing `theses → trade_plans → positions → entries` chain rather than parallel structures.

## Non-Goals (v1)

- **No sharing, no multi-user access.** A "managed" portfolio is a book *this* trader manages; the beneficiary has no login, no invite, no read-only link. Every row still belongs to exactly one `auth.users` id, and RLS is unchanged in shape.
- **No per-portfolio tax, fee or realised-gain reporting.** Managing someone's money properly implies statements and capital-gains reporting; none of that is here.
- **No crypto memorandum, shortlist or stress test.** Crypto is a holdings-and-oversight asset class in v1 (see Decisions). There is no `thesis_only` run "across the top 10 coins."
- **No DeFi, staking, LP positions, NFTs, or wallet-address sync.** Spot holdings of listed top-10 coins, entered manually or by CSV, and nothing else.
- ~~**No 24/7 crypto polling.** Deliberately deferred — see Decisions and Open Questions; this is the one decision in this PRD with a known, accepted cost.~~ **SUPERSEDED in build (Phase 3).** Crypto is polled hourly, all seven days, on its own `poll-prices-crypto` cron entry. Writing the acceptance down is what made it obvious it should not be accepted: the cost was a weekend stop breach going unseen, and the fix was one cron entry.
- **No renaming of the *stress test* as a separate object.** A thesis and its memorandum are one thing to the trader; naming the thesis names the stress test. There is no second title field on `thesis_memorandums`.
- **No portfolio archiving or deletion flows beyond a plain delete.** Five is a small enough number that lifecycle management can wait.

## Decisions Already Made

From two rounds of clarifying questions before drafting. These shape everything below.

| Question | Decision |
|---|---|
| What does a portfolio partition? | **Holdings plus portfolio-level artifacts.** `positions` (and everything hanging off them), `portfolio_profiles`, `portfolio_council_reports`, `scratchpad_notes`, `portfolio_pattern_reads`, `portfolio_imports` all scope to a portfolio. **Theses and the research pipeline stay shared** — one thesis can back holdings in two books. |
| Consolidated view? | **Yes — a switcher plus an "All portfolios" option.** |
| What does owned-vs-managed actually do? | **Three things:** a badge and beneficiary name; a different framing and disclaimer in every Jarvis call that reads the book; and **exclusion from the aggregate P&L** so the trader's own net-worth number stays clean. |
| How deep does crypto go? | **Holdings plus Council.** Held, imported, priced, totalled, given an exit plan, watched on price, and visible to the portfolio Council and pattern read as an asset class. **No memorandum, no shortlist, no fundamentals-based holding review.** |
| Crypto data source? | **CoinGecko for both ranking and pricing.** A second price path alongside Yahoo, branched on asset class. |
| Crypto polling cadence? | ~~Poll inside the existing `poll-prices` windows only.~~ **Changed in build: hourly, all seven days, on its own cron entry.** `isMarketOpen` is BYPASSED for crypto rather than consulted — "is the market open" is not a check that passes for a coin, it is the wrong question. ~730 invocations a month, roughly 7-15% of CoinGecko's Demo tier. |
| How does a thesis get a name? | **Auto-titled at creation, renameable forever.** The title comes out of the *existing* thesis parse — a new field on the Zod schema, zero additional model calls — and inline rename overrides it permanently. |
| Which book does an action land in? | **Always an explicit picker.** Logging an entry or converting a recommendation requires choosing the portfolio every time. No silent default, even when only one book exists. |

## Architecture

### Part 1 — Portfolios

**One new table, five new columns, one primary-key change.**

```
create type portfolio_ownership as enum ('owned', 'managed');

create table portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  name text not null check (length(trim(name)) between 1 and 60),
  ownership portfolio_ownership not null default 'owned',
  -- Free text, and only meaningful when ownership = 'managed'. "Mom".
  beneficiary_name text,
  -- Base currency for THIS book's headline number. The cockpit still splits
  -- totals by currency (0021); this is the label, not a conversion.
  base_currency text not null default 'INR',
  is_default boolean not null default false,
  archived_at timestamptz
);
```

`portfolio_id` (`not null references portfolios(id) on delete restrict`) is added to: **`positions`**, **`portfolio_imports`**, **`portfolio_council_reports`**, **`scratchpad_notes`**, and **`portfolio_pattern_reads`**. `portfolio_profiles` has its primary key moved from `user_id` to `portfolio_id` — the objective is a property of a book, not a person.

**`on delete restrict`, not cascade.** Deleting a portfolio must never silently take a trader's position history with it. Deleting a non-empty portfolio is refused, with a message naming how many positions block it.

**What deliberately does NOT get a `portfolio_id`:**

- `entries`, `exits` — they hang off `position_id`, and a position's portfolio is the answer.
- `theses`, `trade_plans`, `jarvis_recommendations`, `thesis_memorandums`, `thesis_candidates` — the research layer is shared by decision. A thesis is an argument about the world; it is not owned by a book.
- `holding_reviews` — derived through `position_id`. Adding a redundant column invites the two to disagree.

**One nuance this creates, worth stating before code review finds it:** a shared thesis has *one* `trade_plans` row, so if the same Jarvis thesis backs a position in two books, both read the same stop and targets. That is correct for a Jarvis-originated thesis — the plan *is* the analysis, and it does not change based on whose money bought it. It is a non-issue for imported holdings, which each get their own synthetic thesis and therefore their own trade plan at import time (0020). Where it *would* bite is per-book position sizing; `trade_plans.position_size_pct` is a percentage, so it already means the right thing in each book.

**The cap of five.** A `check` constraint cannot count sibling rows, so the limit is a `before insert` trigger on `portfolios` that counts the user's non-archived portfolios against a single `MAX_PORTFOLIOS` constant, mirrored in `lib/portfolio/limits.ts` for a friendly client-side message. Raising the cap later is a one-line change in two places, which is the flexibility asked for.

**Active-portfolio selection is explicit, never ambient.** A `PortfolioProvider` client context (modelled on `components/layout/new-thesis-context.tsx`) holds the selection, persisted to `localStorage` and defaulting to `is_default`. **Every** API read takes an explicit `?portfolio=<uuid>` parameter, with the literal `?portfolio=all` for the roll-up. No cookie, no server-side "current portfolio" state. The reason is blunt: a mis-scoped read here shows one person's money as another's, and an ambient default is exactly how that ships unnoticed.

**`GET /api/cockpit` becomes portfolio-aware.** Its opening `positions` select gains `.eq("portfolio_id", …)`, or for `all`, `.in("portfolio_id", ownedPortfolioIds)`. The `all` case returns a `byPortfolio[]` breakdown alongside the existing `totalsByCurrency`, and the headline totals **sum only `ownership = 'owned'` books**. Managed books render beneath as separate labelled cards with their own totals, never folded into the top number.

**Owned vs managed changes what Jarvis is told.** `lib/jarvis-portfolio-council.ts` and `lib/jarvis-scratchpad.ts` both build a prompt from the holdings snapshot and `portfolio_profiles.objective`. Both gain a framing block: for a managed book, the panel is told it is reviewing capital held on behalf of a named beneficiary, and the rendered output carries a distinct fiduciary disclaimer rather than the personal-appetite one. This is a prompt and copy change, not new plumbing.

**Migration and backfill, in one migration:** create `portfolios`; insert one row per existing user (`name = 'My Portfolio'`, `ownership = 'owned'`, `is_default = true`); add each `portfolio_id` column nullable; backfill from that default row; then `set not null`. `portfolio_profiles` is rebuilt with the new PK, carrying each user's existing objective onto their default portfolio. Every existing holding lands in a book called "My Portfolio" and nothing the trader has today disappears or changes shape.

### Part 2 — Crypto

**Asset class is a property of the instrument, not the market.**

```
create type asset_class as enum ('equity', 'crypto');
alter table stocks add column asset_class asset_class not null default 'equity';
alter table stocks add column coingecko_id text;           -- 'bitcoin', 'ethereum'
create unique index on stocks (coingecko_id) where coingecko_id is not null;
```

`market_code` gains `'CRYPTO'` and `lib/markets.ts` gains a matching entry with `live: true`, `exchanges: []`, and — importantly — a flag that excludes it from the thesis market picker, since crypto is holdings-only in v1. Reusing `market_code` rather than inventing a parallel axis keeps `portfolio_imports.market` and every existing per-market query working untouched.

**The top ten, refreshed rather than hardcoded.**

```
create table crypto_universe (
  coingecko_id text primary key,
  symbol text not null,          -- BTC
  name text not null,            -- Bitcoin
  market_cap_rank int not null,
  refreshed_at timestamptz not null default now()
);
```

Populated from CoinGecko's `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10`, refreshed on a slow cadence (weekly is ample; market-cap rank does not churn). This is a **shared reference table** like `stocks` — not per-user, select-only for `authenticated`, written by the service-role client. A holding whose coin drops out of the top ten is **never** dropped from the book; the universe governs what can be *added*, not what can be *held*.

**Pricing.** A second path in `lib/market-data.ts`, branched on `stocks.asset_class`, calling `/simple/price?ids=…&vs_currencies=…`. Two properties make this cheap: the endpoint is batched (one request prices every crypto holding in the book), and it takes `vs_currency` natively — so a coin bought in rupees on an Indian exchange prices in **INR** and a coin bought in dollars prices in **USD**, and the existing `totalsByCurrency` split (0021) does the rest with no conversion logic. `resolveYahooSymbol` is never called for a crypto row. CoinGecko's free tier needs no key but is rate-limited; the demo API key should be configured in `.env.local` regardless, and the same `withRetry` backoff already used for Yahoo applies.

**Two numeric-precision problems that will otherwise surface as silent data loss:**

- `entries.quantity` / `exits.quantity` are `numeric(18,6)`. Six decimals cannot hold a satoshi-level BTC quantity. Widen to `numeric(28,10)`.
- `entries.price`, `exits.price`, and every `trade_plans` level are `numeric(14,4)`. Four decimals round a sub-cent coin to `0.0000` and then the `check (price > 0)` rejects the row outright. Widen the price columns to `numeric(20,10)`.

Both are plain `alter column type` widenings — no data loss, no rewrite risk at this table size, and both are strictly safer for equities too.

**Market hours.** ~~`isMarketOpen` gains no crypto session in v1.~~ **As built:** crypto bypasses `isMarketOpen` entirely and runs on `poll-prices-crypto`, hourly, seven days a week. A weekend stop breach IS detected. The staleness half of this paragraph was built as written: the cockpit stamp is split by asset class and coins carry a per-row "as of", because coins are polled hourly and equities are not polled at all outside a session — so one combined stamp would present a Friday-evening equity price as minutes old right through the weekend.

**What crypto is excluded from, and why:** the recurring `holding_reviews` watch (0022) is scoped by `asset_class = 'equity'` — its two triggers are `earnings_calendar` and `fundamentals_delta`, neither of which exists for a coin, and running it anyway would spend a model call to report "no earnings date found" forever. Crypto is likewise absent from the thesis market picker and from Discovery's shortlist.

**What crypto is included in:** the cockpit and all totals; alerts on stop/target/time-exit via the unchanged `poll-prices` trigger logic; the imported-holding **Exit Plan Builder** (which by its own PRD already uses a simpler geometry check and does not depend on fundamentals); the **portfolio Council**, whose prompt gains an asset-class breakdown so a member can say "31% of this book is one volatile asset class" — the single most useful thing a Council can say about a book holding crypto; and the **pattern read**, where asset-class mix is part of the trader's taste.

### Part 3 — Cockpit header

`<h1>Velocity Cockpit</h1>` becomes the portfolio's name, with the switcher attached to it and the ownership badge beside it. In `all` mode the title reads "All portfolios" with a count. `components/layout/nav-items.ts` maps `/dashboard` to the label "Cockpit" for the header and rail; that stays — the product's name for the *screen* is unchanged, and the `<h1>` stops duplicating it and starts carrying data instead. The switcher itself belongs in the header rather than the sidebar, because it applies to the cockpit, positions, scratchpad and Council alike.

### Part 4 — Named theses

```
alter table theses add column title text check (title is null or length(trim(title)) between 1 and 80);
alter table theses add column title_edited boolean not null default false;
```

**The title costs nothing.** `lib/jarvis-thesis-prompt.ts` already asks for structured JSON and `lib/jarvis-thesis-parser.ts` already Zod-validates it. Adding a `title` field to that schema — "a specific 3-7 word name for this thesis; never a generic label" — produces a name on the same call that produces `market_view` and `catalyst`. No new model call, no new `llm_feature` enum value, no new spend line.

**`title_edited` is the point of the second column.** A trader who renames a thesis has said something the model should not overwrite. Any re-run or re-parse skips the title when `title_edited` is true.

**Rename** is a `PATCH /api/theses/[id]` accepting `{ title }` and setting `title_edited = true`, surfaced as inline edit-in-place on `/thesis/[id]` and in the thesis list.

**The fallback chain** becomes `title ?? ticker ?? "Untitled thesis"`, applied at all three current call sites. Note the changed last resort: "Untitled thesis" is honest about a missing name, where "Macro Thesis" was a *category* masquerading as one — and a genuinely macro thesis will now carry a real auto-generated name anyway. Existing rows are backfilled to `ticker` where they have one and left null otherwise; a one-off backfill script may re-parse existing `input_text` for titles, but that is P1, not a migration.

## User Stories

| # | As a trader, I want to… | So that… |
|---|---|---|
| US-1 | create up to five named portfolios and mark each as owned or managed | my book and my mother's book are never confused for one another |
| US-2 | switch which portfolio the cockpit, positions, Scratchpad and Council are showing | I can review one book at a time, properly |
| US-3 | see an "All portfolios" roll-up | I know my total exposure at a glance |
| US-4 | have managed books excluded from that headline total | my own net-worth number means what it says |
| US-5 | give each portfolio its own objective | the Council's advice is measured against the right goal |
| US-6 | have the Council treat a managed book as a fiduciary responsibility | the advice on someone else's money is framed as advice on someone else's money |
| US-7 | hold and import crypto alongside equities | the cockpit total is my actual portfolio, not the part of it that has a ticker |
| US-8 | pick coins from the current top ten by market cap | I am not typing free-text symbols and mis-pricing a scam coin |
| US-9 | set stops and targets on a crypto holding and be alerted | crypto is under the same exit discipline as everything else |
| US-10 | see which book I am looking at in the cockpit header | I never act on the wrong portfolio |
| US-11 | see every thesis under a distinct, meaningful name | a list of theses is a list of ideas, not six rows saying "Macro Thesis" |
| US-12 | rename any thesis, permanently | my name for an idea wins over the model's |
| US-13 | be asked which portfolio an entry belongs to, every time | a share is never filed against the wrong person's money |

## Requirements

### Must-Have (P0)

**Portfolios**

1. Create, rename, and set the ownership of a portfolio, up to five non-archived books, enforced by a DB trigger *and* the client.
2. A default portfolio exists for every user; the migration creates "My Portfolio" and moves all existing holdings into it, losing nothing.
3. `portfolio_id not null` with `on delete restrict` on `positions`, `portfolio_imports`, `portfolio_council_reports`, `scratchpad_notes`, `portfolio_pattern_reads`; `portfolio_profiles` re-keyed to `portfolio_id`.
4. Every read API takes an explicit `?portfolio=` parameter. A request without one is a 400, not a guess.
5. Header switcher with ownership badge; "All portfolios" mode; per-book breakdown in `all` mode.
6. Aggregate totals sum owned books only. Managed books are shown separately and clearly labelled.
7. Deleting a portfolio containing positions is refused with a message naming the count.
8. The portfolio Council and the pattern read run **per portfolio** and read only that book's holdings and objective.
9. Managed books get fiduciary framing in both prompts and a distinct on-screen disclaimer.
10. An explicit portfolio picker on every entry-logging and recommendation-conversion flow, with no pre-selected default.

**Crypto**

11. `asset_class` on `stocks`; `'CRYPTO'` in `market_code`; `crypto_universe` populated from CoinGecko and refreshed weekly.
12. Add a crypto holding by picking from the current top ten, with quantity, average cost and a currency of INR or USD.
13. CSV import accepts crypto rows in the same flow, resolved against `crypto_universe`.
14. Quantity columns widened to `numeric(28,10)`; price columns to `numeric(20,10)`.
15. CoinGecko pricing in the on-demand refresh and in `poll-prices`, batched, with the existing retry/backoff behaviour.
16. Crypto holdings appear in the cockpit, in `totalsByCurrency`, and in stop/target/time-exit alerts.
17. Crypto holdings are visible to the portfolio Council and the pattern read, with an asset-class exposure breakdown in both prompts.
18. Crypto is excluded from `holding_reviews`, the thesis market picker, and Discovery.
19. Crypto price staleness is displayed per-row, not inherited from the equity `LastUpdated` stamp.

**Naming**

20. `theses.title` and `title_edited`; title produced by the existing thesis parse at no extra model cost.
21. Inline rename wherever a thesis is displayed; rename sets `title_edited` and survives every re-run.
22. `title ?? ticker ?? "Untitled thesis"` at all three current fallback sites; existing rows backfilled to `ticker` where present.

### Nice-to-Have (P1)

- Per-portfolio colour or icon in the switcher, so the wrong-book mistake is catchable peripherally.
- A one-off backfill that re-parses `input_text` to title existing untitled theses.
- Move a position from one portfolio to another (mis-filed at entry) — an audited `portfolio_id` update, not a delete-and-recreate.
- Show each book's share of the roll-up as a small allocation bar.
- Crypto quantity input that accepts "0.045 BTC" and "₹50,000 worth" interchangeably.

### Future Considerations (P2)

- **24/7 crypto polling** on its own slow cron entry — the natural fix for the weekend gap this PRD accepts.
- Raising the portfolio cap, and portfolio archiving with a read-only historical view.
- Read-only sharing of a managed portfolio with its beneficiary.
- Realised-gain and statement export per portfolio.
- Crypto as a first-class thesis market, with a non-fundamentals stress test.
- FX conversion so a multi-currency book has one true headline number, rather than a per-currency split.

## Success Metrics

- **Zero cross-book leakage.** No position, Council report, pattern read or objective ever appears under a portfolio that does not own it. Tested directly, not assumed.
- **The roll-up is trusted.** The trader uses "All portfolios" for exposure and a single book for decisions — rather than mentally subtracting his mother's holdings from a blended number, which is the behaviour this replaces.
- **The imported book is complete.** After this ships, a CSV import of a real mixed book leaves zero skipped rows on grounds of asset class.
- **Council advice differs by book.** A managed book and an owned book with different objectives produce visibly different verdicts on comparable holdings. If they don't, the framing is not doing its job.
- **"Macro Thesis" disappears.** Zero theses render the fallback within one week of shipping.

## Open Questions

1. ~~**The weekend crypto gap is the one accepted defect in this PRD.**~~ **CLOSED in Phase 3.** It was revisited before it cost anything rather than after: hourly polling, seven days, on its own cron entry. The question was worth writing down precisely because stating the cost plainly — "a Saturday 20% drawdown is not seen until Monday, on the one asset class that moves hardest when equity markets are shut" — made accepting it indefensible for the sake of one cron entry.
2. **Does the "All portfolios" Council make sense at all?** This PRD says the Council runs per book. A trader with five books may reasonably want one panel that sees everything. Deferred, but not obviously wrong.
3. **CoinGecko free-tier rate limits under `poll-prices`.** Batched pricing makes one call per run, which is comfortable — but the universe refresh, on-demand refreshes and the import resolver all share the same budget. Worth measuring before assuming.
4. **Does the ownership flag need to reach the disclaimer copy that already exists on the thesis Council?** This PRD changes the *portfolio* Council's framing. The per-thesis Council has no portfolio context at all, and arguably shouldn't gain one.
5. **The still-open `[legal]` question from `docs/prd-investment-council.md`** — using real public figures' names as personas — gets sharper here, since fiduciary framing on someone else's money is a different posture than personal-appetite framing on your own.

## Timeline Considerations

Four parts, and the dependency runs one way: **crypto and portfolios both touch the cockpit read, so portfolios go first** or the crypto work is done twice.

- **Phase 1 — Portfolios (largest).** Migration and backfill, the context and switcher, `?portfolio=` threading through every read, the roll-up, the ownership framing. This is the phase where a mistake is expensive, because it is the phase that moves existing data.
- **Phase 2 — Thesis titles (smallest, fully independent).** Two columns, one Zod field, three call sites. Ship it alongside Phase 1 or before it; it blocks nothing and nothing blocks it.
- **Phase 3 — Crypto.** Depends on Phase 1 only for where a crypto holding lands. The numeric widenings should go in early and separately — they are safe on their own and unpleasant to discover mid-import.
- **Phase 4 — Council and pattern-read prompt changes.** Both the fiduciary framing and the asset-class breakdown are prompt work, best done last when there is a real mixed, multi-book dataset to evaluate the output against.
