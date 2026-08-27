# Jarvis Decision Cockpit v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing single-stock "Run Jarvis" watchlist tracker with the thesis-first "Jarvis Decision Cockpit": free-text thesis input (3 modes), stress-tested trade plans, manually-logged positions with staged exits, a Jarvis recommendation accountability tracker, a trade journal, an intelligence feed, and an opportunity discovery screen — all restyled to the amber-gold "Neon Velocity v2" dark terminal aesthetic.

**Architecture:** Full replace of the data model (old `holdings`/`jarvis_analyses`/`alert_criteria`/`alert_log`/`fundamentals`/`price_cache` tables are dropped; `stocks` survives as a slim ticker/exchange/price registry). New tables — `theses`, `trade_plans`, `positions`, `entries`, `exits`, `jarvis_recommendations`, `trade_journal_entries` — carry the product. The existing Jarvis OpenRouter integration is repointed at a new mode-aware prompt/parser pair that produces a 6-field thesis instead of the old 5-section narrative. The already-deployed `poll-prices`/`daily-digest` Edge Functions are updated in place (not dropped) so the live cron schedule keeps working against the new schema instead of erroring nightly.

**Tech Stack:** Next.js App Router + TypeScript (existing), Supabase Postgres + Edge Functions (existing, schema replaced), OpenRouter via AI SDK (existing provider, new prompt), Tailwind v4 + shadcn/ui primitives (existing, tokens replaced), `date-fns-tz`, `zod`, `vitest`.

**Spec:** User-supplied "Jarvis Decision Cockpit — User Stories v2.0" document (pasted into chat 2026-08-27) plus 11 Stitch reference screens (project `5066478431085256622`, screenshots archived at `/private/tmp/claude-501/-Users-harshsharma-Desktop-Myticker/b51c0d9d-8d1b-4eaa-9057-7e361ac60602/scratchpad/stitch-screens/`). This plan file is the sole source of truth for execution — the spec's prose and this plan's tasks should agree; where they don't, this plan wins (see Decisions Beyond The Spec below).

## Global Constraints

- Single-user app, no auth changes — the existing shared-password gate (`middleware.ts`, `lib/auth/session.ts`) is untouched. Every new route lives inside the `(app)` route group.
- Every DB write goes through `lib/supabase/admin.ts`'s `createAdminClient()` (service-role). RLS stays deny-all-from-anon on every new table (mirrors migration `0004_enable_rls.sql`'s existing pattern) — each new table's migration must include `alter table ... enable row level security;` with no policies, in the same migration that creates it (not deferred to a later cleanup migration, per the lesson from the original build's final-review Critical finding).
- Currency: `lib/format.ts`'s existing `formatCurrency(value, exchange)` already produces Indian grouping (`₹2,84,836.00`) for non-US exchanges via `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })` — reuse it as-is, do not reimplement.
- Color tokens: every new component must reference a Tailwind color class backed by a `styles/tokens.css` custom property (Task 2) — never a hardcoded hex value. No `border`/`ring` utilities for section boundaries ("No-Line Rule", carried over from the original design system).
- Fonts: DM Mono for body/data/numbers, Syne for headings/labels (Task 2) — replaces the old Inter/Plus Jakarta Sans pair everywhere, not just in new screens.
- Git: use `/usr/bin/git` explicitly for every git command in this repo (old `/usr/local/bin/git` 2.15.0 shadows the modern one in PATH).
- Testing: `npm run test` (vitest) must stay green after every task. Follow the existing convention exactly — pure logic (calculators, parsers, prompt builders) gets its own `lib/__tests__/*.test.ts` file with real unit tests; screens/components are verified by manual click-through against the dev server (`npm run dev`), not component-rendering tests — this codebase has never used React Testing Library and this plan doesn't introduce it.
- Prices: `stocks.last_price`/`last_price_at` are refreshed by the existing cron-scheduled `poll-prices` Edge Function in the background, AND by an explicit on-demand endpoint (Task 4) called on every relevant page's mount and its "Refresh Prices" button — never by client-side polling while a page stays open (spec's "No auto-refresh" rule governs the frontend, not the existing backend cron).
- No broker integration, ever. "Execute" / "Log My Buy" / "Log Trim" mean "write a row recording what I already did," never a real order.
- **Server-component pages must use `fetchInternalApi()` from `lib/server-fetch.ts` (not a raw `fetch(...)`) whenever they call this app's own API routes.** `middleware.ts`'s matcher gates every non-asset path, including `/api/*`, on the `session` cookie — a plain `fetch(NEXT_PUBLIC_SITE_URL + path)` from inside a server component does NOT automatically carry the incoming browser request's cookies (it's a fresh outgoing HTTP request from the Next.js server process), so it gets redirected to `/login` and `res.json()` throws. Caught live during Task 16 (see ledger); `lib/server-fetch.ts` and the fix to Tasks 13/16's pages were added out-of-band. Every later page.tsx task in this plan must use this helper for its self-fetch, not the raw-`fetch` pattern shown in earlier tasks' now-superseded snippets.

## Decisions Beyond The Spec

The spec (Section 6, "Known gaps") already anticipates Stitch's visuals diverging from the written design language and instructs overriding Stitch where they conflict. Three further gaps needed a call this plan makes explicitly, so implementers don't have to guess mid-task:

1. **Stitch screens are the wrong product, not just wrong colors.** All 11 downloaded screens show a green-neon live options/crypto execution terminal (real "Confirm and Execute" broker flows, calls/puts, BTC/ETH perps, dollar-risk warnings) — not this spec's amber-gold manual-logging thesis tracker. Per the user's confirmation, every task below treats Stitch screenshots as **layout/information-hierarchy reference only**: panel arrangement, card density, table-vs-grid choices. Colors, typography, copy, and every broker-flavored control are overridden by Section 1 and the user stories, never copied from the pixels.
2. **Full schema replace** (per user's explicit choice): `holdings`, `jarvis_analyses`, `alert_criteria`, `alert_log`, `fundamentals`, `price_cache` are dropped in Task 1. `stocks` survives, trimmed to a ticker/exchange/price registry (`id`, `ticker`, `yahoo_symbol`, `exchange`, `last_price`, `last_price_at`, `created_at`) — every new table's spec-literal `ticker: string` field is kept as a denormalized column alongside a `stock_id` FK, so lookups stay ticker-friendly (matches the spec's literal field) while price refresh, exchange-timezone formatting, and Yahoo symbol resolution keep working off the existing `lib/market-data.ts`/`lib/format.ts` machinery unchanged.
3. **`poll-prices`/`daily-digest` are live in production** (cron-scheduled against the old schema right now). The spec's document is silent on alerting/email entirely — it never mentions the daily digest. Silently dropping the tables those two Edge Functions query would leave the cron jobs erroring every 15–30 minutes in the live project. Task 5 updates both functions in place to evaluate `trade_plans` (entry zone / stop / targets / time-exit) against `stocks.last_price` for active `positions`, writing into a new slim `position_alerts` table (this plan's replacement for the old `alert_log`) instead of dropping alerting altogether.
4. **Intelligence Feed (HUB-4) and Opportunity Discovery (Screen 8) "AI-generated"/"signal" sourcing has no chosen data source anywhere in the spec** (no news API, no ingestion cron is named). Building a real signal-ingestion pipeline is a separate, unscoped integration decision (which provider, what it costs) that shouldn't be invented silently inside a UI plan. Tasks 28 and 29 ship both screens fully functional against **manually-entered** signals/opportunities (a simple form to add one), with AI/news auto-sourcing left as an explicit follow-up once a data source is chosen — the UI, data model, and sort/filter logic are all still real and complete, only the ingestion side is deferred.

## Task Index

**Phase 0 — Foundation** (blocks everything below)
1. Schema replacement migration + `lib/types.ts` rewrite
2. Design tokens v2 (amber-gold) + DM Mono/Syne fonts
3. Retire superseded code
4. On-demand price refresh endpoint + client hook
5. Update `poll-prices`/`daily-digest` Edge Functions for the new schema
6. App shell: sidebar nav + New-Thesis drawer + shared empty/loading/error states

**Phase 1 — P0**
7. Jarvis thesis prompt v2 (3-mode)
8. Jarvis thesis parser v2
9. `POST /api/theses`
10. Screen 1: Thesis Input
11. `lib/weighted-average.ts`
12. `POST /api/positions/[id]/entries`
13. Screen HUB-2: Active Positions & Exit Discipline
14. Screen 4: Manual Execution Trigger + `POST /api/positions`
15. `lib/recommendation-status.ts`
16. Screen NEW: Jarvis Recommendation Tracker

**Phase 2 — P1**
17. Stress-test extension (bear cases) to prompt/parser
18. `lib/risk-reward.ts`
19. `PATCH /api/trade-plans/[id]`
20. Screen 2–3: Validation & Plan wizard
21. Screen HUB-3: Stress Test & Trade Plan (review mode)
22. `POST /api/positions/[id]/exits`
23. Screen 5–6: Exit & Monitoring
24. Screen HUB-1: Velocity Cockpit dashboard

**Phase 3 — P2**
25. `POST /api/journal` + Jarvis-verdict generation
26. Screen 7: Trade Journal & Review (form)
27. Journal archive/browse screen
28. Screen HUB-4: Intelligence Feed (manual signals)

**Phase 4 — P3**
29. Screen 8: Opportunity Discovery (manual watchlist)

**Final**
30. Whole-plan verification pass

---

## Phase 0 — Foundation

### Task 1: Schema replacement migration + `lib/types.ts` rewrite

**Files:**
- Create: `supabase/migrations/0006_thesis_cockpit_schema.sql`
- Create: `supabase/migrations/0007_thesis_cockpit_indexes.sql`
- Modify: `lib/types.ts` (full rewrite)
- Test: none (SQL + hand-verified types; `tsc --noEmit` is the verification gate)

**Interfaces:**
- Produces: every table/enum below, and the matching TS `Row`/`Insert`/`Update` types + `Database` generic, which every later task imports from `@/lib/types`.

- [ ] **Step 1: Write the migration**

```sql
-- 0006_thesis_cockpit_schema.sql
-- Full replace of the v1 schema per the Jarvis Decision Cockpit v2 spec.
-- Drops the old analysis/holding/alert tables; `stocks` survives, trimmed to
-- a ticker/exchange/price registry (see plan's "Decisions Beyond The Spec" #2).

drop table if exists alert_log cascade;
drop table if exists alert_criteria cascade;
drop table if exists jarvis_analyses cascade;
drop table if exists holdings cascade;
drop table if exists fundamentals cascade;
drop table if exists price_cache cascade;

alter table stocks drop column if exists type;
alter table stocks drop column if exists status;
alter table stocks drop column if exists consecutive_failure_count;
alter table stocks drop column if exists stale_since;
alter table stocks drop column if exists deleted_at;
-- yahoo_symbol/exchange/last_price/last_price_at/created_at/id/ticker are kept as-is.

-- Column drops MUST precede these type drops — `stocks.type` is a
-- `stock_type` column; Postgres rejects `drop type` while a column still
-- references it (2BP01). Caught live against the real project during
-- execution, not by static review — see this plan's ledger.
drop type if exists trigger_type;
drop type if exists stock_type;

create type conviction_tier as enum ('I', 'II', 'III', 'IV');
create type thesis_mode as enum ('stock_only', 'thesis_only', 'stock_plus_thesis');
create type thesis_status as enum ('draft', 'active', 'closed', 'macro');
create type position_status as enum ('active', 'partial_exit', 'closed');
create type entry_tranche as enum ('T1', 'T2', 'add');
create type exit_type as enum ('trim_t1', 'trim_t2', 'stop_hit', 'time_exit', 'manual');
create type recommendation_status as enum ('open', 't1_hit', 't2_hit', 'stop_hit', 'time_expired');
create type thesis_outcome as enum ('confirmed', 'partially_confirmed', 'invalidated');
create type position_alert_type as enum ('entry_zone_reached', 'stop_loss_breached', 'trim_target_reached', 'time_exit_due');

create table theses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  input_text text not null,
  mode thesis_mode not null,
  stock_id uuid references stocks(id),
  ticker text,
  market_view text,
  mispricing text,
  catalyst text,
  time_horizon text,
  invalidation_condition text,
  conviction_tier conviction_tier,
  conviction_score int check (conviction_score is null or (conviction_score between 0 and 100)),
  status thesis_status not null default 'draft',
  bear_cases jsonb not null default '[]',
  raw_llm_response text
);

create table trade_plans (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references theses(id) on delete cascade,
  entry_zone_low numeric(14,4),
  entry_zone_high numeric(14,4),
  add_tranche_low numeric(14,4),
  add_tranche_high numeric(14,4),
  stop_loss numeric(14,4),
  target_1 numeric(14,4),
  target_2 numeric(14,4),
  position_size_pct numeric(6,3),
  max_portfolio_pct numeric(6,3),
  time_exit_date date,
  time_exit_condition text,
  edited_fields text[] not null default '{}',
  ai_suggested jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table positions (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references theses(id) on delete cascade,
  trade_plan_id uuid not null references trade_plans(id) on delete cascade,
  stock_id uuid not null references stocks(id),
  ticker text not null,
  status position_status not null default 'active',
  created_at timestamptz not null default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id) on delete cascade,
  date date not null,
  quantity numeric(18,6) not null check (quantity > 0),
  price numeric(14,4) not null check (price > 0),
  tranche entry_tranche not null,
  notes text,
  created_at timestamptz not null default now()
);

create table exits (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id) on delete cascade,
  date date not null,
  quantity numeric(18,6) not null check (quantity > 0),
  price numeric(14,4) not null check (price > 0),
  type exit_type not null,
  reason text,
  override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now()
);

create table jarvis_recommendations (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references theses(id) on delete cascade,
  trade_plan_id uuid references trade_plans(id) on delete set null,
  stock_id uuid not null references stocks(id),
  ticker text not null,
  recommended_at timestamptz not null default now(),
  recommended_entry_low numeric(14,4),
  recommended_entry_high numeric(14,4),
  recommended_stop numeric(14,4),
  recommended_target_1 numeric(14,4),
  recommended_target_2 numeric(14,4),
  conviction_tier conviction_tier not null,
  price_at_recommendation numeric(14,4) not null,
  status recommendation_status not null default 'open',
  converted_to_position boolean not null default false,
  position_id uuid references positions(id) on delete set null,
  thesis_summary text not null
);

create table trade_journal_entries (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id) on delete cascade,
  ticker text not null,
  entry_dates date[] not null default '{}',
  exit_dates date[] not null default '{}',
  pnl_rupees numeric(14,4) not null,
  pnl_pct numeric(8,4),
  thesis_outcome thesis_outcome not null,
  conviction_tier_used conviction_tier not null,
  entry_quality int not null check (entry_quality between 1 and 5),
  sizing_quality int not null check (sizing_quality between 1 and 5),
  stop_management int not null check (stop_management between 1 and 5),
  exit_quality int not null check (exit_quality between 1 and 5),
  discipline_score int not null check (discipline_score between 1 and 5),
  what_went_right text,
  what_went_wrong text,
  lessons text,
  jarvis_verdict text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Replacement for the old `alert_log`, scoped to the new trade-plan model.
-- Written by the updated `poll-prices` Edge Function (Task 5).
create table position_alerts (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id) on delete cascade,
  alert_type position_alert_type not null,
  triggered_at timestamptz not null default now(),
  details jsonb not null,
  emailed_at timestamptz
);

-- Manually-curated feed items and opportunities (Decisions Beyond The Spec #4).
create table intelligence_signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  priority text not null check (priority in ('red', 'amber', 'blue', 'grey')),
  ticker text,
  theme text,
  headline text not null,
  thesis_id uuid references theses(id) on delete set null,
  archived_at timestamptz
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ticker text not null,
  sector text,
  conviction_tier conviction_tier,
  thesis_summary text,
  pe numeric(10,2),
  sector_median_pe numeric(10,2),
  fifty_two_week_low numeric(14,4),
  fifty_two_week_high numeric(14,4),
  market exchange_code not null,
  watching_only boolean not null default false
);

alter table theses enable row level security;
alter table trade_plans enable row level security;
alter table positions enable row level security;
alter table entries enable row level security;
alter table exits enable row level security;
alter table jarvis_recommendations enable row level security;
alter table trade_journal_entries enable row level security;
alter table position_alerts enable row level security;
alter table intelligence_signals enable row level security;
alter table opportunities enable row level security;
```

```sql
-- 0007_thesis_cockpit_indexes.sql
create index idx_theses_ticker on theses (ticker) where ticker is not null;
create index idx_theses_status on theses (status);
create index idx_trade_plans_thesis on trade_plans (thesis_id);
create index idx_positions_thesis on positions (thesis_id);
create index idx_positions_status on positions (status);
create index idx_entries_position on entries (position_id, date);
create index idx_exits_position on exits (position_id, date);
create index idx_jarvis_recs_status on jarvis_recommendations (status);
create index idx_jarvis_recs_ticker on jarvis_recommendations (ticker);
create index idx_journal_position on trade_journal_entries (position_id);
create index idx_position_alerts_unemailed on position_alerts (triggered_at) where emailed_at is null;
create index idx_intelligence_signals_active on intelligence_signals (priority, created_at desc) where archived_at is null;
create index idx_opportunities_tier on opportunities (conviction_tier);
```

- [ ] **Step 2: Apply both migrations to the live Supabase project**

Run: `mcp__claude_ai_Supabase__apply_migration` (or `supabase db push` if working from the CLI) for both files, in order. Verify with `mcp__claude_ai_Supabase__list_tables` that the 10 new tables exist and the 6 old ones are gone, and `mcp__claude_ai_Supabase__get_advisors` reports no new RLS issues.

- [ ] **Step 3: Rewrite `lib/types.ts`**

Follow the existing file's exact conventions (`type`, never `interface`, for every Row/Insert/Update — see the file's own header comment for why; `Json` union unchanged; `Database` generic with empty `Relationships: []` on every table). Full replacement:

```typescript
// lib/types.ts
// Canonical TypeScript types mirroring supabase/migrations/0006_thesis_cockpit_schema.sql
// and 0007_thesis_cockpit_indexes.sql exactly. See that file's header comment
// (preserved from v1) for the `type` vs `interface` rule and the numeric/jsonb
// mapping notes — both still apply unchanged.

export type ExchangeCode = "NSE" | "BSE" | "US";
export type ConvictionTier = "I" | "II" | "III" | "IV";
export type ThesisMode = "stock_only" | "thesis_only" | "stock_plus_thesis";
export type ThesisStatus = "draft" | "active" | "closed" | "macro";
export type PositionStatus = "active" | "partial_exit" | "closed";
export type EntryTranche = "T1" | "T2" | "add";
export type ExitType = "trim_t1" | "trim_t2" | "stop_hit" | "time_exit" | "manual";
export type RecommendationStatus = "open" | "t1_hit" | "t2_hit" | "stop_hit" | "time_expired";
export type ThesisOutcome = "confirmed" | "partially_confirmed" | "invalidated";
export type PositionAlertType =
  | "entry_zone_reached"
  | "stop_loss_breached"
  | "trim_target_reached"
  | "time_exit_due";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** `stocks` (trimmed ticker/exchange/price registry — see plan Decisions #2) */
export type Stock = {
  id: string;
  ticker: string;
  yahoo_symbol: string;
  exchange: ExchangeCode;
  last_price: number | null;
  last_price_at: string | null;
  created_at: string;
};

/** One bear case + counter-argument inside `theses.bear_cases`. */
export type BearCase = {
  reason: string;
  counter: string;
  modified: boolean;
};

/** `theses` */
export type Thesis = {
  id: string;
  created_at: string;
  input_text: string;
  mode: ThesisMode;
  stock_id: string | null;
  ticker: string | null;
  market_view: string | null;
  mispricing: string | null;
  catalyst: string | null;
  time_horizon: string | null;
  invalidation_condition: string | null;
  conviction_tier: ConvictionTier | null;
  conviction_score: number | null;
  status: ThesisStatus;
  bear_cases: BearCase[];
  raw_llm_response: string | null;
};

/** `trade_plans` */
export type TradePlan = {
  id: string;
  thesis_id: string;
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  add_tranche_low: number | null;
  add_tranche_high: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  position_size_pct: number | null;
  max_portfolio_pct: number | null;
  time_exit_date: string | null;
  time_exit_condition: string | null;
  edited_fields: string[];
  ai_suggested: Json;
  created_at: string;
  updated_at: string;
};

/** `positions` */
export type Position = {
  id: string;
  thesis_id: string;
  trade_plan_id: string;
  stock_id: string;
  ticker: string;
  status: PositionStatus;
  created_at: string;
};

/** `entries` */
export type Entry = {
  id: string;
  position_id: string;
  date: string;
  quantity: number;
  price: number;
  tranche: EntryTranche;
  notes: string | null;
  created_at: string;
};

/** `exits` */
export type Exit = {
  id: string;
  position_id: string;
  date: string;
  quantity: number;
  price: number;
  type: ExitType;
  reason: string | null;
  override: boolean;
  override_reason: string | null;
  created_at: string;
};

/** `jarvis_recommendations` */
export type JarvisRecommendation = {
  id: string;
  thesis_id: string;
  trade_plan_id: string | null;
  stock_id: string;
  ticker: string;
  recommended_at: string;
  recommended_entry_low: number | null;
  recommended_entry_high: number | null;
  recommended_stop: number | null;
  recommended_target_1: number | null;
  recommended_target_2: number | null;
  conviction_tier: ConvictionTier;
  price_at_recommendation: number;
  status: RecommendationStatus;
  converted_to_position: boolean;
  position_id: string | null;
  thesis_summary: string;
};

/** `trade_journal_entries` */
export type TradeJournalEntry = {
  id: string;
  position_id: string;
  ticker: string;
  entry_dates: string[];
  exit_dates: string[];
  pnl_rupees: number;
  pnl_pct: number | null;
  thesis_outcome: ThesisOutcome;
  conviction_tier_used: ConvictionTier;
  entry_quality: number;
  sizing_quality: number;
  stop_management: number;
  exit_quality: number;
  discipline_score: number;
  what_went_right: string | null;
  what_went_wrong: string | null;
  lessons: string | null;
  jarvis_verdict: string | null;
  tags: string[];
  created_at: string;
};

/** `position_alerts` (v2 replacement for the old `alert_log`) */
export type PositionAlert = {
  id: string;
  position_id: string;
  alert_type: PositionAlertType;
  triggered_at: string;
  details: Json;
  emailed_at: string | null;
};

/** `intelligence_signals` */
export type IntelligenceSignal = {
  id: string;
  created_at: string;
  priority: "red" | "amber" | "blue" | "grey";
  ticker: string | null;
  theme: string | null;
  headline: string;
  thesis_id: string | null;
  archived_at: string | null;
};

/** `opportunities` */
export type Opportunity = {
  id: string;
  created_at: string;
  ticker: string;
  sector: string | null;
  conviction_tier: ConvictionTier | null;
  thesis_summary: string | null;
  pe: number | null;
  sector_median_pe: number | null;
  fifty_two_week_low: number | null;
  fifty_two_week_high: number | null;
  market: ExchangeCode;
  watching_only: boolean;
};

// --- Insert types (columns with a SQL default or that are nullable become optional) ---

export type StockInsert = Pick<Stock, "ticker" | "yahoo_symbol" | "exchange"> &
  Partial<Pick<Stock, "id" | "last_price" | "last_price_at" | "created_at">>;

export type ThesisInsert = Pick<Thesis, "input_text" | "mode"> &
  Partial<
    Pick<
      Thesis,
      | "id"
      | "created_at"
      | "stock_id"
      | "ticker"
      | "market_view"
      | "mispricing"
      | "catalyst"
      | "time_horizon"
      | "invalidation_condition"
      | "conviction_tier"
      | "conviction_score"
      | "status"
      | "bear_cases"
      | "raw_llm_response"
    >
  >;

export type TradePlanInsert = Pick<TradePlan, "thesis_id"> &
  Partial<
    Pick<
      TradePlan,
      | "id"
      | "entry_zone_low"
      | "entry_zone_high"
      | "add_tranche_low"
      | "add_tranche_high"
      | "stop_loss"
      | "target_1"
      | "target_2"
      | "position_size_pct"
      | "max_portfolio_pct"
      | "time_exit_date"
      | "time_exit_condition"
      | "edited_fields"
      | "ai_suggested"
      | "created_at"
      | "updated_at"
    >
  >;

export type PositionInsert = Pick<
  Position,
  "thesis_id" | "trade_plan_id" | "stock_id" | "ticker"
> &
  Partial<Pick<Position, "id" | "status" | "created_at">>;

export type EntryInsert = Pick<
  Entry,
  "position_id" | "date" | "quantity" | "price" | "tranche"
> &
  Partial<Pick<Entry, "id" | "notes" | "created_at">>;

export type ExitInsert = Pick<
  Exit,
  "position_id" | "date" | "quantity" | "price" | "type"
> &
  Partial<
    Pick<Exit, "id" | "reason" | "override" | "override_reason" | "created_at">
  >;

export type JarvisRecommendationInsert = Pick<
  JarvisRecommendation,
  "thesis_id" | "stock_id" | "ticker" | "conviction_tier" | "price_at_recommendation" | "thesis_summary"
> &
  Partial<
    Pick<
      JarvisRecommendation,
      | "id"
      | "trade_plan_id"
      | "recommended_at"
      | "recommended_entry_low"
      | "recommended_entry_high"
      | "recommended_stop"
      | "recommended_target_1"
      | "recommended_target_2"
      | "status"
      | "converted_to_position"
      | "position_id"
    >
  >;

export type TradeJournalEntryInsert = Pick<
  TradeJournalEntry,
  | "position_id"
  | "ticker"
  | "pnl_rupees"
  | "thesis_outcome"
  | "conviction_tier_used"
  | "entry_quality"
  | "sizing_quality"
  | "stop_management"
  | "exit_quality"
  | "discipline_score"
> &
  Partial<
    Pick<
      TradeJournalEntry,
      | "id"
      | "entry_dates"
      | "exit_dates"
      | "pnl_pct"
      | "what_went_right"
      | "what_went_wrong"
      | "lessons"
      | "jarvis_verdict"
      | "tags"
      | "created_at"
    >
  >;

export type PositionAlertInsert = Pick<
  PositionAlert,
  "position_id" | "alert_type" | "details"
> &
  Partial<Pick<PositionAlert, "id" | "triggered_at" | "emailed_at">>;

export type IntelligenceSignalInsert = Pick<IntelligenceSignal, "priority" | "headline"> &
  Partial<
    Pick<IntelligenceSignal, "id" | "created_at" | "ticker" | "theme" | "thesis_id" | "archived_at">
  >;

export type OpportunityInsert = Pick<Opportunity, "ticker" | "market"> &
  Partial<
    Pick<
      Opportunity,
      | "id"
      | "created_at"
      | "sector"
      | "conviction_tier"
      | "thesis_summary"
      | "pe"
      | "sector_median_pe"
      | "fifty_two_week_low"
      | "fifty_two_week_high"
      | "watching_only"
    >
  >;

// --- Update types ---
export type StockUpdate = Partial<StockInsert>;
export type ThesisUpdate = Partial<ThesisInsert>;
export type TradePlanUpdate = Partial<TradePlanInsert>;
export type PositionUpdate = Partial<PositionInsert>;
export type EntryUpdate = Partial<EntryInsert>;
export type ExitUpdate = Partial<ExitInsert>;
export type JarvisRecommendationUpdate = Partial<JarvisRecommendationInsert>;
export type TradeJournalEntryUpdate = Partial<TradeJournalEntryInsert>;
export type PositionAlertUpdate = Partial<PositionAlertInsert>;
export type IntelligenceSignalUpdate = Partial<IntelligenceSignalInsert>;
export type OpportunityUpdate = Partial<OpportunityInsert>;

export interface Database {
  public: {
    Tables: {
      stocks: { Row: Stock; Insert: StockInsert; Update: StockUpdate; Relationships: [] };
      theses: { Row: Thesis; Insert: ThesisInsert; Update: ThesisUpdate; Relationships: [] };
      trade_plans: { Row: TradePlan; Insert: TradePlanInsert; Update: TradePlanUpdate; Relationships: [] };
      positions: { Row: Position; Insert: PositionInsert; Update: PositionUpdate; Relationships: [] };
      entries: { Row: Entry; Insert: EntryInsert; Update: EntryUpdate; Relationships: [] };
      exits: { Row: Exit; Insert: ExitInsert; Update: ExitUpdate; Relationships: [] };
      jarvis_recommendations: {
        Row: JarvisRecommendation;
        Insert: JarvisRecommendationInsert;
        Update: JarvisRecommendationUpdate;
        Relationships: [];
      };
      trade_journal_entries: {
        Row: TradeJournalEntry;
        Insert: TradeJournalEntryInsert;
        Update: TradeJournalEntryUpdate;
        Relationships: [];
      };
      position_alerts: {
        Row: PositionAlert;
        Insert: PositionAlertInsert;
        Update: PositionAlertUpdate;
        Relationships: [];
      };
      intelligence_signals: {
        Row: IntelligenceSignal;
        Insert: IntelligenceSignalInsert;
        Update: IntelligenceSignalUpdate;
        Relationships: [];
      };
      opportunities: {
        Row: Opportunity;
        Insert: OpportunityInsert;
        Update: OpportunityUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      exchange_code: ExchangeCode;
      conviction_tier: ConvictionTier;
      thesis_mode: ThesisMode;
      thesis_status: ThesisStatus;
      position_status: PositionStatus;
      entry_tranche: EntryTranche;
      exit_type: ExitType;
      recommendation_status: RecommendationStatus;
      thesis_outcome: ThesisOutcome;
      position_alert_type: PositionAlertType;
    };
    CompositeTypes: Record<string, never>;
  };
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: fails, loudly, in every file that imported a now-deleted type (`StockType`, `Holding`, `JarvisAnalysis`, `AlertCriteria`, `TriggerType`, etc.) — this is expected and is exactly the list Task 3 deletes/rewrites next. Do not attempt to fix these errors in this task.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add supabase/migrations/0006_thesis_cockpit_schema.sql supabase/migrations/0007_thesis_cockpit_indexes.sql lib/types.ts
/usr/bin/git commit -m "feat: replace v1 schema with Jarvis Decision Cockpit v2 data model"
```

---

### Task 2: Design tokens v2 (amber-gold) + DM Mono/Syne fonts

**Files:**
- Modify: `styles/tokens.css` (full rewrite)
- Modify: `tailwind.config.ts:59-68` (fontFamily block)
- Modify: `app/layout.tsx` (font imports)

**Interfaces:**
- Produces: every Tailwind color/font class every later screen task uses (`bg-surface`, `text-primary`, `font-display`, `font-mono`, `text-status-red`, etc.)

- [ ] **Step 1: Rewrite `styles/tokens.css`**

```css
/**
 * Design tokens for "Neon Velocity v2" — the Jarvis Decision Cockpit's dark
 * terminal palette. Replaces the v1 green palette entirely (spec Section 1).
 * Dark-only. Every color used in the app must resolve through one of these
 * custom properties — never hardcode a hex value outside this file.
 */

:root {
  /* --- Surface --- */
  --color-surface: #080808; /* exact: near-black base canvas per spec */
  --color-surface-container-lowest: #050505; /* judgment: recessed tier below base (page gutters) */
  --color-surface-container-low: #101010; /* judgment: default card body */
  --color-surface-container-high: #1a1a1a; /* judgment: card hover state / separator band fill */
  --color-surface-container-highest: #242424; /* judgment: input field body / secondary button fill */
  --color-surface-variant: #2b2b2b; /* judgment: glassmorphism base, used at 0.8 opacity + blur */

  /* --- Brand / accent --- */
  --color-primary: #e8b339; /* exact: amber-gold, CTAs/active states/labels */
  --color-primary-container: #3d2f0f; /* judgment: dark muted-gold tonal container behind primary text/badges */
  --color-on-primary: #201702; /* judgment: near-black text on amber-gold fill, never white */

  /* --- Text --- */
  --color-on-surface: #f4f2ec; /* judgment: warm off-white, pairs with the amber accent better than pure white */

  /* --- Status (exact hexes per spec) --- */
  --color-status-red: #f87171; /* exact: stop/danger */
  --color-status-red-container: #3a1616; /* judgment: dark muted-red container at 10% use */
  --color-status-green: #4ade80; /* exact: gain/confirm */
  --color-status-green-container: #123a20; /* judgment: dark muted-green container */
  --color-status-blue: #60a5fa; /* exact: watch/info */
  --color-status-blue-container: #12233a; /* judgment: dark muted-blue container */

  /* --- Secondary (kept distinct from status-blue for non-status accents, e.g. tags) --- */
  --color-secondary: #60a5fa;
  --color-secondary-container: #12233a;

  /* --- Error (alias of status-red, kept for shadcn primitive compatibility) --- */
  --color-error: #f87171;
  --color-error-container: #3a1616;

  /* --- Outline (ghost border, accessibility fallback only — never a default) --- */
  --color-outline-variant: #5c5c5c; /* judgment: mid-grey, only ever applied at 10% opacity per the No-Line Rule's one exception */
}
```

- [ ] **Step 2: Update `tailwind.config.ts`'s color map to add status tokens**

Modify the `colors` block (`tailwind.config.ts:32-49`) to add three new entries after `"outline-variant"`:

```typescript
        "outline-variant": "var(--color-outline-variant)",
        "status-red": "var(--color-status-red)",
        "status-red-container": "var(--color-status-red-container)",
        "status-green": "var(--color-status-green)",
        "status-green-container": "var(--color-status-green-container)",
        "status-blue": "var(--color-status-blue)",
        "status-blue-container": "var(--color-status-blue-container)",
```

- [ ] **Step 3: Replace the `fontFamily` block (`tailwind.config.ts:59-68`)**

```typescript
      fontFamily: {
        // Syne: headings/labels. DM Mono: body/data/numbers (spec Section 1).
        display: ["var(--font-syne)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
        mono: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
      },
```

- [ ] **Step 4: Swap the font imports in `app/layout.tsx`**

```typescript
import type { Metadata } from "next";
import { DM_Mono, Syne } from "next/font/google";
import "@/styles/tokens.css";
import "./globals.css";

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
});

export const metadata: Metadata = {
  title: "Jarvis Decision Cockpit",
  description: "Jarvis Decision Cockpit",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${dmMono.variable} ${syne.variable}`}>
      <body className="bg-surface text-on-surface font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run dev`, open `http://localhost:3000/login` (the one screen unaffected by later tasks' deletions). Confirm: near-black background, amber-gold focus ring on the password input, monospace body text.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add styles/tokens.css tailwind.config.ts app/layout.tsx
/usr/bin/git commit -m "feat: replace v1 green tokens with amber-gold Neon Velocity v2 + DM Mono/Syne"
```

---

### Task 3: Retire superseded code

**Files:**
- Delete: `app/(app)/add/page.tsx`, `app/(app)/stocks/[id]/page.tsx`, `app/(app)/page.tsx` (rebuilt in Task 24)
- Delete: `app/api/stocks/route.ts`, `app/api/stocks/[id]/route.ts`, `app/api/stocks/__tests__/`, `app/api/fundamentals/[stockId]/route.ts`, `app/api/fundamentals/[stockId]/__tests__/`, `app/api/jarvis/run/route.ts`, `app/api/jarvis/run/__tests__/`
- Delete: `components/add-ticker/`, `components/dashboard/`, `components/stock-detail/`
- Delete: `lib/jarvis-run.ts`, `lib/pnl.ts`, `lib/trigger-logic.ts`, `lib/jarvis-prompt.ts`, `lib/jarvis-parser.ts` (both replaced by Tasks 7/8/17), `lib/__tests__/jarvis-run.test.ts`, `lib/__tests__/pnl.test.ts`, `lib/__tests__/trigger-logic.test.ts`, `lib/__tests__/jarvis-parser.test.ts`, `lib/__tests__/jarvis-prompt.test.ts`
- Delete: `lib/validation/schemas.ts`'s `AddTickerInputSchema`, `UpdateStockInputSchema`, `RunJarvisInputSchema`, `UpsertFundamentalInputSchema` and their type exports (keep the file, keep `ExchangeCodeSchema`/`StockTypeSchema`... actually `StockTypeSchema` is also dead — delete it too, keep only `ExchangeCodeSchema`)
- Delete: `lib/validation/__tests__/schemas.test.ts`'s now-orphaned test cases for the deleted schemas (keep the file if any cases for `ExchangeCodeSchema` remain, otherwise delete the file)
- Modify: `lib/format.ts` — no change needed (still used by every later task)

**Interfaces:**
- Consumes: nothing new
- Produces: a clean tree with no dangling references to deleted `lib/types.ts` exports, so `tsc --noEmit` from Task 1 Step 4 goes green.

- [ ] **Step 1: Delete the files listed above**

```bash
/usr/bin/git rm -r \
  "app/(app)/add/page.tsx" \
  "app/(app)/stocks" \
  "app/(app)/page.tsx" \
  app/api/stocks \
  "app/api/fundamentals" \
  app/api/jarvis/run \
  components/add-ticker \
  components/dashboard \
  components/stock-detail \
  lib/jarvis-run.ts \
  lib/pnl.ts \
  lib/trigger-logic.ts \
  lib/jarvis-prompt.ts \
  lib/jarvis-parser.ts \
  lib/__tests__/jarvis-run.test.ts \
  lib/__tests__/pnl.test.ts \
  lib/__tests__/trigger-logic.test.ts \
  lib/__tests__/jarvis-parser.test.ts \
  lib/__tests__/jarvis-prompt.test.ts
```

- [ ] **Step 2: Trim `lib/validation/schemas.ts` down to just the still-needed enum**

```typescript
import { z } from "zod";

/**
 * zod schemas shared across the Jarvis Decision Cockpit v2 API routes.
 * Route-specific schemas (thesis input, trade plan patch, entry/exit logging,
 * journal entries) live next to the route that uses them — see each task's
 * "Files" section — rather than being centralized here, since this app's v1
 * history showed centralizing every schema in one file just meant every API
 * task touched the same file and fought over it.
 */
export const ExchangeCodeSchema = z.enum(["NSE", "BSE", "US"]);
```

- [ ] **Step 3: Delete the now-fully-orphaned validation test file**

```bash
/usr/bin/git rm lib/validation/__tests__/schemas.test.ts
```

(A fresh test file for `ExchangeCodeSchema` alone isn't worth creating — it's a one-line `z.enum`, and every route task that uses it exercises it implicitly via its own route test.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run test`
Expected: `tsc` passes (no more dangling imports of deleted `lib/types.ts` exports — `app/(auth)/login/*`, `middleware.ts`, `lib/auth/session.ts`, `lib/market-data.ts`, `lib/market-hours.ts`, `lib/sma.ts`, `lib/supabase/*`, `lib/llm/openrouter.ts`, `lib/format.ts` are all untouched and still valid). `npm run test` passes with only the untouched suites remaining (`format.test.ts`, `market-data.test.ts`, `market-hours.test.ts`, `sma.test.ts`, `auth/__tests__/session.test.ts`).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add -A
/usr/bin/git commit -m "chore: retire v1 stock-centric routes, components, and libs superseded by v2"
```

---

### Task 4: On-demand price refresh endpoint + client hook

**Files:**
- Create: `app/api/prices/refresh/route.ts`
- Create: `lib/hooks/use-price-refresh.ts`
- Test: `app/api/prices/refresh/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `getQuote` from `@/lib/market-data`, `createAdminClient` from `@/lib/supabase/admin`
- Produces: `POST /api/prices/refresh` (body `{ stockIds: string[] }` → `{ prices: Record<string, { price: number; asOf: string }> }`); `usePriceRefresh(stockIds: string[])` client hook returning `{ refresh: () => Promise<void>; refreshing: boolean }`, called by every later screen on mount and on its "Refresh Prices" button.

- [ ] **Step 1: Write the route**

```typescript
// app/api/prices/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";

import { getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * On-demand price refresh for a set of stocks, called on page load and the
 * "Refresh Prices" button (spec's global Price Data rule: no background
 * polling while a page is open). Bypasses the `poll-prices` Edge Function's
 * cron cache and hits Yahoo directly so a page load always shows a genuinely
 * fresh price, not a possibly-stale cron snapshot.
 */
export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const stockIds: unknown = json?.stockIds;
  if (!Array.isArray(stockIds) || stockIds.some((id) => typeof id !== "string")) {
    return NextResponse.json(
      { error: "Body must be { stockIds: string[] }" },
      { status: 400 },
    );
  }
  if (stockIds.length === 0) {
    return NextResponse.json({ prices: {} });
  }

  const supabase = createAdminClient();
  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("id, yahoo_symbol")
    .in("id", stockIds as string[]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const prices: Record<string, { price: number; asOf: string }> = {};

  await Promise.all(
    (stocks ?? []).map(async (stock) => {
      try {
        const quote = await getQuote(stock.yahoo_symbol);
        prices[stock.id] = { price: quote.price, asOf: quote.asOf.toISOString() };
        await supabase
          .from("stocks")
          .update({ last_price: quote.price, last_price_at: quote.asOf.toISOString() })
          .eq("id", stock.id);
      } catch {
        // One symbol failing (delisted, rate-limited, transient network
        // error) must not fail the whole batch — that stock's price simply
        // stays at its last known value and is omitted from `prices`, and
        // the spec's "Price unavailable" badge (Task 6's empty/error state
        // helper) is what renders for it.
      }
    }),
  );

  return NextResponse.json({ prices });
}
```

- [ ] **Step 2: Write the route test**

```typescript
// app/api/prices/refresh/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildAdminClientMock(stocks: { id: string; yahoo_symbol: string }[]) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: stocks, error: null }),
      }),
      update,
    }),
  };
}

describe("POST /api/prices/refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-array stockIds body", async () => {
    const req = new Request("http://test/api/prices/refresh", {
      method: "POST",
      body: JSON.stringify({ stockIds: "not-an-array" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns fresh prices for each resolvable stock and omits failures", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildAdminClientMock([
        { id: "s1", yahoo_symbol: "AAPL" },
        { id: "s2", yahoo_symbol: "BROKEN" },
      ]) as never,
    );
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "BROKEN") throw new Error("no quote");
      return { price: 150.25, asOf: new Date("2026-08-27T10:00:00Z") };
    });

    const req = new Request("http://test/api/prices/refresh", {
      method: "POST",
      body: JSON.stringify({ stockIds: ["s1", "s2"] }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.prices.s1.price).toBe(150.25);
    expect(body.prices.s2).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run app/api/prices/refresh/__tests__/route.test.ts`
Expected: PASS (2/2)

- [ ] **Step 4: Write the client hook**

```typescript
// lib/hooks/use-price-refresh.ts
"use client";

import { useCallback, useState } from "react";

/**
 * Fetches fresh prices for `stockIds` from `POST /api/prices/refresh` and
 * calls `router.refresh()`-equivalent via `onRefreshed` so the calling
 * server component re-renders with updated `stocks.last_price`. Every
 * screen that lists tickers calls `refresh()` once on mount (via a
 * `useEffect` in the calling component) and wires it to a "Refresh Prices"
 * button — this hook itself has no auto-polling (spec's global Price Data
 * rule).
 */
export function usePriceRefresh(stockIds: string[], onRefreshed?: () => void) {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (stockIds.length === 0) return;
    setRefreshing(true);
    try {
      await fetch("/api/prices/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockIds }),
      });
      onRefreshed?.();
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockIds.join(","), onRefreshed]);

  return { refresh, refreshing };
}
```

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/api/prices lib/hooks/use-price-refresh.ts
/usr/bin/git commit -m "feat: on-demand price refresh endpoint + client hook"
```

---

### Task 5: Update `poll-prices`/`daily-digest` Edge Functions for the new schema

**Files:**
- Modify: `supabase/functions/poll-prices/index.ts` (full rewrite of the type/query/trigger layer; `market-hours.ts` is untouched)
- Modify: `supabase/functions/daily-digest/index.ts` (query layer only)
- Modify: `supabase/functions/daily-digest/email-template.ts:15-22` (`TRIGGER_LABELS` map)

**Interfaces:**
- Consumes: `positions`/`trade_plans`/`position_alerts` tables from Task 1
- Produces: the same two `pg_cron`-invoked HTTP endpoints, now evaluating the v2 model. No `pg_cron`/Vault changes needed — the schedules already call these same URLs.

- [ ] **Step 1: Rewrite `poll-prices/index.ts`'s type/query/trigger layer**

Keep `market-hours.ts`, `isMarketOpen` import, `jsonResponse`, `sleep`, `withRetry`, and `getQuote` exactly as they are (lines 1–149 of the current file are untouched). Replace everything from the `type Market` declaration (current line 26) through the end of the file:

```typescript
type Market = "NSE" | "US";
type Exchange = "NSE" | "BSE" | "US";
type PositionAlertType =
  | "stop_loss_breached"
  | "trim_target_reached"
  | "time_exit_due";

type StockRow = { id: string; yahoo_symbol: string; exchange: Exchange };

type PositionRow = {
  id: string;
  ticker: string;
  stock_id: string;
  trade_plan_id: string;
};

type TradePlanRow = {
  id: string;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  time_exit_date: string | null;
};

type PositionAlertEvent =
  | { type: "stop_loss_breached"; details: { price: number; stop_loss: number } }
  | {
      type: "trim_target_reached";
      details: { price: number; tier: "target_1" | "target_2"; tier_price: number };
    }
  | { type: "time_exit_due"; details: { time_exit_date: string } };

/**
 * Deno-local transcription of the v1 trigger-evaluation shape, retargeted at
 * `trade_plans`. A position is, by definition, already entered — so unlike
 * v1's `alert_criteria` (which watched both not-yet-bought watchlist stocks
 * AND holdings), this only ever evaluates exit-side conditions: stop,
 * either fixed target tier, and the time-exit date. Entry-zone/recommendation
 * status (Jarvis Recommendation Tracker, spec US-22) is computed client-side
 * on page load, not here — see plan Task 16.
 */
function evaluatePositionTriggers(
  tradePlan: TradePlanRow,
  price: number,
  now: Date,
): PositionAlertEvent[] {
  const events: PositionAlertEvent[] = [];

  if (tradePlan.stop_loss !== null && price <= tradePlan.stop_loss) {
    events.push({
      type: "stop_loss_breached",
      details: { price, stop_loss: tradePlan.stop_loss },
    });
  }
  if (tradePlan.target_1 !== null && price >= tradePlan.target_1) {
    events.push({
      type: "trim_target_reached",
      details: { price, tier: "target_1", tier_price: tradePlan.target_1 },
    });
  }
  if (tradePlan.target_2 !== null && price >= tradePlan.target_2) {
    events.push({
      type: "trim_target_reached",
      details: { price, tier: "target_2", tier_price: tradePlan.target_2 },
    });
  }
  if (tradePlan.time_exit_date !== null) {
    const target = new Date(`${tradePlan.time_exit_date}T00:00:00Z`).getTime();
    const nowUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (nowUtcMidnight >= target) {
      events.push({
        type: "time_exit_due",
        details: { time_exit_date: tradePlan.time_exit_date },
      });
    }
  }

  return events;
}

/** Same 20-hour dedup window as v1 (`lib/trigger-logic.ts#isWithinDedupWindow`). */
function isWithinDedupWindow(lastTriggeredAt: string, now: Date, windowHours = 20): boolean {
  const diffMs = now.getTime() - new Date(lastTriggeredAt).getTime();
  return diffMs < windowHours * 60 * 60 * 1000;
}

// deno-lint-ignore no-explicit-any
type SupabaseClientAny = any;

/** Inserts one `position_alerts` row per event not already logged within the dedup window. */
async function logPositionAlerts(
  supabase: SupabaseClientAny,
  positionId: string,
  events: PositionAlertEvent[],
  now: Date,
): Promise<void> {
  for (const event of events) {
    const { data: existing, error: existingError } = await supabase
      .from("position_alerts")
      .select("triggered_at")
      .eq("position_id", positionId)
      .eq("alert_type", event.type)
      .order("triggered_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error(`poll-prices: dedup check failed for position ${positionId}/${event.type}`, existingError);
      continue;
    }
    if (existing && isWithinDedupWindow(existing.triggered_at, now)) {
      continue;
    }

    const { error: insertError } = await supabase.from("position_alerts").insert({
      position_id: positionId,
      alert_type: event.type,
      triggered_at: now.toISOString(),
      details: event.details,
    });
    if (insertError) {
      console.error(`poll-prices: insert failed for position ${positionId}/${event.type}`, insertError);
    }
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const marketParam = url.searchParams.get("market");

  if (marketParam !== "NSE" && marketParam !== "US") {
    return jsonResponse({ error: 'market query param must be "NSE" or "US"' }, 400);
  }
  const market: Market = marketParam;

  if (!isMarketOpen(market, new Date())) {
    return jsonResponse({ skipped: true, reason: "market closed" }, 200);
  }

  const supabase = createAdminClient();
  const exchanges: Exchange[] = market === "NSE" ? ["NSE", "BSE"] : ["US"];

  const { data: activePositions, error: positionsError } = await supabase
    .from("positions")
    .select("id, ticker, stock_id, trade_plan_id")
    .eq("status", "active");

  if (positionsError) {
    return jsonResponse({ error: positionsError.message }, 500);
  }
  const positionRows = (activePositions ?? []) as PositionRow[];
  if (positionRows.length === 0) {
    return jsonResponse({ processed: 0 }, 200);
  }

  const stockIds = [...new Set(positionRows.map((p) => p.stock_id))];
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("id, yahoo_symbol, exchange")
    .in("id", stockIds);
  if (stocksError) {
    return jsonResponse({ error: stocksError.message }, 500);
  }
  const stockById = new Map<string, StockRow>((stocks ?? []).map((s: StockRow) => [s.id, s]));

  // Only process positions whose stock trades on the exchange(s) this
  // invocation's `market` param covers — same split as v1's NSE+BSE-vs-US
  // pg_cron windows.
  const relevantPositions = positionRows.filter((p) => {
    const stock = stockById.get(p.stock_id);
    return stock !== undefined && exchanges.includes(stock.exchange);
  });
  if (relevantPositions.length === 0) {
    return jsonResponse({ processed: 0 }, 200);
  }

  const tradePlanIds = [...new Set(relevantPositions.map((p) => p.trade_plan_id))];
  const { data: tradePlans, error: tradePlansError } = await supabase
    .from("trade_plans")
    .select("id, stop_loss, target_1, target_2, time_exit_date")
    .in("id", tradePlanIds);
  if (tradePlansError) {
    return jsonResponse({ error: tradePlansError.message }, 500);
  }
  const tradePlanById = new Map<string, TradePlanRow>((tradePlans ?? []).map((t: TradePlanRow) => [t.id, t]));

  const now = new Date();
  let processed = 0;

  for (const position of relevantPositions) {
    const stock = stockById.get(position.stock_id)!;
    const tradePlan = tradePlanById.get(position.trade_plan_id);
    if (!tradePlan) continue;

    try {
      const quote = await getQuote(stock.yahoo_symbol);
      await supabase
        .from("stocks")
        .update({ last_price: quote.price, last_price_at: quote.asOf.toISOString() })
        .eq("id", stock.id);

      const events = evaluatePositionTriggers(tradePlan, quote.price, now);
      await logPositionAlerts(supabase, position.id, events, now);
      processed++;
    } catch (err) {
      // Isolation guarantee, same as v1: one position's failure must never
      // abort the rest of the batch.
      console.error(`poll-prices: failed to process position ${position.ticker} (${position.id})`, err);
    }
  }

  return jsonResponse({ processed }, 200);
});
```

- [ ] **Step 2: Update `daily-digest/index.ts`'s query layer**

Replace lines 55–94 (the `alert_log` query through `enrichedRows`) with:

```typescript
  const { data: alertRows, error: alertError } = await supabase
    .from("position_alerts")
    .select("id, position_id, alert_type, triggered_at, details")
    .is("emailed_at", null)
    .gt("triggered_at", lookbackFloor)
    .order("triggered_at", { ascending: true });

  if (alertError) {
    return jsonResponse({ error: alertError.message }, 500);
  }
  if (!alertRows || alertRows.length === 0) {
    return jsonResponse({ sent: false, reason: "no unemailed alerts" }, 200);
  }

  const positionIds = [...new Set(alertRows.map((r) => r.position_id as string))];
  const { data: positionRows, error: positionsError } = await supabase
    .from("positions")
    .select("id, ticker")
    .in("id", positionIds);
  if (positionsError) {
    return jsonResponse({ error: positionsError.message }, 500);
  }
  const tickerByPositionId = new Map<string, string>(
    (positionRows ?? []).map((p: { id: string; ticker: string }) => [p.id, p.ticker]),
  );

  const enrichedRows = alertRows.map((row) => ({
    stock_id: row.position_id as string, // `groupAlertsByStock` groups on this key name; semantics is now "position"
    ticker: tickerByPositionId.get(row.position_id as string) ?? "UNKNOWN",
    trigger_type: row.alert_type as string,
    triggered_at: row.triggered_at as string,
    details: row.details,
  }));
```

Then update the two remaining `.from("alert_log")` references later in the same file: the `emailed_at` batch-update block's `.from("alert_log")` (current line 132) becomes `.from("position_alerts")`.

- [ ] **Step 3: Update `email-template.ts`'s `TRIGGER_LABELS` map (lines 15–22)**

```typescript
const TRIGGER_LABELS: Record<string, string> = {
  stop_loss_breached: "STOP LOSS BREACHED",
  trim_target_reached: "TRIM TARGET",
  time_exit_due: "TIME EXIT DUE",
};
```

- [ ] **Step 4: Redeploy both functions**

Run: `mcp__claude_ai_Supabase__deploy_edge_function` for `poll-prices` and `daily-digest` (or `supabase functions deploy poll-prices daily-digest` via the CLI).

- [ ] **Step 5: Smoke-test against the live project**

Run: `curl -X POST "https://qwlugjxsgfgobiytpynm.supabase.co/functions/v1/poll-prices?market=NSE" -H "Authorization: Bearer $SERVICE_ROLE_KEY"` — expect `{"processed":0}` (no positions exist yet, correct until Task 14 ships) rather than a 500 referencing a dropped table.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add supabase/functions/poll-prices supabase/functions/daily-digest
/usr/bin/git commit -m "fix: repoint poll-prices/daily-digest at the v2 trade_plans/positions schema"
```

---

### Task 6: App shell — sidebar nav + New-Thesis drawer + shared empty/loading/error states

**Files:**
- Modify: `app/(app)/layout.tsx` (full rewrite — adds the sidebar + drawer around `children`)
- Create: `components/layout/app-sidebar.tsx`
- Create: `components/layout/new-thesis-drawer.tsx`
- Create: `components/layout/new-thesis-context.tsx`
- Create: `components/shared/empty-state.tsx`
- Create: `components/shared/skeleton-loader.tsx`
- Create: `components/shared/price-badge.tsx`

**Interfaces:**
- Produces: `<AppSidebar />` (persistent nav, ≥1280px per spec's Navigation rule), `useNewThesisDrawer()` hook (`{ open: () => void }`) consumed by every screen's "New Thesis" affordance, `<EmptyState title description />`, `<SkeletonLoader lines={n} />` (amber pulsing per spec's Loading States rule), `<PriceBadge price={number|null} />` (renders "Price unavailable" amber badge when `null`, per spec's Error Handling rule). Task 10 (Thesis Input) fills in the drawer's actual content — this task only builds the shell + open/close plumbing.

- [ ] **Step 1: Build the shared state components**

```typescript
// components/shared/empty-state.tsx
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-surface-container-low px-6 py-16 text-center">
      <p className="font-display text-lg text-on-surface">{title}</p>
      <p className="max-w-sm text-sm text-on-surface/60">{description}</p>
      {action}
    </div>
  );
}
```

```typescript
// components/shared/skeleton-loader.tsx
import { cn } from "@/lib/utils";

/** Amber pulsing skeleton per spec's Loading States rule — never a bare spinner on white. */
export function SkeletonLoader({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-md bg-primary/15"
          style={{ width: `${85 - i * 12}%` }}
        />
      ))}
    </div>
  );
}
```

```typescript
// components/shared/price-badge.tsx
import { formatCurrency } from "@/lib/format";
import type { ExchangeCode } from "@/lib/types";

/** Renders a price, or the spec's "Price unavailable" amber badge when null. */
export function PriceBadge({
  price,
  exchange,
}: {
  price: number | null;
  exchange: ExchangeCode;
}) {
  if (price === null) {
    return (
      <span className="rounded-full bg-primary-container px-2 py-0.5 text-xs font-medium text-primary">
        Price unavailable
      </span>
    );
  }
  return <span className="font-mono tabular-nums">{formatCurrency(price, exchange)}</span>;
}
```

- [ ] **Step 2: Build the New Thesis drawer context**

```typescript
// components/layout/new-thesis-context.tsx
"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type NewThesisContextValue = {
  isOpen: boolean;
  open: (prefillTicker?: string) => void;
  close: () => void;
  prefillTicker: string | undefined;
};

const NewThesisContext = createContext<NewThesisContextValue | null>(null);

export function NewThesisProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefillTicker, setPrefillTicker] = useState<string | undefined>(undefined);

  return (
    <NewThesisContext.Provider
      value={{
        isOpen,
        open: (ticker) => {
          setPrefillTicker(ticker);
          setIsOpen(true);
        },
        close: () => setIsOpen(false),
        prefillTicker,
      }}
    >
      {children}
    </NewThesisContext.Provider>
  );
}

/** Consumed by any screen's "New Thesis" / "+" affordance (spec's global rule: accessible from every screen without navigating away). */
export function useNewThesisDrawer(): NewThesisContextValue {
  const ctx = useContext(NewThesisContext);
  if (!ctx) {
    throw new Error("useNewThesisDrawer must be used within NewThesisProvider");
  }
  return ctx;
}
```

- [ ] **Step 3: Build the sidebar**

```typescript
// components/layout/app-sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Wallet,
  FlaskConical,
  Radio,
  BookOpen,
  Compass,
  ListChecks,
  Plus,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useNewThesisDrawer } from "./new-thesis-context";

const NAV_ITEMS = [
  { href: "/", label: "Cockpit", icon: LayoutDashboard },
  { href: "/positions", label: "Active Positions", icon: Wallet },
  { href: "/thesis", label: "Stress Test & Plan", icon: FlaskConical },
  { href: "/feed", label: "Intelligence Feed", icon: Radio },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/discovery", label: "Discovery", icon: Compass },
  { href: "/recommendations", label: "Recommendation Tracker", icon: ListChecks },
] as const;

/** Persistent left sidebar, ≥1280px (spec Navigation rule). Hidden below that width — no mobile nav is in scope. */
export function AppSidebar() {
  const pathname = usePathname();
  const { open } = useNewThesisDrawer();

  return (
    <nav className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-1 bg-surface-container-lowest px-3 py-6 xl:flex">
      <div className="mb-6 px-3 font-display text-lg font-semibold text-on-surface">
        Jarvis
      </div>

      <button
        type="button"
        onClick={() => open()}
        className="mb-4 flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
      >
        <Plus className="size-4" />
        New Thesis
      </button>

      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
              active
                ? "bg-surface-container-high text-primary"
                : "text-on-surface/70 hover:bg-surface-container-low hover:text-on-surface",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Build the drawer shell (content wired in Task 10)**

```typescript
// components/layout/new-thesis-drawer.tsx
"use client";

import { X } from "lucide-react";
import { useNewThesisDrawer } from "./new-thesis-context";
import { ThesisInputForm } from "@/components/thesis/thesis-input-form";

/** Slide-out from the right, per spec's recommended pattern — renders Screen 1 inline so the user never loses their current page context. */
export function NewThesisDrawer() {
  const { isOpen, close, prefillTicker } = useNewThesisDrawer();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-surface-container-low p-6 shadow-ambient">
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 rounded-full p-1.5 text-on-surface/60 hover:text-on-surface"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
        <ThesisInputForm prefillTicker={prefillTicker} onSaved={close} />
      </div>
    </div>
  );
}
```

Note: `components/thesis/thesis-input-form.tsx` doesn't exist yet — it's built in Task 10. This task's build will not compile until Task 10 lands; that's expected and acceptable since Tasks 6–10 execute in sequence within the same phase (unlike Tasks 1–5, which each independently keep `tsc`/`vitest` green, Task 6 is the one deliberate exception — its Step 6 verification below is scoped to "the sidebar/drawer-shell renders," not a full typecheck).

- [ ] **Step 5: Wire it into the app layout**

```typescript
// app/(app)/layout.tsx
import type { ReactNode } from "react";

import { logout } from "@/app/(auth)/login/actions";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NewThesisDrawer } from "@/components/layout/new-thesis-drawer";
import { NewThesisProvider } from "@/components/layout/new-thesis-context";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <NewThesisProvider>
      <AppSidebar />
      <main className="min-h-screen xl:pl-60">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
      <NewThesisDrawer />
      <form action={logout} className="fixed right-4 bottom-4 z-40">
        <button
          type="submit"
          className="rounded-xl bg-surface-container-highest px-3 py-1.5 text-xs font-medium text-on-surface/70 transition-colors hover:text-on-surface"
        >
          Log out
        </button>
      </form>
    </NewThesisProvider>
  );
}
```

- [ ] **Step 6: Verify what can be verified before Task 10 lands**

Run: `npx tsc --noEmit` — expected to fail ONLY on the missing `@/components/thesis/thesis-input-form` import (confirm the error message names exactly that path and nothing else new). Everything else introduced by this task (`app-sidebar.tsx`, `new-thesis-context.tsx`, `empty-state.tsx`, `skeleton-loader.tsx`, `price-badge.tsx`) must type-check clean on its own.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add app/\(app\)/layout.tsx components/layout components/shared
/usr/bin/git commit -m "feat: rebuild app shell with persistent sidebar nav and New Thesis drawer"
```

---

## Phase 1 — P0

### Task 7: Jarvis thesis prompt v2 (3-mode)

**Files:**
- Create: `lib/jarvis-thesis-prompt.ts`
- Create: `lib/ticker-heuristic.ts`
- Test: `lib/__tests__/ticker-heuristic.test.ts`

**Interfaces:**
- Produces: `JARVIS_THESIS_SYSTEM_PROMPT: string`, `buildJarvisThesisUserContext(input: BuildThesisContextInput): string`, `extractPossibleTicker(inputText: string): string | null` — consumed by Task 9's `POST /api/theses`.

**Design note (mode detection):** the spec says "The AI infers the mode from the input and handles it" — this plan takes that literally: mode classification and thesis structuring happen in **one** LLM call, not a separate classifier pass. What happens *before* that call is a heuristic, regex-only guess at whether the input names a resolvable ticker (`extractPossibleTicker`) — used only to decide whether to spend a Yahoo lookup fetching live price/fundamentals context to hand the model. If the heuristic finds nothing, or the lookup fails, the model still runs — it just reasons over the raw text with no live market data attached, which is the correct degrade-gracefully behavior for genuine Mode 2 (thesis-only) input. The model's own `mode`/`ticker` fields in its structured output are authoritative; the heuristic is only a context-fetching optimization, never the final answer.

- [ ] **Step 1: Write the ticker heuristic test**

```typescript
// lib/__tests__/ticker-heuristic.test.ts
import { describe, expect, it } from "vitest";
import { extractPossibleTicker } from "@/lib/ticker-heuristic";

describe("extractPossibleTicker", () => {
  it("finds a plain all-caps ticker token", () => {
    expect(extractPossibleTicker("AAPL looks cheap here")).toBe("AAPL");
  });

  it("finds a hyphenated ticker token", () => {
    expect(extractPossibleTicker("BAJAJ-AUTO — EV buyback at 26x looks cheap")).toBe(
      "BAJAJ-AUTO",
    );
  });

  it("returns null for pure macro text with no ticker-shaped token", () => {
    expect(
      extractPossibleTicker("I think Indian IT is bottoming due to AI tailwinds"),
    ).toBe(null);
  });

  it("ignores common short all-caps words that are not tickers", () => {
    expect(extractPossibleTicker("I think EV demand in the US is rising")).toBe(null);
  });

  it("returns null for empty input", () => {
    expect(extractPossibleTicker("")).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/ticker-heuristic.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ticker-heuristic'`

- [ ] **Step 3: Implement the heuristic**

```typescript
// lib/ticker-heuristic.ts

/**
 * Words that match the ticker-shaped regex below but are near-certainly NOT
 * a ticker in this app's actual usage (common short macro/finance
 * abbreviations the spec's own examples use in plain prose: "Indian IT",
 * "AI tailwinds", "US demand", "EV buyback" naming a theme rather than the
 * literal ticker "EV"). Deliberately short and conservative — a false
 * negative here just means the model runs without live price context, which
 * degrades gracefully; a false positive would attempt (and fail) a live
 * Yahoo lookup on every mention of a macro theme.
 */
const NOT_A_TICKER = new Set([
  "I", "A", "IT", "AI", "US", "EV", "PE", "IPO", "GDP", "CPI", "FED", "RBI",
]);

/**
 * Best-effort, regex-only guess at a ticker-shaped token in free text:
 * 2-10 uppercase letters, optionally with a single hyphenated suffix (e.g.
 * `BAJAJ-AUTO`). Returns the FIRST such token found that isn't in
 * `NOT_A_TICKER`, or `null` if none. This is a context-fetching heuristic
 * only, never validated against a real ticker database here — the caller
 * (Task 9's route) is responsible for confirming it resolves via
 * `lib/market-data.ts` before treating it as real.
 */
export function extractPossibleTicker(inputText: string): string | null {
  const matches = inputText.match(/\b[A-Z]{2,10}(?:-[A-Z]{2,10})?\b/g);
  if (!matches) return null;

  for (const match of matches) {
    if (!NOT_A_TICKER.has(match)) {
      return match;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/ticker-heuristic.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Write the thesis prompt module**

```typescript
// lib/jarvis-thesis-prompt.ts

/**
 * v2 system prompt: replaces the v1 5-step narrative workflow
 * (`lib/jarvis-prompt.ts`, deleted in Task 3) with the spec's 6-field
 * structured thesis and explicit 3-mode handling (spec Section 2). Stress
 * test (bear cases + counters) is intentionally NOT part of this prompt —
 * that's a separate, later call (Task 17's `JARVIS_STRESS_TEST_SYSTEM_PROMPT`),
 * matching the spec's own two-step wizard (Screen 1 produces the thesis;
 * Screen 2-3 Step 2 produces the stress test only after the user approves
 * the thesis).
 */
export const JARVIS_THESIS_SYSTEM_PROMPT = `You are Jarvis, a high-performance trading decision system for a discretionary trader.
You are direct, not polite. You challenge weak thinking and do NOT validate bad ideas.

You will receive one raw piece of free text from the user. It is EXACTLY ONE of three modes,
and you must determine which:

MODE "stock_only": the text names a stock (ticker or company name) with no explicit
  market view or reasoning attached — e.g. "BAJAJ-AUTO" or "Bajaj Auto".
MODE "thesis_only": the text expresses a market/macro view with no specific stock named —
  e.g. "I think Indian IT is bottoming due to AI tailwinds".
MODE "stock_plus_thesis": the text names a stock AND gives reasoning — e.g.
  "Bajaj Auto — EV buyback at 26x looks cheap vs TVS at 56x".

You may also receive live price/fundamentals context for a stock the system has already
resolved from the text — if present, treat it as ground truth market state and use it. If
absent, reason from the text alone; do not invent price data.

STEP 1 — Determine the mode.

STEP 2 — Structure a thesis with exactly six fields:
- Market View: what the market currently believes.
- Mispricing: why that view is wrong (if it is) and what it's missing.
- Catalyst: what will close the gap.
- Time Horizon: the expected timeframe, in plain words (e.g. "3-6 months").
- Invalidation: the specific condition that would prove this thesis wrong.
- Conviction Tier: "I" (highest) through "IV" (lowest), plus a 0-100 Conviction Score.
For MODE "stock_only" with no reasoning given, still produce your own honest best-effort
thesis for that stock using whatever context is available — do not leave fields empty.

STEP 3 — ONLY if mode is "thesis_only": after the thesis, suggest 2-3 specific stocks
(ticker + one-sentence fit rationale each) that would express this macro thesis. If mode is
NOT "thesis_only", this step is skipped and the JSON's "stock_suggestions" array must be empty.

OUTPUT FORMAT (strict):
Write full narrative prose, clearly headed "## Market View", "## Mispricing", "## Catalyst",
"## Time Horizon", "## Invalidation", in that order. Do not add a heading for Conviction Tier —
that's carried only in the trailing JSON block.

Then, after ALL narrative sections, output exactly one fenced code block using json as the
fence's info string, containing ONE consolidated JSON object and NOTHING else in that block,
matching this exact shape (use null for any field you cannot responsibly determine):

{
  "mode": "stock_only" | "thesis_only" | "stock_plus_thesis",
  "ticker": string | null,
  "market_view": string,
  "mispricing": string,
  "catalyst": string,
  "time_horizon": string,
  "invalidation_condition": string,
  "conviction_tier": "I" | "II" | "III" | "IV",
  "conviction_score": number,
  "stock_suggestions": [ { "ticker": string, "rationale": string } ]
}

This JSON block is parsed programmatically; it must be valid JSON with no trailing commas, no
comments, and no text before or after it inside the code fence.`;

type MarketContext = {
  yahooSymbol: string;
  exchange: string;
  price: number;
  priceAsOf: Date;
  fundamentals: Record<string, string | number>;
};

export type BuildThesisContextInput = {
  inputText: string;
  marketContext?: MarketContext;
};

/**
 * Formats the user-turn message: the raw input verbatim, plus an optional
 * "Resolved stock context" block when Task 9's route successfully resolved
 * a ticker via `extractPossibleTicker` + a live Yahoo lookup.
 */
export function buildJarvisThesisUserContext(input: BuildThesisContextInput): string {
  const lines: string[] = [];

  lines.push("User input:");
  lines.push(input.inputText);

  if (input.marketContext) {
    const mc = input.marketContext;
    lines.push("");
    lines.push(`Resolved stock context: ${mc.yahooSymbol} (${mc.exchange})`);
    lines.push(`Current price: ${mc.price} as of ${mc.priceAsOf.toISOString()}`);
    const fundamentalsEntries = Object.entries(mc.fundamentals);
    if (fundamentalsEntries.length > 0) {
      lines.push("Fundamentals:");
      for (const [key, value] of fundamentalsEntries) {
        lines.push(`${key}: ${value}`);
      }
    }
  }

  lines.push("");
  lines.push(
    "Determine the mode, then structure the thesis following your standard workflow.",
  );

  return lines.join("\n");
}
```

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add lib/jarvis-thesis-prompt.ts lib/ticker-heuristic.ts lib/__tests__/ticker-heuristic.test.ts
/usr/bin/git commit -m "feat: v2 Jarvis thesis prompt with 3-mode detection + ticker heuristic"
```

---

### Task 8: Jarvis thesis parser v2

**Files:**
- Create: `lib/jarvis-thesis-parser.ts`
- Test: `lib/__tests__/jarvis-thesis-parser.test.ts`

**Interfaces:**
- Consumes: nothing (pure string parsing, same shape as the deleted v1 `lib/jarvis-parser.ts`)
- Produces: `ThesisExtractSchema` (zod), `ThesisExtract` (type), `parseThesisResponse(raw: string): ParsedThesisResponse` — never throws, matching v1's contract exactly. Consumed by Task 9's `POST /api/theses`.

- [ ] **Step 1: Write the parser test**

```typescript
// lib/__tests__/jarvis-thesis-parser.test.ts
import { describe, expect, it } from "vitest";
import { parseThesisResponse } from "@/lib/jarvis-thesis-parser";

const VALID_RESPONSE = `## Market View
The market believes X.

## Mispricing
The market is wrong because Y.

## Catalyst
Z will close the gap.

## Time Horizon
3-6 months.

## Invalidation
If A happens, thesis is dead.

\`\`\`json
{
  "mode": "stock_plus_thesis",
  "ticker": "BAJAJ-AUTO",
  "market_view": "The market believes X.",
  "mispricing": "The market is wrong because Y.",
  "catalyst": "Z will close the gap.",
  "time_horizon": "3-6 months",
  "invalidation_condition": "If A happens, thesis is dead.",
  "conviction_tier": "II",
  "conviction_score": 72,
  "stock_suggestions": []
}
\`\`\``;

describe("parseThesisResponse", () => {
  it("extracts all 5 narrative sections and validates the trailing JSON", () => {
    const result = parseThesisResponse(VALID_RESPONSE);
    expect(result.sections.marketView).toContain("The market believes X.");
    expect(result.sections.invalidation).toContain("thesis is dead.");
    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.ticker).toBe("BAJAJ-AUTO");
      expect(result.extraction.data.conviction_tier).toBe("II");
    }
  });

  it("returns ok:false with the raw response preserved when no json fence is present", () => {
    const result = parseThesisResponse("## Market View\nSome text with no JSON block.");
    expect(result.extraction.ok).toBe(false);
    expect(result.sections.marketView).toContain("Some text with no JSON block.");
  });

  it("returns ok:false when the JSON fails schema validation", () => {
    const result = parseThesisResponse('```json\n{"mode": "bogus"}\n```');
    expect(result.extraction.ok).toBe(false);
  });

  it("never throws on garbage input", () => {
    expect(() => parseThesisResponse("")).not.toThrow();
    expect(() => parseThesisResponse("```json\n{not valid json\n```")).not.toThrow();
  });

  it("accepts a thesis_only mode with populated stock_suggestions", () => {
    const raw = VALID_RESPONSE.replace(
      /"mode": "stock_plus_thesis",\n  "ticker": "BAJAJ-AUTO",/,
      '"mode": "thesis_only",\n  "ticker": null,',
    ).replace(
      '"stock_suggestions": []',
      '"stock_suggestions": [{"ticker": "TCS", "rationale": "Direct IT bottoming exposure"}]',
    );
    const result = parseThesisResponse(raw);
    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.stock_suggestions).toHaveLength(1);
      expect(result.extraction.data.ticker).toBe(null);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/jarvis-thesis-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the parser**

```typescript
// lib/jarvis-thesis-parser.ts
import { z } from "zod";

/**
 * Parses raw Jarvis output for `JARVIS_THESIS_SYSTEM_PROMPT`
 * (`lib/jarvis-thesis-prompt.ts`) into 5 narrative sections plus the
 * trailing structured JSON. Same "never throws" contract as the deleted v1
 * `lib/jarvis-parser.ts` — every failure mode degrades to `extraction.ok:
 * false` with the raw text preserved, since Task 9's caller always needs to
 * persist `raw` regardless of whether extraction succeeded.
 */

export const ThesisExtractSchema = z.object({
  mode: z.enum(["stock_only", "thesis_only", "stock_plus_thesis"]),
  ticker: z.string().nullable(),
  market_view: z.string(),
  mispricing: z.string(),
  catalyst: z.string(),
  time_horizon: z.string(),
  invalidation_condition: z.string(),
  conviction_tier: z.enum(["I", "II", "III", "IV"]),
  conviction_score: z.number().min(0).max(100),
  stock_suggestions: z.array(
    z.object({ ticker: z.string(), rationale: z.string() }),
  ),
});

export type ThesisExtract = z.infer<typeof ThesisExtractSchema>;

const JSON_FENCE_REGEX = /```json\s*([\s\S]*?)```/g;

/** Same "last matching fence wins" logic as v1 — see `lib/jarvis-parser.ts`'s deleted comment for the full rationale. */
export function extractTrailingJsonBlock(raw: string): unknown | null {
  let matches: RegExpMatchArray[];
  try {
    matches = [...raw.matchAll(JSON_FENCE_REGEX)];
  } catch {
    return null;
  }
  if (matches.length === 0) return null;

  const jsonText = matches[matches.length - 1][1];
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export type ThesisSections = {
  marketView: string;
  mispricing: string;
  catalyst: string;
  timeHorizon: string;
  invalidation: string;
};

const SECTION_HEADERS: { key: keyof ThesisSections; header: string }[] = [
  { key: "marketView", header: "## Market View" },
  { key: "mispricing", header: "## Mispricing" },
  { key: "catalyst", header: "## Catalyst" },
  { key: "timeHorizon", header: "## Time Horizon" },
  { key: "invalidation", header: "## Invalidation" },
];

const EMPTY_SECTIONS: ThesisSections = {
  marketView: "",
  mispricing: "",
  catalyst: "",
  timeHorizon: "",
  invalidation: "",
};

function splitThesisSections(raw: string): ThesisSections {
  const sections: ThesisSections = { ...EMPTY_SECTIONS };
  const found: { key: keyof ThesisSections; start: number; end: number }[] = [];
  let searchFrom = 0;

  for (const { key, header } of SECTION_HEADERS) {
    const idx = raw.indexOf(header, searchFrom);
    if (idx === -1) continue;
    found.push({ key, start: idx, end: idx + header.length });
    searchFrom = idx + header.length;
  }

  for (let i = 0; i < found.length; i++) {
    const current = found[i];
    const next = found[i + 1];
    const sliceEnd = next ? next.start : raw.length;
    sections[current.key] = raw.slice(current.end, sliceEnd).trim();
  }

  return sections;
}

export type ThesisExtraction =
  | { ok: true; data: ThesisExtract }
  | { ok: false; rawJson: unknown | null; error: string };

export type ParsedThesisResponse = {
  sections: ThesisSections;
  extraction: ThesisExtraction;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function parseThesisResponse(raw: string): ParsedThesisResponse {
  try {
    const sections = splitThesisSections(raw);
    const rawJson = extractTrailingJsonBlock(raw);

    if (rawJson === null) {
      return {
        sections,
        extraction: { ok: false, rawJson: null, error: "No valid ```json code block found in the response." },
      };
    }

    const result = ThesisExtractSchema.safeParse(rawJson);
    if (!result.success) {
      return {
        sections,
        extraction: { ok: false, rawJson, error: `JSON block failed schema validation: ${result.error.message}` },
      };
    }

    return { sections, extraction: { ok: true, data: result.data } };
  } catch (err) {
    return {
      sections: { ...EMPTY_SECTIONS },
      extraction: {
        ok: false,
        rawJson: null,
        error: `Unexpected error while parsing thesis response: ${errorMessage(err)}`,
      },
    };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/jarvis-thesis-parser.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add lib/jarvis-thesis-parser.ts lib/__tests__/jarvis-thesis-parser.test.ts
/usr/bin/git commit -m "feat: v2 Jarvis thesis parser (6-field extraction, never throws)"
```

---

### Task 9: `POST /api/theses`

**Files:**
- Create: `app/api/theses/route.ts`
- Test: `app/api/theses/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `extractPossibleTicker` (Task 7), `buildJarvisThesisUserContext`/`JARVIS_THESIS_SYSTEM_PROMPT` (Task 7), `parseThesisResponse` (Task 8), `getQuote`/`getFundamentals`/`resolveYahooSymbol` (`@/lib/market-data`, unchanged), `jarvisModel`/`JARVIS_MODEL_ID` (`@/lib/llm/openrouter`, unchanged), `createAdminClient` (unchanged)
- Produces: `POST /api/theses` (body `{ input_text: string }` → `201 { thesis: Thesis; duplicateWarning: { existingThesisId: string; status: string; createdAt: string } | null }`). Consumed by Task 10's Thesis Input screen.

- [ ] **Step 1: Write the route test**

```typescript
// app/api/theses/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn().mockRejectedValue(new Error("not found")),
  getFundamentals: vi.fn().mockResolvedValue({}),
  resolveYahooSymbol: (ticker: string, exchange: string) =>
    exchange === "NSE" ? `${ticker}.NS` : ticker,
}));
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { generateText } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildSupabaseMock(opts: { existingTheses?: unknown[] } = {}) {
  const insertedThesis = { id: "thesis-1", status: "draft" };
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "theses") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: opts.existingTheses ?? [],
                  error: null,
                }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: insertedThesis, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const RAW_RESPONSE = `## Market View
V

## Mispricing
M

## Catalyst
C

## Time Horizon
T

## Invalidation
I

\`\`\`json
{"mode":"thesis_only","ticker":null,"market_view":"V","mispricing":"M","catalyst":"C","time_horizon":"T","invalidation_condition":"I","conviction_tier":"II","conviction_score":60,"stock_suggestions":[]}
\`\`\``;

describe("POST /api/theses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an empty input_text", async () => {
    const req = new Request("http://test/api/theses", {
      method: "POST",
      body: JSON.stringify({ input_text: "" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("generates and persists a thesis, no duplicate warning when none exists", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildSupabaseMock() as never);
    vi.mocked(generateText).mockResolvedValue({ text: RAW_RESPONSE } as never);

    const req = new Request("http://test/api/theses", {
      method: "POST",
      body: JSON.stringify({ input_text: "I think Indian IT is bottoming" }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.thesis.id).toBe("thesis-1");
    expect(body.duplicateWarning).toBe(null);
  });

  it("surfaces a duplicateWarning when an existing thesis matches the resolved ticker", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({
        existingTheses: [{ id: "thesis-old", status: "active", created_at: "2026-06-01T00:00:00Z" }],
      }) as never,
    );
    vi.mocked(generateText).mockResolvedValue({
      text: RAW_RESPONSE.replace('"ticker":null', '"ticker":"TCS"'),
    } as never);

    const req = new Request("http://test/api/theses", {
      method: "POST",
      body: JSON.stringify({ input_text: "TCS looks interesting" }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.duplicateWarning?.existingThesisId).toBe("thesis-old");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/theses/__tests__/route.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the route**

```typescript
// app/api/theses/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import { extractPossibleTicker } from "@/lib/ticker-heuristic";
import {
  buildJarvisThesisUserContext,
  JARVIS_THESIS_SYSTEM_PROMPT,
} from "@/lib/jarvis-thesis-prompt";
import { parseThesisResponse } from "@/lib/jarvis-thesis-parser";
import { jarvisModel } from "@/lib/llm/openrouter";
import { getFundamentals, getQuote, resolveYahooSymbol } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExchangeCode, Json, ThesisInsert } from "@/lib/types";

export const maxDuration = 60;

const CreateThesisInputSchema = z.object({
  input_text: z.string().trim().min(1, "input_text is required"),
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tries NSE then US for a heuristically-extracted ticker token (see
 * `lib/ticker-heuristic.ts`'s module comment — this app has no real
 * exchange-detection signal, so it just tries both in a fixed order and
 * keeps whichever resolves first). Returns `null` if neither resolves,
 * which is the expected, non-error outcome for genuine Mode 2 input.
 */
async function tryResolveTicker(
  ticker: string,
): Promise<{ exchange: ExchangeCode; yahooSymbol: string; price: number; priceAsOf: Date; fundamentals: Record<string, string | number> } | null> {
  for (const exchange of ["NSE", "US"] as const) {
    const yahooSymbol = resolveYahooSymbol(ticker, exchange);
    try {
      const [quote, fundamentals] = await Promise.all([
        getQuote(yahooSymbol),
        getFundamentals(yahooSymbol).catch(() => ({})),
      ]);
      return { exchange, yahooSymbol, price: quote.price, priceAsOf: quote.asOf, fundamentals };
    } catch {
      continue;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedInput = CreateThesisInputSchema.safeParse(json);
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsedInput.error.flatten() },
      { status: 400 },
    );
  }
  const { input_text } = parsedInput.data;

  const supabase = createAdminClient();

  // Heuristic resolution — a context-fetching optimization, not the final
  // mode/ticker answer (see Task 7's design note).
  const heuristicTicker = extractPossibleTicker(input_text);
  const resolved = heuristicTicker ? await tryResolveTicker(heuristicTicker) : null;

  let stockId: string | null = null;
  if (resolved) {
    const { data: existingStock } = await supabase
      .from("stocks")
      .select("id")
      .eq("yahoo_symbol", resolved.yahooSymbol)
      .maybeSingle();

    if (existingStock) {
      stockId = existingStock.id;
    } else {
      const { data: newStock, error: stockInsertError } = await supabase
        .from("stocks")
        .insert({
          ticker: heuristicTicker!,
          yahoo_symbol: resolved.yahooSymbol,
          exchange: resolved.exchange,
          last_price: resolved.price,
          last_price_at: resolved.priceAsOf.toISOString(),
        })
        .select("id")
        .single();
      if (stockInsertError || !newStock) {
        return NextResponse.json(
          { error: stockInsertError?.message ?? "Failed to create stock row" },
          { status: 500 },
        );
      }
      stockId = newStock.id;
    }
  }

  const userContext = buildJarvisThesisUserContext({
    inputText: input_text,
    marketContext: resolved
      ? {
          yahooSymbol: resolved.yahooSymbol,
          exchange: resolved.exchange,
          price: resolved.price,
          priceAsOf: resolved.priceAsOf,
          fundamentals: resolved.fundamentals,
        }
      : undefined,
  });

  let rawResponse: string;
  try {
    const result = await generateText({
      model: jarvisModel,
      system: JARVIS_THESIS_SYSTEM_PROMPT,
      prompt: userContext,
    });
    rawResponse = result.text;
  } catch (err) {
    return NextResponse.json(
      { error: `Jarvis model call failed: ${errorMessage(err)}` },
      { status: 502 },
    );
  }
  if (!rawResponse) {
    return NextResponse.json({ error: "Jarvis returned an empty response" }, { status: 502 });
  }

  const parsed = parseThesisResponse(rawResponse);
  const extractedTicker = parsed.extraction.ok ? parsed.extraction.data.ticker : heuristicTicker;

  // US-10 duplicate-thesis warning — informational only, never blocks.
  let duplicateWarning: { existingThesisId: string; status: string; createdAt: string } | null = null;
  if (extractedTicker) {
    const { data: existingTheses } = await supabase
      .from("theses")
      .select("id, status, created_at")
      .eq("ticker", extractedTicker)
      .order("created_at", { ascending: false })
      .limit(1);
    const existing = existingTheses?.[0];
    if (existing) {
      duplicateWarning = {
        existingThesisId: existing.id,
        status: existing.status,
        createdAt: existing.created_at,
      };
    }
  }

  const insert: ThesisInsert = {
    input_text,
    mode: parsed.extraction.ok ? parsed.extraction.data.mode : "thesis_only",
    stock_id: stockId,
    ticker: extractedTicker,
    market_view: parsed.extraction.ok ? parsed.extraction.data.market_view : parsed.sections.marketView || null,
    mispricing: parsed.extraction.ok ? parsed.extraction.data.mispricing : parsed.sections.mispricing || null,
    catalyst: parsed.extraction.ok ? parsed.extraction.data.catalyst : parsed.sections.catalyst || null,
    time_horizon: parsed.extraction.ok ? parsed.extraction.data.time_horizon : parsed.sections.timeHorizon || null,
    invalidation_condition: parsed.extraction.ok
      ? parsed.extraction.data.invalidation_condition
      : parsed.sections.invalidation || null,
    conviction_tier: parsed.extraction.ok ? parsed.extraction.data.conviction_tier : null,
    conviction_score: parsed.extraction.ok ? parsed.extraction.data.conviction_score : null,
    status: "draft",
    raw_llm_response: rawResponse,
  };

  const { data: insertedThesis, error: insertError } = await supabase
    .from("theses")
    .insert(insert)
    .select("*")
    .single();

  if (insertError || !insertedThesis) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to insert thesis row" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      thesis: insertedThesis,
      stockSuggestions: parsed.extraction.ok ? parsed.extraction.data.stock_suggestions : [],
      duplicateWarning,
    },
    { status: 201 },
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/theses/__tests__/route.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/api/theses
/usr/bin/git commit -m "feat: POST /api/theses — 3-mode Jarvis thesis generation + duplicate check"
```

---

### Task 10: Screen 1 — Thesis Input

**Files:**
- Create: `components/thesis/thesis-input-form.tsx`
- Create: `components/thesis/conviction-badge.tsx`
- Create: `app/(app)/thesis/new/page.tsx` (full-page variant, same form — spec's Screen 1 is also reachable as its own page from Discovery's "Explore" CTA, Task 29)

**Interfaces:**
- Consumes: `POST /api/theses` (Task 9)
- Produces: `<ThesisInputForm prefillTicker? onSaved? />` — used by both the drawer (Task 6) and the standalone page. `<ConvictionBadge tier="I"|"II"|"III"|"IV" />` reused by every later screen that shows a thesis's tier (Tasks 13, 16, 20, 21).

- [ ] **Step 1: Build the conviction badge**

```typescript
// components/thesis/conviction-badge.tsx
import { cn } from "@/lib/utils";
import type { ConvictionTier } from "@/lib/types";

/** Tier I: gold/primary. Tier II: amber (dimmer primary). Tier III: blue. Tier IV: grey — per spec US-09. */
const TIER_STYLES: Record<ConvictionTier, string> = {
  I: "bg-primary text-on-primary",
  II: "bg-primary/25 text-primary",
  III: "bg-status-blue-container text-status-blue",
  IV: "bg-surface-container-highest text-on-surface/60",
};

export function ConvictionBadge({ tier }: { tier: ConvictionTier }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 font-display text-xs font-semibold tracking-wide",
        TIER_STYLES[tier],
      )}
    >
      TIER {tier}
    </span>
  );
}
```

- [ ] **Step 2: Build the form**

```typescript
// components/thesis/thesis-input-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConvictionBadge } from "./conviction-badge";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import type { ConvictionTier, ThesisMode } from "@/lib/types";

type ThesisResult = {
  thesis: {
    id: string;
    mode: ThesisMode;
    ticker: string | null;
    market_view: string | null;
    mispricing: string | null;
    catalyst: string | null;
    time_horizon: string | null;
    invalidation_condition: string | null;
    conviction_tier: ConvictionTier | null;
    conviction_score: number | null;
  };
  stockSuggestions: { ticker: string; rationale: string }[];
  duplicateWarning: { existingThesisId: string; status: string; createdAt: string } | null;
};

const FIELD_LABELS: { key: keyof ThesisResult["thesis"]; label: string }[] = [
  { key: "market_view", label: "Market View" },
  { key: "mispricing", label: "Mispricing" },
  { key: "catalyst", label: "Catalyst" },
  { key: "time_horizon", label: "Time Horizon" },
  { key: "invalidation_condition", label: "Invalidation" },
];

/**
 * Screen 1 (spec US-09/US-10). Single free-text input, no dropdowns, no
 * mandatory fields — mode is entirely inferred server-side by Task 9's
 * route. Used both as the always-available drawer content (Task 6) and as
 * its own page (`app/(app)/thesis/new/page.tsx`).
 */
export function ThesisInputForm({
  prefillTicker,
  onSaved,
}: {
  prefillTicker?: string;
  onSaved?: (thesisId: string) => void;
}) {
  const router = useRouter();
  const [inputText, setInputText] = useState(prefillTicker ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ThesisResult | null>(null);

  async function handleSubmit() {
    if (!inputText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/theses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_text: inputText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Jarvis is thinking... Taking longer than usual.");
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!result) return;
    await fetch(`/api/theses/${result.thesis.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    onSaved?.(result.thesis.id);
    router.push(`/thesis/${result.thesis.id}/plan`);
  }

  function handleSaveDraft() {
    if (!result) return;
    onSaved?.(result.thesis.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Tell Jarvis your thesis. Stock name, market view, or both — however you'd say it."
          rows={4}
          className="w-full resize-none rounded-xl bg-surface-container-highest px-4 py-3 font-sans text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !inputText.trim()}
          className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "Jarvis is thinking..." : "Send to Jarvis"}
        </button>
      </div>

      {loading && <SkeletonLoader lines={5} />}

      {error && (
        <div className="rounded-xl bg-status-red-container px-4 py-3 text-sm text-status-red">
          {error} <button type="button" onClick={handleSubmit} className="underline">Retry</button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {result.duplicateWarning && (
            <div className="rounded-xl bg-status-blue-container px-4 py-3 text-sm text-status-blue">
              Existing thesis found for {result.thesis.ticker} (status: {result.duplicateWarning.status},{" "}
              {new Date(result.duplicateWarning.createdAt).toLocaleDateString()}).{" "}
              <a href={`/thesis/${result.duplicateWarning.existingThesisId}`} className="underline">
                View existing
              </a>{" "}
              — or create new anyway below.
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="font-display text-sm text-on-surface/60">
              {result.thesis.ticker ?? "No stock — Macro Thesis"}
            </span>
            {result.thesis.conviction_tier && <ConvictionBadge tier={result.thesis.conviction_tier} />}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELD_LABELS.map(({ key, label }) => (
              <div key={key} className="rounded-xl bg-surface-container-low p-4">
                <p className="mb-1 font-display text-xs uppercase tracking-wide text-on-surface/50">
                  {label}
                </p>
                <p className="text-sm text-on-surface">{String(result.thesis[key] ?? "—")}</p>
              </div>
            ))}
          </div>

          {result.thesis.mode === "thesis_only" && result.stockSuggestions.length > 0 && (
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="mb-2 font-display text-sm text-on-surface">
                Jarvis sees these names as potential expressions of this thesis:
              </p>
              <div className="flex flex-col gap-2">
                {result.stockSuggestions.map((s) => (
                  <button
                    key={s.ticker}
                    type="button"
                    onClick={() => setInputText(`${s.ticker} — ${result.thesis.market_view}`)}
                    className="rounded-lg bg-surface-container-highest px-3 py-2 text-left text-sm hover:bg-primary/10"
                  >
                    <span className="font-medium text-primary">{s.ticker}</span>{" "}
                    <span className="text-on-surface/70">{s.rationale}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="rounded-xl bg-surface-container-highest px-4 py-2 text-sm font-medium text-on-surface/80 hover:text-on-surface"
            >
              Save as Draft
            </button>
            <button
              type="button"
              onClick={handleApprove}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90"
            >
              Approve → Build Trade Plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: `PATCH /api/theses/[id]` (used by `handleApprove` above) is built in Task 19 alongside `PATCH /api/trade-plans/[id]` — until then, `handleApprove` will 404 in the browser but the file compiles (it's a same-shape `fetch` call, not an import). This is the same deliberate "phase-internal forward reference" pattern as Task 6/Task 10.

- [ ] **Step 3: Build the standalone page**

```typescript
// app/(app)/thesis/new/page.tsx
import { ThesisInputForm } from "@/components/thesis/thesis-input-form";

export default async function NewThesisPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 font-display text-2xl text-on-surface">New Thesis</h1>
      <ThesisInputForm prefillTicker={ticker} />
    </div>
  );
}
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open the drawer from any page via the sidebar's "New Thesis" button. Type `I think Indian IT is bottoming due to AI tailwinds`, submit, confirm: 5 field cards render, conviction badge shows, mode reads "No stock — Macro Thesis", and (once a real OpenRouter key + live model response comes back) a stock-suggestions panel appears since this is Mode 2 input.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add components/thesis "app/(app)/thesis/new"
/usr/bin/git commit -m "feat: Screen 1 — Thesis Input (3-mode free text)"
```

---

### Task 11: `lib/weighted-average.ts`

**Files:**
- Create: `lib/weighted-average.ts`
- Test: `lib/__tests__/weighted-average.test.ts`

**Interfaces:**
- Produces: `computeWeightedAverageEntry(entries: { quantity: number; price: number }[]): { totalQuantity: number; averagePrice: number }` — consumed by Task 12's `POST /api/positions/[id]/entries` and every screen that displays a position's blended entry (Tasks 13, 21).

- [ ] **Step 1: Write the test**

```typescript
// lib/__tests__/weighted-average.test.ts
import { describe, expect, it } from "vitest";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";

describe("computeWeightedAverageEntry", () => {
  it("returns the single entry's price for one entry", () => {
    const result = computeWeightedAverageEntry([{ quantity: 100, price: 50 }]);
    expect(result.totalQuantity).toBe(100);
    expect(result.averagePrice).toBe(50);
  });

  it("computes sum(qty*price)/sum(qty) across multiple entries", () => {
    // US-05's formula: (100*50 + 100*60) / 200 = 55
    const result = computeWeightedAverageEntry([
      { quantity: 100, price: 50 },
      { quantity: 100, price: 60 },
    ]);
    expect(result.totalQuantity).toBe(200);
    expect(result.averagePrice).toBe(55);
  });

  it("weights unevenly-sized tranches correctly", () => {
    const result = computeWeightedAverageEntry([
      { quantity: 300, price: 100 },
      { quantity: 100, price: 140 },
    ]);
    expect(result.totalQuantity).toBe(400);
    expect(result.averagePrice).toBe(110);
  });

  it("returns zero for an empty entry list", () => {
    const result = computeWeightedAverageEntry([]);
    expect(result.totalQuantity).toBe(0);
    expect(result.averagePrice).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/weighted-average.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// lib/weighted-average.ts

/**
 * Weighted-average entry price across all of a position's `entries` rows —
 * spec US-05's exact formula: `sum(qty × price) / sum(qty)`. Pure function,
 * shared by `POST /api/positions/[id]/entries` (Task 12) and every screen
 * that displays a position's blended average (Tasks 13, 21) so the math
 * never drifts between the write path and the read paths.
 */
export function computeWeightedAverageEntry(
  entries: { quantity: number; price: number }[],
): { totalQuantity: number; averagePrice: number } {
  const totalQuantity = entries.reduce((sum, e) => sum + e.quantity, 0);
  if (totalQuantity === 0) {
    return { totalQuantity: 0, averagePrice: 0 };
  }
  const totalCost = entries.reduce((sum, e) => sum + e.quantity * e.price, 0);
  return { totalQuantity, averagePrice: totalCost / totalQuantity };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/weighted-average.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add lib/weighted-average.ts lib/__tests__/weighted-average.test.ts
/usr/bin/git commit -m "feat: weighted-average entry price calculator"
```

---

### Task 12: `POST /api/positions/[id]/entries`

**Files:**
- Create: `app/api/positions/[id]/entries/route.ts`
- Test: `app/api/positions/[id]/entries/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `createAdminClient`
- Produces: `POST /api/positions/:id/entries` (body `{ date, quantity, price, tranche, notes? }` → `201 { entry: Entry; weightedAverage: { totalQuantity: number; averagePrice: number } }`). Consumed by Task 13's "Add Entry" modal.

- [ ] **Step 1: Write the route test**

```typescript
// app/api/positions/[id]/entries/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildSupabaseMock(existingEntries: { quantity: number; price: number }[]) {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "e1", position_id: "p1", date: "2026-08-27", quantity: 50, price: 120, tranche: "add" },
            error: null,
          }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: existingEntries, error: null }),
      }),
    }),
  };
}

describe("POST /api/positions/[id]/entries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-positive quantity", async () => {
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 0, price: 100, tranche: "T1" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(400);
  });

  it("inserts the entry and returns the recomputed weighted average", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock([{ quantity: 100, price: 100 }, { quantity: 50, price: 120 }]) as never,
    );
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 50, price: 120, tranche: "add" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.weightedAverage.totalQuantity).toBe(150);
    expect(body.weightedAverage.averagePrice).toBeCloseTo(106.67, 1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/positions/[id]/entries/__tests__/route.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// app/api/positions/[id]/entries/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { createAdminClient } from "@/lib/supabase/admin";

const AddEntrySchema = z.object({
  date: z.iso.date(),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
  tranche: z.enum(["T1", "T2", "add"]),
  notes: z.string().trim().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: positionId } = await params;
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = AddEntrySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: entry, error: insertError } = await supabase
    .from("entries")
    .insert({ position_id: positionId, ...parsed.data })
    .select("*")
    .single();

  if (insertError || !entry) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to insert entry" },
      { status: 500 },
    );
  }

  const { data: allEntries, error: entriesError } = await supabase
    .from("entries")
    .select("quantity, price")
    .eq("position_id", positionId);

  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 });
  }

  const weightedAverage = computeWeightedAverageEntry(allEntries ?? []);

  return NextResponse.json({ entry, weightedAverage }, { status: 201 });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/positions/[id]/entries/__tests__/route.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/api/positions
/usr/bin/git commit -m "feat: POST /api/positions/:id/entries — add tranche + recompute weighted average"
```

---

### Task 13: Screen HUB-2 — Active Positions & Exit Discipline

**Files:**
- Create: `lib/position-metrics.ts`
- Test: `lib/__tests__/position-metrics.test.ts`
- Create: `app/(app)/positions/page.tsx`
- Create: `components/positions/positions-table.tsx`
- Create: `components/positions/add-entry-modal.tsx`
- Create: `app/api/positions/route.ts` (GET list, joined)

**Interfaces:**
- Consumes: `computeWeightedAverageEntry` (Task 11), `PriceBadge`/`EmptyState` (Task 6), `POST /api/positions/:id/entries` (Task 12)
- Produces: `computePositionPnl`/`computeDistanceToStop` (pure, reused by Tasks 21/24), `GET /api/positions` (`{ positions: PositionListItem[] }`), `<PositionsTable />` reused by Task 24's Cockpit summary widget.

- [ ] **Step 1: Write the pure-metrics test**

```typescript
// lib/__tests__/position-metrics.test.ts
import { describe, expect, it } from "vitest";
import { computePositionPnl, computeDistanceToStop } from "@/lib/position-metrics";

describe("computePositionPnl", () => {
  it("computes absolute and percent return", () => {
    const pnl = computePositionPnl({ currentPrice: 120, avgEntry: 100, quantity: 50 });
    expect(pnl.absolute).toBe(1000);
    expect(pnl.percent).toBe(20);
  });

  it("returns a negative return when price is below entry", () => {
    const pnl = computePositionPnl({ currentPrice: 90, avgEntry: 100, quantity: 10 });
    expect(pnl.absolute).toBe(-100);
    expect(pnl.percent).toBe(-10);
  });
});

describe("computeDistanceToStop", () => {
  it("returns positive rupee and percent distance when above stop", () => {
    const d = computeDistanceToStop({ currentPrice: 110, stopLoss: 100 });
    expect(d).not.toBeNull();
    expect(d!.rupees).toBe(10);
    expect(d!.percent).toBeCloseTo(9.09, 1);
  });

  it("returns null when there is no stop set", () => {
    expect(computeDistanceToStop({ currentPrice: 110, stopLoss: null })).toBeNull();
  });

  it("returns zero-or-negative distance when at or below stop", () => {
    const d = computeDistanceToStop({ currentPrice: 95, stopLoss: 100 });
    expect(d!.rupees).toBe(-5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/position-metrics.test.ts` — Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```typescript
// lib/position-metrics.ts

/** Unrealized P&L for a position's remaining quantity vs its weighted-average entry. */
export function computePositionPnl(input: {
  currentPrice: number;
  avgEntry: number;
  quantity: number;
}): { absolute: number; percent: number } {
  const absolute = (input.currentPrice - input.avgEntry) * input.quantity;
  const percent = ((input.currentPrice - input.avgEntry) / input.avgEntry) * 100;
  return { absolute, percent };
}

/**
 * Rupee/percent distance from current price down to the stop. Used to
 * drive HUB-2's default "nearest stop first" sort (US-03) — a SMALLER
 * `rupees`/`percent` (including negative, meaning already through the
 * stop) sorts first.
 */
export function computeDistanceToStop(input: {
  currentPrice: number;
  stopLoss: number | null;
}): { rupees: number; percent: number } | null {
  if (input.stopLoss === null) return null;
  const rupees = input.currentPrice - input.stopLoss;
  const percent = (rupees / input.currentPrice) * 100;
  return { rupees, percent };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/position-metrics.test.ts` — Expected: PASS (5/5)

- [ ] **Step 5: Build `GET /api/positions`**

```typescript
// app/api/positions/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";

export async function GET() {
  const supabase = createAdminClient();

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("*")
    .eq("status", "active");
  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 500 });
  }
  if (!positions || positions.length === 0) {
    return NextResponse.json({ positions: [] });
  }

  const positionIds = positions.map((p) => p.id);
  const stockIds = [...new Set(positions.map((p) => p.stock_id))];
  const tradePlanIds = [...new Set(positions.map((p) => p.trade_plan_id))];
  const thesisIds = [...new Set(positions.map((p) => p.thesis_id))];

  const [{ data: entries }, { data: stocks }, { data: tradePlans }, { data: theses }] = await Promise.all([
    supabase.from("entries").select("*").in("position_id", positionIds),
    supabase.from("stocks").select("*").in("id", stockIds),
    supabase.from("trade_plans").select("*").in("id", tradePlanIds),
    supabase.from("theses").select("id, conviction_tier").in("id", thesisIds),
  ]);

  const entriesByPosition = new Map<string, { quantity: number; price: number }[]>();
  for (const e of entries ?? []) {
    const list = entriesByPosition.get(e.position_id) ?? [];
    list.push({ quantity: e.quantity, price: e.price });
    entriesByPosition.set(e.position_id, list);
  }
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));
  const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));
  const thesisById = new Map((theses ?? []).map((t) => [t.id, t]));

  const result = positions.map((p) => {
    const stock = stockById.get(p.stock_id);
    const tradePlan = tradePlanById.get(p.trade_plan_id);
    const weightedAverage = computeWeightedAverageEntry(entriesByPosition.get(p.id) ?? []);
    return {
      position: p,
      stock,
      tradePlan,
      weightedAverage,
      convictionTier: thesisById.get(p.thesis_id)?.conviction_tier ?? undefined,
    };
  });

  return NextResponse.json({ positions: result });
}
```

- [ ] **Step 6: Build the positions table + page**

```typescript
// components/positions/positions-table.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { computeDistanceToStop, computePositionPnl } from "@/lib/position-metrics";
import { formatCurrency } from "@/lib/format";
import { ConvictionBadge } from "@/components/thesis/conviction-badge";
import type { ConvictionTier, ExchangeCode } from "@/lib/types";

export type PositionRow = {
  position: { id: string; ticker: string; status: string };
  stock: { last_price: number | null; exchange: ExchangeCode } | undefined;
  tradePlan: {
    stop_loss: number | null;
    target_1: number | null;
    target_2: number | null;
    time_exit_date: string | null;
  } | undefined;
  weightedAverage: { totalQuantity: number; averagePrice: number };
  convictionTier?: ConvictionTier;
};

type SortKey = "distanceToStop" | "returnPct" | "thesisDate";

export function PositionsTable({ rows }: { rows: PositionRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("distanceToStop");

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const priceA = a.stock?.last_price ?? 0;
      const priceB = b.stock?.last_price ?? 0;
      if (sortKey === "distanceToStop") {
        const distA = computeDistanceToStop({ currentPrice: priceA, stopLoss: a.tradePlan?.stop_loss ?? null });
        const distB = computeDistanceToStop({ currentPrice: priceB, stopLoss: b.tradePlan?.stop_loss ?? null });
        return (distA?.percent ?? Infinity) - (distB?.percent ?? Infinity);
      }
      if (sortKey === "returnPct") {
        const pnlA = computePositionPnl({ currentPrice: priceA, avgEntry: a.weightedAverage.averagePrice, quantity: 1 });
        const pnlB = computePositionPnl({ currentPrice: priceB, avgEntry: b.weightedAverage.averagePrice, quantity: 1 });
        return pnlB.percent - pnlA.percent;
      }
      const dateA = a.tradePlan?.time_exit_date ?? "9999-99-99";
      const dateB = b.tradePlan?.time_exit_date ?? "9999-99-99";
      return dateA.localeCompare(dateB);
    });
  }, [rows, sortKey]);

  return (
    <div className="overflow-x-auto rounded-xl bg-surface-container-low">
      <div className="flex gap-2 border-b border-outline-variant/10 p-3 text-xs text-on-surface/50">
        <span>Sort by:</span>
        {(["distanceToStop", "returnPct", "thesisDate"] as SortKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setSortKey(key)}
            className={sortKey === key ? "text-primary" : "hover:text-on-surface"}
          >
            {key === "distanceToStop" ? "Distance to Stop" : key === "returnPct" ? "Return %" : "Thesis Date"}
          </button>
        ))}
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-on-surface/50">
            <th className="p-3">Ticker</th>
            <th className="p-3">Avg Entry</th>
            <th className="p-3">CMP</th>
            <th className="p-3">Return</th>
            <th className="p-3">Dist. to Stop</th>
            <th className="p-3">T1</th>
            <th className="p-3">T2</th>
            <th className="p-3">Tier</th>
            <th className="p-3">Time Exit</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const price = row.stock?.last_price ?? null;
            const exchange = row.stock?.exchange ?? "US";
            const pnl = price !== null
              ? computePositionPnl({ currentPrice: price, avgEntry: row.weightedAverage.averagePrice, quantity: row.weightedAverage.totalQuantity })
              : null;
            const dist = price !== null
              ? computeDistanceToStop({ currentPrice: price, stopLoss: row.tradePlan?.stop_loss ?? null })
              : null;
            const t1Hit = price !== null && row.tradePlan?.target_1 != null && price >= row.tradePlan.target_1;
            const t2Hit = price !== null && row.tradePlan?.target_2 != null && price >= row.tradePlan.target_2;

            return (
              <tr key={row.position.id} className="border-t border-outline-variant/10 hover:bg-surface-container-high">
                <td className="p-3">
                  <Link href={`/positions/${row.position.id}`} className="font-medium text-on-surface hover:text-primary">
                    {row.position.ticker}
                  </Link>
                </td>
                <td className="p-3 font-mono tabular-nums">{formatCurrency(row.weightedAverage.averagePrice, exchange)}</td>
                <td className="p-3 font-mono tabular-nums">{price !== null ? formatCurrency(price, exchange) : "Price unavailable"}</td>
                <td className={`p-3 font-mono tabular-nums ${pnl && pnl.percent >= 0 ? "text-status-green" : "text-status-red"}`}>
                  {pnl ? `${pnl.percent >= 0 ? "+" : ""}${pnl.percent.toFixed(2)}%` : "—"}
                </td>
                <td className={`p-3 font-mono tabular-nums ${dist && dist.rupees <= 0 ? "text-status-red" : ""}`}>
                  {dist ? formatCurrency(dist.rupees, exchange) : "—"}
                </td>
                <td className="p-3">{t1Hit ? <span className="text-status-green">HIT</span> : "—"}</td>
                <td className="p-3">{t2Hit ? <span className="text-status-green">HIT</span> : "—"}</td>
                <td className="p-3">{row.convictionTier && <ConvictionBadge tier={row.convictionTier} />}</td>
                <td className="p-3 text-on-surface/70">{row.tradePlan?.time_exit_date ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

```typescript
// app/(app)/positions/page.tsx
import { EmptyState } from "@/components/shared/empty-state";
import { PositionsTable, type PositionRow } from "@/components/positions/positions-table";

async function fetchPositions(): Promise<PositionRow[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/positions`, {
    cache: "no-store",
  });
  const body = await res.json();
  return body.positions ?? [];
}

export default async function PositionsPage() {
  const rows = await fetchPositions();

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-on-surface">Active Positions & Exit Discipline</h1>
      {rows.length === 0 ? (
        <EmptyState title="No active positions." description="Start with a thesis →" />
      ) : (
        <PositionsTable rows={rows} />
      )}
    </div>
  );
}
```

Add `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to `.env.local.example` (and the user's own `.env.local`) in this task's commit — every later server-component page in this plan that calls its own API route server-side reuses this same pattern and env var.

Note: US-04's automatic T1-hit toast and blocking stop-hit banner, and the "Add Entry" modal's wiring to Task 12's route, are completed in Task 23 (Exit & Monitoring) where the full exit-ladder interaction lives — this task ships the list/sort/read view (the acceptance criteria that don't require a live client-side alert engine), which is what US-03 alone requires.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, visit `/positions` with no data — confirm the empty state renders. (Full row rendering is verified in Task 14 once a position can actually be created.)

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add lib/position-metrics.ts lib/__tests__/position-metrics.test.ts "app/(app)/positions" app/api/positions components/positions .env.local.example
/usr/bin/git commit -m "feat: Screen HUB-2 — Active Positions list, sortable by urgency"
```

---

### Task 14: Screen 4 — Manual Execution Trigger + `POST /api/positions`

**Files:**
- Create: `app/api/positions/route.ts` (adds `POST` alongside Task 13's `GET`)
- Test: `app/api/positions/__tests__/route.test.ts`
- Create: `components/positions/manual-execution-modal.tsx`

**Interfaces:**
- Consumes: `createAdminClient`, `ExchangeCodeSchema`-style zod patterns
- Produces: `POST /api/positions` (body `{ trade_plan_id, thesis_id, stock_id, ticker, date, quantity, price, tranche, jarvis_recommendation_id? }` → `201 { position: Position }`). Consumed by Task 16's "I Bought This" flow and Task 20's post-Lock-Plan flow.

- [ ] **Step 1: Write the route test**

```typescript
// app/api/positions/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildSupabaseMock() {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "pos-1", status: "active", ticker: "AAPL" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "entries") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "jarvis_recommendations") {
        return { update: vi.fn().mockReturnValue({ eq: updateEq }) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _updateEq: updateEq,
  };
}

describe("POST /api/positions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a position + first entry and links a recommendation when provided", async () => {
    const mock = buildSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({
        trade_plan_id: "tp1",
        thesis_id: "th1",
        stock_id: "s1",
        ticker: "AAPL",
        date: "2026-08-27",
        quantity: 10,
        price: 150,
        tranche: "T1",
        jarvis_recommendation_id: "rec1",
      }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.position.id).toBe("pos-1");
    expect(mock._updateEq).toHaveBeenCalledWith("id", "rec1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/positions/__tests__/route.test.ts` — Expected: FAIL, no `POST` export yet

- [ ] **Step 3: Add `POST` to `app/api/positions/route.ts`** (append below Task 13's `GET`)

```typescript
import { z } from "zod";

const CreatePositionSchema = z.object({
  trade_plan_id: z.string().min(1),
  thesis_id: z.string().min(1),
  stock_id: z.string().min(1),
  ticker: z.string().min(1),
  date: z.iso.date(),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
  tranche: z.enum(["T1", "T2", "add"]),
  jarvis_recommendation_id: z.string().optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreatePositionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { jarvis_recommendation_id, date, quantity, price, tranche, ...positionFields } = parsed.data;

  const supabase = createAdminClient();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .insert(positionFields)
    .select("*")
    .single();
  if (positionError || !position) {
    return NextResponse.json({ error: positionError?.message ?? "Failed to create position" }, { status: 500 });
  }

  const { error: entryError } = await supabase
    .from("entries")
    .insert({ position_id: position.id, date, quantity, price, tranche });
  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 500 });
  }

  if (jarvis_recommendation_id) {
    const { error: recError } = await supabase
      .from("jarvis_recommendations")
      .update({ converted_to_position: true, position_id: position.id })
      .eq("id", jarvis_recommendation_id);
    if (recError) {
      return NextResponse.json({ error: recError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ position }, { status: 201 });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/positions/__tests__/route.test.ts` — Expected: PASS (1/1)

- [ ] **Step 5: Build the modal**

```typescript
// components/positions/manual-execution-modal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TradePlanSummary = {
  id: string;
  thesis_id: string;
  stock_id: string;
  ticker: string;
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
};

const CHECKLIST_ITEMS = [
  "Is entry in or near the zone?",
  "Is my stop set?",
  "Is my position size within the planned %?",
  "Is this thesis still valid (not invalidated)?",
];

/** Spec US-13/US-14: no broker integration — this logs a buy the user already made. Checklist is a reminder only, never a gate. */
export function ManualExecutionModal({
  tradePlan,
  jarvisRecommendationId,
  onClose,
}: {
  tradePlan: TradePlanSummary;
  jarvisRecommendationId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST_ITEMS.map(() => false));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [tranche, setTranche] = useState<"T1" | "T2" | "add">("T1");
  const [submitting, setSubmitting] = useState(false);

  const priceNum = Number(price);
  const outsideZone =
    price !== "" &&
    tradePlan.entry_zone_low !== null &&
    tradePlan.entry_zone_high !== null &&
    (priceNum < tradePlan.entry_zone_low || priceNum > tradePlan.entry_zone_high);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade_plan_id: tradePlan.id,
          thesis_id: tradePlan.thesis_id,
          stock_id: tradePlan.stock_id,
          ticker: tradePlan.ticker,
          date,
          quantity: Number(quantity),
          price: priceNum,
          tranche,
          jarvis_recommendation_id: jarvisRecommendationId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to log buy");
      onClose();
      router.push(`/positions/${body.position.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-1 font-display text-lg text-on-surface">Log My Buy — {tradePlan.ticker}</h2>
        <p className="mb-4 text-xs text-on-surface/50">
          Entry Zone {tradePlan.entry_zone_low}–{tradePlan.entry_zone_high} · Stop {tradePlan.stop_loss} · T1{" "}
          {tradePlan.target_1} · T2 {tradePlan.target_2}
        </p>

        <div className="mb-4 flex flex-col gap-2">
          {CHECKLIST_ITEMS.map((item, i) => (
            <label key={item} className="flex items-center gap-2 text-sm text-on-surface/80">
              <input
                type="checkbox"
                checked={checked[i]}
                onChange={(e) => setChecked((c) => c.map((v, idx) => (idx === i ? e.target.checked : v)))}
              />
              {item}
            </label>
          ))}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <select value={tranche} onChange={(e) => setTranche(e.target.value as typeof tranche)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
            <option value="T1">First buy</option>
            <option value="T2">Second buy</option>
            <option value="add">Adding to position</option>
          </select>
          <input type="number" placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input type="number" placeholder="Avg price paid" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
        </div>

        {outsideZone && (
          <p className="mb-4 rounded-lg bg-primary-container px-3 py-2 text-xs text-primary">
            You entered at {price} — outside your planned zone of {tradePlan.entry_zone_low}–{tradePlan.entry_zone_high}.
            Your actual risk/reward will be recalculated. Proceeding.
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !quantity || !price}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
          >
            Log My Buy
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/api/positions components/positions/manual-execution-modal.tsx
/usr/bin/git commit -m "feat: Screen 4 — Manual Execution Trigger (log-a-buy, no broker)"
```

---

### Task 15: `lib/recommendation-status.ts`

**Files:**
- Create: `lib/recommendation-status.ts`
- Test: `lib/__tests__/recommendation-status.test.ts`

**Interfaces:**
- Produces: `computeRecommendationStatus(rec, currentPrice)`, `computePctChangeSinceRec(rec, currentPrice)` — consumed by Task 16's Recommendation Tracker (computed client/server-side on page load per US-22's "Status auto-updates on page load", never stored/cron-computed).

- [ ] **Step 1: Write the test**

```typescript
// lib/__tests__/recommendation-status.test.ts
import { describe, expect, it } from "vitest";
import { computeRecommendationStatus, computePctChangeSinceRec } from "@/lib/recommendation-status";

const base = {
  recommended_target_1: 120,
  recommended_target_2: 140,
  recommended_stop: 90,
  price_at_recommendation: 100,
};

describe("computeRecommendationStatus", () => {
  it("returns t1_hit when price has reached target_1 but not target_2", () => {
    expect(computeRecommendationStatus(base, 125)).toBe("t1_hit");
  });
  it("returns t2_hit when price has reached target_2", () => {
    expect(computeRecommendationStatus(base, 145)).toBe("t2_hit");
  });
  it("returns stop_hit when price is at or below the stop, taking precedence over targets", () => {
    expect(computeRecommendationStatus(base, 85)).toBe("stop_hit");
  });
  it("returns open when price is between entry and target_1", () => {
    expect(computeRecommendationStatus(base, 105)).toBe("open");
  });
});

describe("computePctChangeSinceRec", () => {
  it("computes percent change from price_at_recommendation", () => {
    expect(computePctChangeSinceRec(base, 110)).toBe(10);
    expect(computePctChangeSinceRec(base, 90)).toBe(-10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/recommendation-status.test.ts` — Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```typescript
// lib/recommendation-status.ts
import type { RecommendationStatus } from "@/lib/types";

type RecFields = {
  recommended_target_1: number | null;
  recommended_target_2: number | null;
  recommended_stop: number | null;
  price_at_recommendation: number;
};

/**
 * Recomputed on every page load (spec US-22) — never stored, never
 * cron-updated. Precedence: stop takes priority over any target (a
 * recommendation that later also crossed a target after stopping out is
 * still, correctly, a loss).
 */
export function computeRecommendationStatus(
  rec: RecFields,
  currentPrice: number,
): RecommendationStatus {
  if (rec.recommended_stop !== null && currentPrice <= rec.recommended_stop) {
    return "stop_hit";
  }
  if (rec.recommended_target_2 !== null && currentPrice >= rec.recommended_target_2) {
    return "t2_hit";
  }
  if (rec.recommended_target_1 !== null && currentPrice >= rec.recommended_target_1) {
    return "t1_hit";
  }
  return "open";
}

export function computePctChangeSinceRec(rec: RecFields, currentPrice: number): number {
  return ((currentPrice - rec.price_at_recommendation) / rec.price_at_recommendation) * 100;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/recommendation-status.test.ts` — Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add lib/recommendation-status.ts lib/__tests__/recommendation-status.test.ts
/usr/bin/git commit -m "feat: recommendation status/pct-change calculator (page-load-computed)"
```

---

### Task 16: Screen NEW — Jarvis Recommendation Tracker

**Files:**
- Create: `app/api/recommendations/route.ts` (GET, joined + status-computed)
- Create: `app/(app)/recommendations/page.tsx`
- Create: `components/recommendations/recommendations-table.tsx`
- Create: `components/recommendations/recommendation-stats.tsx`

**Interfaces:**
- Consumes: `computeRecommendationStatus`/`computePctChangeSinceRec` (Task 15), `ManualExecutionModal` (Task 14), `ConvictionBadge` (Task 10)
- Produces: `GET /api/recommendations` (`{ recommendations: RecommendationRow[] }`) — this is the app's only reader of `jarvis_recommendations`; the writer is Task 20's "Lock & Save Plan" (creates one row per locked trade plan, per spec US-12's last bullet).

- [ ] **Step 1: Build the route**

```typescript
// app/api/recommendations/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = createAdminClient();

  const { data: recommendations, error } = await supabase
    .from("jarvis_recommendations")
    .select("*")
    .order("recommended_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!recommendations || recommendations.length === 0) {
    return NextResponse.json({ recommendations: [] });
  }

  const stockIds = [...new Set(recommendations.map((r) => r.stock_id))];
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("id, last_price, exchange")
    .in("id", stockIds);
  if (stocksError) {
    return NextResponse.json({ error: stocksError.message }, { status: 500 });
  }
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));

  const result = recommendations.map((rec) => ({
    recommendation: rec,
    stock: stockById.get(rec.stock_id),
  }));

  return NextResponse.json({ recommendations: result });
}
```

- [ ] **Step 2: Build the stats strip**

```typescript
// components/recommendations/recommendation-stats.tsx
"use client";

import { useMemo, useState } from "react";
import { computeRecommendationStatus } from "@/lib/recommendation-status";
import type { ConvictionTier } from "@/lib/types";

type Row = {
  recommendation: {
    conviction_tier: ConvictionTier;
    recommended_stop: number | null;
    recommended_target_1: number | null;
    recommended_target_2: number | null;
    price_at_recommendation: number;
    converted_to_position: boolean;
  };
  stock: { last_price: number | null } | undefined;
};

/**
 * US-02's cockpit widget and US-23's full stats strip share this exact
 * "unacted-on only" filter (spec: "to avoid double-counting" positions that
 * already have their own real P&L tracked elsewhere) — this component is
 * reused directly by Task 24's Cockpit summary widget, not reimplemented.
 */
export function RecommendationStats({ rows }: { rows: Row[] }) {
  const [hypothetical, setHypothetical] = useState(false);

  const stats = useMemo(() => {
    const unacted = rows.filter((r) => !r.recommendation.converted_to_position);
    const byTier: Record<ConvictionTier, { wins: number; losses: number; open: number }> = {
      I: { wins: 0, losses: 0, open: 0 },
      II: { wins: 0, losses: 0, open: 0 },
      III: { wins: 0, losses: 0, open: 0 },
      IV: { wins: 0, losses: 0, open: 0 },
    };
    let wins = 0, losses = 0, openCount = 0, hypotheticalPnl = 0;

    for (const row of unacted) {
      const price = row.stock?.last_price;
      if (price == null) continue;
      const status = computeRecommendationStatus(row.recommendation, price);
      const tier = byTier[row.recommendation.conviction_tier];
      if (status === "stop_hit") {
        losses++; tier.losses++;
      } else if (status === "t1_hit" || status === "t2_hit") {
        wins++; tier.wins++;
      } else {
        openCount++; tier.open++;
      }
      hypotheticalPnl += price - row.recommendation.price_at_recommendation;
    }

    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;
    return { total: unacted.length, wins, losses, open: openCount, winRate, byTier, hypotheticalPnl };
  }, [rows]);

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Total Recs", stats.total],
          ["Wins (T1 before stop)", stats.wins],
          ["Losses (stop before T1)", stats.losses],
          ["Still Open", stats.open],
          ["Win Rate", stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—"],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-surface-container-low p-4">
            <p className="font-display text-xs uppercase text-on-surface/50">{label}</p>
            <p className="mt-1 font-mono text-lg text-on-surface">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-on-surface/60">
        {(["I", "II", "III"] as ConvictionTier[]).map((tier) => {
          const t = stats.byTier[tier];
          const rate = t.wins + t.losses > 0 ? ((t.wins / (t.wins + t.losses)) * 100).toFixed(0) : "—";
          return <span key={tier}>Tier {tier}: {rate}%</span>;
        })}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={hypothetical} onChange={(e) => setHypothetical(e.target.checked)} />
          Hypothetical P&L
        </label>
        {hypothetical && (
          <span className={stats.hypotheticalPnl >= 0 ? "text-status-green" : "text-status-red"}>
            {stats.hypotheticalPnl >= 0 ? "+" : ""}
            {stats.hypotheticalPnl.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build the table**

```typescript
// components/recommendations/recommendations-table.tsx
"use client";

import { useState } from "react";
import { computeRecommendationStatus, computePctChangeSinceRec } from "@/lib/recommendation-status";
import { ManualExecutionModal } from "@/components/positions/manual-execution-modal";
import type { ConvictionTier, ExchangeCode } from "@/lib/types";

type Row = {
  recommendation: {
    id: string;
    trade_plan_id: string | null;
    thesis_id: string;
    stock_id: string;
    ticker: string;
    recommended_at: string;
    recommended_entry_low: number | null;
    recommended_entry_high: number | null;
    recommended_stop: number | null;
    recommended_target_1: number | null;
    recommended_target_2: number | null;
    conviction_tier: ConvictionTier;
    price_at_recommendation: number;
    converted_to_position: boolean;
    position_id: string | null;
  };
  stock: { last_price: number | null; exchange: ExchangeCode } | undefined;
};

const STATUS_STYLE: Record<string, string> = {
  open: "text-primary",
  t1_hit: "text-status-green",
  t2_hit: "text-status-green",
  stop_hit: "text-status-red",
  time_expired: "text-on-surface/50",
};

export function RecommendationsTable({ rows }: { rows: Row[] }) {
  const [buyModalRow, setBuyModalRow] = useState<Row | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-xl bg-surface-container-low">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-on-surface/50">
              <th className="p-3">Date</th>
              <th className="p-3">Ticker</th>
              <th className="p-3">Tier</th>
              <th className="p-3">Entry Zone</th>
              <th className="p-3">Price at Rec</th>
              <th className="p-3">Current</th>
              <th className="p-3">% Change</th>
              <th className="p-3">Status</th>
              <th className="p-3">Acted?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ recommendation: rec, stock }) => {
              const price = stock?.last_price;
              const status = price != null ? computeRecommendationStatus(rec, price) : null;
              const pctChange = price != null ? computePctChangeSinceRec(rec, price) : null;
              const missedWin = !rec.converted_to_position && (status === "t1_hit" || status === "t2_hit");
              const missedLoss = !rec.converted_to_position && status === "stop_hit";

              return (
                <tr
                  key={rec.id}
                  className={
                    "border-t border-outline-variant/10 " +
                    (missedWin ? "bg-status-green-container/30" : missedLoss ? "bg-surface-container-highest/60" : "")
                  }
                >
                  <td className="p-3 text-on-surface/70">{rec.recommended_at.slice(0, 10)}</td>
                  <td className="p-3 font-medium">{rec.ticker}</td>
                  <td className="p-3">{rec.conviction_tier}</td>
                  <td className="p-3 font-mono">{rec.recommended_entry_low}–{rec.recommended_entry_high}</td>
                  <td className="p-3 font-mono">{rec.price_at_recommendation}</td>
                  <td className="p-3 font-mono">{price ?? "Price unavailable"}</td>
                  <td className={`p-3 font-mono ${pctChange !== null && pctChange >= 0 ? "text-status-green" : "text-status-red"}`}>
                    {pctChange !== null ? `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%` : "—"}
                  </td>
                  <td className={`p-3 ${status ? STATUS_STYLE[status] : ""}`}>
                    {status === "t1_hit" ? "T1 Hit ✓" : status === "t2_hit" ? "T2 Hit ✓" : status === "stop_hit" ? "Stop Hit ✗" : status === "open" ? "Open" : "—"}
                    {missedWin && <div className="text-xs text-status-green/80">Jarvis was right — you didn't take this one</div>}
                    {missedLoss && <div className="text-xs text-on-surface/50">Missed bullet — stop would have hit</div>}
                  </td>
                  <td className="p-3">
                    {rec.converted_to_position ? (
                      <a href={`/positions/${rec.position_id}`} className="text-primary underline">Yes</a>
                    ) : (
                      <button type="button" onClick={() => setBuyModalRow({ recommendation: rec, stock })} className="text-on-surface/70 underline">
                        No — I Bought This
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {buyModalRow && (
        <ManualExecutionModal
          tradePlan={{
            id: buyModalRow.recommendation.trade_plan_id ?? "",
            thesis_id: buyModalRow.recommendation.thesis_id,
            stock_id: buyModalRow.recommendation.stock_id,
            ticker: buyModalRow.recommendation.ticker,
            entry_zone_low: buyModalRow.recommendation.recommended_entry_low,
            entry_zone_high: buyModalRow.recommendation.recommended_entry_high,
            stop_loss: buyModalRow.recommendation.recommended_stop,
            target_1: buyModalRow.recommendation.recommended_target_1,
            target_2: buyModalRow.recommendation.recommended_target_2,
          }}
          jarvisRecommendationId={buyModalRow.recommendation.id}
          onClose={() => setBuyModalRow(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Build the page**

```typescript
// app/(app)/recommendations/page.tsx
import { EmptyState } from "@/components/shared/empty-state";
import { RecommendationStats } from "@/components/recommendations/recommendation-stats";
import { RecommendationsTable } from "@/components/recommendations/recommendations-table";

async function fetchRecommendations() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/recommendations`, { cache: "no-store" });
  const body = await res.json();
  return body.recommendations ?? [];
}

export default async function RecommendationsPage() {
  const rows = await fetchRecommendations();

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-on-surface">Jarvis Recommendation Tracker</h1>
      {rows.length === 0 ? (
        <EmptyState title="No Jarvis recommendations yet." description="Build a trade plan to start tracking." />
      ) : (
        <>
          <RecommendationStats rows={rows} />
          <RecommendationsTable rows={rows} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, visit `/recommendations` with no data — confirm the empty state renders exactly as spec'd ("No Jarvis recommendations yet. Build a trade plan to start tracking.").

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/api/recommendations "app/(app)/recommendations" components/recommendations
/usr/bin/git commit -m "feat: Screen NEW — Jarvis Recommendation Tracker (accountability ledger)"
```

---

## Phase 2 — P1

### Task 17: Stress-test extension (bear cases) to prompt/parser

**Files:**
- Modify: `lib/jarvis-thesis-prompt.ts` (append)
- Modify: `lib/jarvis-thesis-parser.ts` (append)
- Test: `lib/__tests__/jarvis-stress-test-parser.test.ts`

**Interfaces:**
- Produces: `JARVIS_STRESS_TEST_SYSTEM_PROMPT`, `buildStressTestUserContext(thesis: Thesis): string`, `BearCaseExtractSchema`, `parseStressTestResponse(raw: string): ParsedStressTestResponse` — consumed by Task 20's Screen 2-3 Step 2.

- [ ] **Step 1: Write the parser test**

```typescript
// lib/__tests__/jarvis-stress-test-parser.test.ts
import { describe, expect, it } from "vitest";
import { parseStressTestResponse } from "@/lib/jarvis-thesis-parser";

const RAW = `\`\`\`json
{
  "bear_cases": [
    { "reason": "Margins compress on rising input costs", "counter": "Pricing power offsets 80% historically" },
    { "reason": "Competitor undercuts on price", "counter": "Brand moat has held for a decade" }
  ]
}
\`\`\``;

describe("parseStressTestResponse", () => {
  it("extracts bear cases with modified defaulting to false", () => {
    const result = parseStressTestResponse(RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.bear_cases).toHaveLength(2);
      expect(result.data.bear_cases[0].modified).toBe(false);
    }
  });

  it("returns ok:false on malformed input without throwing", () => {
    expect(() => parseStressTestResponse("no json here")).not.toThrow();
    expect(parseStressTestResponse("no json here").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/__tests__/jarvis-stress-test-parser.test.ts` — Expected: FAIL

- [ ] **Step 3: Append the prompt to `lib/jarvis-thesis-prompt.ts`**

```typescript
/**
 * Stress-test system prompt: spec Screen 2-3 Step 2, run only AFTER a
 * thesis has been approved (Task 20). Produces 4 bear cases + counters —
 * the model challenges its own prior thesis output, not the raw user input.
 */
export const JARVIS_STRESS_TEST_SYSTEM_PROMPT = `You are Jarvis. You will be given a structured thesis you previously produced.
Your job now is to attack it: assume the market may already be correct and the thesis is wrong.

Produce exactly 4 concrete bear cases — reasons this thesis could fail — each paired with a
counter-argument for why the bear case doesn't hold (or, if it's a strong bear case, an honest
counter that concedes it weakens conviction rather than a forced rebuttal).

Output exactly one fenced code block using json as the fence's info string, containing ONE
object and nothing else:

{
  "bear_cases": [
    { "reason": string, "counter": string }
  ]
}

Exactly 4 entries in "bear_cases". No narrative prose outside the JSON block for this prompt.`;

export function buildStressTestUserContext(thesis: {
  market_view: string | null;
  mispricing: string | null;
  catalyst: string | null;
  invalidation_condition: string | null;
}): string {
  return [
    `Market View: ${thesis.market_view}`,
    `Mispricing: ${thesis.mispricing}`,
    `Catalyst: ${thesis.catalyst}`,
    `Invalidation: ${thesis.invalidation_condition}`,
    "",
    "Stress-test this thesis.",
  ].join("\n");
}
```

- [ ] **Step 4: Append the parser to `lib/jarvis-thesis-parser.ts`**

```typescript
export const BearCaseExtractSchema = z.object({
  bear_cases: z
    .array(z.object({ reason: z.string(), counter: z.string() }))
    .length(4),
});

export type StressTestExtraction =
  | { ok: true; data: { bear_cases: { reason: string; counter: string; modified: boolean }[] } }
  | { ok: false; error: string };

/** Same never-throws contract as `parseThesisResponse`. */
export function parseStressTestResponse(raw: string): StressTestExtraction {
  try {
    const rawJson = extractTrailingJsonBlock(raw);
    if (rawJson === null) {
      return { ok: false, error: "No valid ```json code block found." };
    }
    const result = BearCaseExtractSchema.safeParse(rawJson);
    if (!result.success) {
      return { ok: false, error: `Schema validation failed: ${result.error.message}` };
    }
    return {
      ok: true,
      data: { bear_cases: result.data.bear_cases.map((bc) => ({ ...bc, modified: false })) },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 5: Run to verify it passes** — Run: `npx vitest run lib/__tests__/jarvis-stress-test-parser.test.ts` — Expected: PASS (2/2)

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add lib/jarvis-thesis-prompt.ts lib/jarvis-thesis-parser.ts lib/__tests__/jarvis-stress-test-parser.test.ts
/usr/bin/git commit -m "feat: stress-test bear-case generation (Screen 2-3 Step 2)"
```

---

### Task 18: `lib/risk-reward.ts`

**Files:**
- Create: `lib/risk-reward.ts`
- Test: `lib/__tests__/risk-reward.test.ts`

**Interfaces:**
- Produces: `computeRiskReward({ entry, stop, target }): number | null`, `computeMaxDrawdownPct({ entry, stop }): number | null`, `computeCashAtRisk({ portfolioValue, positionSizePct, entry, stop }): number | null` — consumed by Task 20's 9-cell grid.

- [ ] **Step 1: Write the test**

```typescript
// lib/__tests__/risk-reward.test.ts
import { describe, expect, it } from "vitest";
import { computeRiskReward, computeMaxDrawdownPct, computeCashAtRisk } from "@/lib/risk-reward";

describe("computeRiskReward", () => {
  it("computes reward/risk ratio using the midpoint of entry to target vs entry to stop", () => {
    // risk = 100-90=10, reward = 130-100=30 -> 3:1
    expect(computeRiskReward({ entry: 100, stop: 90, target: 130 })).toBe(3);
  });
  it("returns null when stop equals entry (undefined risk)", () => {
    expect(computeRiskReward({ entry: 100, stop: 100, target: 130 })).toBe(null);
  });
});

describe("computeMaxDrawdownPct", () => {
  it("computes percent distance from entry to stop", () => {
    expect(computeMaxDrawdownPct({ entry: 100, stop: 90 })).toBe(10);
  });
});

describe("computeCashAtRisk", () => {
  it("computes rupees at risk given portfolio value, position size %, entry, and stop", () => {
    // position value = 100000 * 5% = 5000; drawdown 10% -> 500 at risk
    expect(computeCashAtRisk({ portfolioValue: 100000, positionSizePct: 5, entry: 100, stop: 90 })).toBe(500);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/__tests__/risk-reward.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement**

```typescript
// lib/risk-reward.ts

export function computeRiskReward(input: { entry: number; stop: number; target: number }): number | null {
  const risk = input.entry - input.stop;
  if (risk === 0) return null;
  const reward = input.target - input.entry;
  return reward / risk;
}

export function computeMaxDrawdownPct(input: { entry: number; stop: number }): number {
  return ((input.entry - input.stop) / input.entry) * 100;
}

export function computeCashAtRisk(input: {
  portfolioValue: number;
  positionSizePct: number;
  entry: number;
  stop: number;
}): number {
  const positionValue = input.portfolioValue * (input.positionSizePct / 100);
  const drawdownPct = computeMaxDrawdownPct({ entry: input.entry, stop: input.stop });
  return positionValue * (drawdownPct / 100);
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `npx vitest run lib/__tests__/risk-reward.test.ts` — Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add lib/risk-reward.ts lib/__tests__/risk-reward.test.ts
/usr/bin/git commit -m "feat: risk/reward, max-drawdown, and cash-at-risk calculators"
```

---

### Task 19: `PATCH /api/theses/[id]` and `PATCH /api/trade-plans/[id]`

**Files:**
- Create: `app/api/theses/[id]/route.ts`
- Create: `app/api/trade-plans/[id]/route.ts`
- Test: `app/api/trade-plans/[id]/__tests__/route.test.ts`

**Interfaces:**
- Produces: `PATCH /api/theses/:id` (body `{ status }`, used by Task 10's Approve flow) and `PATCH /api/trade-plans/:id` (body: any subset of the 9 editable fields → `200 { tradePlan: TradePlan }`, tracks `edited_fields` per spec US-07). Consumed by Task 20's inline-autosave grid.

- [ ] **Step 1: Write `PATCH /api/theses/[id]`**

```typescript
// app/api/theses/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const UpdateThesisSchema = z.object({
  status: z.enum(["draft", "active", "closed", "macro"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = UpdateThesisSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { data: thesis, error } = await supabase
    .from("theses")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !thesis) {
    return NextResponse.json({ error: error?.message ?? "Thesis not found" }, { status: 404 });
  }
  return NextResponse.json({ thesis });
}
```

- [ ] **Step 2: Write the trade-plans route test**

```typescript
// app/api/trade-plans/[id]/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { PATCH } from "../route";

function buildSupabaseMock(existing: Record<string, unknown>) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: existing, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...existing, stop_loss: 95, edited_fields: ["stop_loss"] },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
}

describe("PATCH /api/trade-plans/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks a field as edited when its new value differs from ai_suggested", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({ id: "tp1", stop_loss: 90, ai_suggested: { stop_loss: 90 }, edited_fields: [] }) as never,
    );
    const req = new Request("http://test", { method: "PATCH", body: JSON.stringify({ stop_loss: 95 }) });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: "tp1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tradePlan.edited_fields).toContain("stop_loss");
  });
});
```

- [ ] **Step 3: Run to verify it fails** — Run: `npx vitest run app/api/trade-plans/[id]/__tests__/route.test.ts` — Expected: FAIL

- [ ] **Step 4: Implement `PATCH /api/trade-plans/[id]`**

```typescript
// app/api/trade-plans/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const EDITABLE_FIELDS = [
  "entry_zone_low", "entry_zone_high", "add_tranche_low", "add_tranche_high",
  "stop_loss", "target_1", "target_2", "position_size_pct", "max_portfolio_pct",
  "time_exit_date", "time_exit_condition",
] as const;

const UpdateTradePlanSchema = z
  .object(Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, z.union([z.number(), z.string()]).nullable().optional()])))
  .strict();

/** Spec US-07: inline edits auto-save on blur; edited fields show an amber underline (diff from `ai_suggested`) until "Reset to AI suggestion". */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = UpdateTradePlanSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: existing, error: fetchError } = await supabase
    .from("trade_plans")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError || !existing) {
    return NextResponse.json({ error: fetchError?.message ?? "Trade plan not found" }, { status: 404 });
  }

  const aiSuggested = (existing.ai_suggested ?? {}) as Record<string, unknown>;
  const existingEditedFields = new Set<string>(existing.edited_fields ?? []);
  for (const [field, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    if (field in aiSuggested && aiSuggested[field] === value) {
      existingEditedFields.delete(field);
    } else {
      existingEditedFields.add(field);
    }
  }

  const { data: tradePlan, error: updateError } = await supabase
    .from("trade_plans")
    .update({
      ...parsed.data,
      edited_fields: [...existingEditedFields],
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError || !tradePlan) {
    return NextResponse.json({ error: updateError?.message ?? "Failed to update trade plan" }, { status: 500 });
  }
  return NextResponse.json({ tradePlan });
}
```

- [ ] **Step 5: Run to verify it passes** — Run: `npx vitest run app/api/trade-plans/[id]/__tests__/route.test.ts` — Expected: PASS (1/1)

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/api/theses/\[id\] app/api/trade-plans
/usr/bin/git commit -m "feat: PATCH thesis status + trade-plan inline autosave with edited-field tracking"
```

---
