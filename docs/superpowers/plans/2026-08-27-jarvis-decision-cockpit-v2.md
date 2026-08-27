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
✅ 1. Schema replacement migration + `lib/types.ts` rewrite
✅ 2. Design tokens v2 (amber-gold) + DM Mono/Syne fonts
✅ 3. Retire superseded code
✅ 4. On-demand price refresh endpoint + client hook
✅ 5. Update `poll-prices`/`daily-digest` Edge Functions for the new schema
✅ 6. App shell: sidebar nav + New-Thesis drawer + shared empty/loading/error states

**Phase 1 — P0**
✅ 7. Jarvis thesis prompt v2 (3-mode)
✅ 8. Jarvis thesis parser v2
✅ 9. `POST /api/theses`
✅ 10. Screen 1: Thesis Input
✅ 11. `lib/weighted-average.ts`
✅ 12. `POST /api/positions/[id]/entries`
✅ 13. Screen HUB-2: Active Positions & Exit Discipline
✅ 14. Screen 4: Manual Execution Trigger + `POST /api/positions`
✅ 15. `lib/recommendation-status.ts`
✅ 16. Screen NEW: Jarvis Recommendation Tracker

**Phase 2 — P1**
✅ 17. Stress-test extension (bear cases) to prompt/parser
✅ 18. `lib/risk-reward.ts`
✅ 19. `PATCH /api/trade-plans/[id]`
✅ 20. Screen 2–3: Validation & Plan wizard
✅ 21. Screen HUB-3: Stress Test & Trade Plan (review mode)
✅ 22. `POST /api/positions/[id]/exits`
✅ 23. Screen 5–6: Exit & Monitoring
✅ 24. Screen HUB-1: Velocity Cockpit dashboard

**Phase 3 — P2**
✅ 25. `POST /api/journal` + Jarvis-verdict generation
✅ 26. Screen 7: Trade Journal & Review (form)
✅ 27. Journal archive/browse screen
✅ 28. Screen HUB-4: Intelligence Feed (manual signals)

**Phase 4 — P3**
✅ 29. Screen 8: Opportunity Discovery (manual watchlist)

**Final**
✅ 30. Whole-plan verification pass

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

## Phase 2 — P1 (continued)

### Task 20: Screen 2–3 — Validation & Plan wizard

**Files:**
- Modify: `app/api/theses/[id]/route.ts` (add `GET`, alongside Task 19's `PATCH`; extend `PATCH`'s schema to also accept `bear_cases` and `conviction_score`)
- Create: `app/api/theses/[id]/stress-test/route.ts`
- Create: `app/api/trade-plans/route.ts` (`POST` — this task's counterpart to Task 19's `PATCH /api/trade-plans/[id]`)
- Create: `app/(app)/thesis/[id]/plan/page.tsx`
- Create: `components/thesis/stress-test-panel.tsx`
- Create: `components/thesis/trade-plan-grid.tsx`
- Create: `components/shared/last-updated.tsx` (spec Section 5 Price Data's "Last updated: [timestamp]" rule — introduced here, the first task to fetch and display a live price, and reused by every later price-showing screen: Tasks 21, 23, 24, 29)
- Test: `app/api/theses/[id]/stress-test/__tests__/route.test.ts`
- Test: `app/api/trade-plans/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `JARVIS_STRESS_TEST_SYSTEM_PROMPT`/`buildStressTestUserContext`/`parseStressTestResponse` (Task 17), `computeRiskReward`/`computeMaxDrawdownPct`/`computeCashAtRisk` (Task 18), `ConvictionBadge` (Task 10), `usePriceRefresh` (Task 4), `fetchInternalApi` (Global Constraint), `TradePlanInsert`/`JarvisRecommendationInsert`/`BearCase` (`@/lib/types`)
- Produces: `GET /api/theses/:id` (`{ thesis: Thesis; tradePlan: TradePlan | null; stock: { exchange: ExchangeCode; last_price: number | null; last_price_at: string | null } | null }`) — the read path every later thesis-detail screen uses (Tasks 21, 28, 29); `stock` is `null` for a Macro Thesis with no linked ticker. `POST /api/theses/:id/stress-test` (`{}` → `{ thesis: Thesis }`, persists `bear_cases`). `POST /api/trade-plans` (body: the 9-cell grid fields + `thesis_id` → `201 { tradePlan: TradePlan; recommendation: JarvisRecommendation | null }`) — the only writer of `trade_plans`/`jarvis_recommendations` in the whole app; consumed by Task 21's "no existing plan" empty state and reused nowhere else (a locked plan is edited via Task 19's `PATCH`, never re-created).

**Ruling — when a `JarvisRecommendation` is created (resolves plan Deferred Finding I1):** the spec is explicit here, not actually ambiguous — Screen NEW's own purpose statement says *"Every time Jarvis generates a BUY recommendation (i.e., a trade plan is saved with Tier I or II), a `JarvisRecommendation` record is created automatically."* So `POST /api/trade-plans` creates one `jarvis_recommendations` row if and only if the thesis's `conviction_tier` is `"I"` or `"II"`, at the moment the plan is locked, with `price_at_recommendation` = the stock's current `last_price` and `recommended_entry_low/high`/`recommended_stop`/`recommended_target_1/2` copied from the just-created trade plan. Tier III/IV theses can still have trade plans and positions — they just never appear in the Recommendation Tracker (matches US-23's "calibrate how much to trust each conviction tier" framing, which only makes sense if not every trade generates a tracked "recommendation").

**Ruling — `thesis_conditions`:** US-06/US-15 both reference "measurable thesis conditions" shown on the trade plan / position screens. This plan adds that as a `trade_plans.thesis_conditions` column in **Task 23** (Screen 5–6), not here — Task 20's grid only builds the 9 numeric/date cells the spec's US-12 explicitly lists. See Task 23's ruling for why.

**Ruling — Conviction Score during stress test:** the spec says the score bar "updates as user modifies counter-arguments" but defines no scoring algorithm anywhere (no rubric, no per-edit delta). Inventing one would be an unreviewed judgment call baked silently into the app's risk calibration. Instead, Step 2 makes `conviction_score` a directly user-editable slider (0–100, seeded from Task 9's AI-generated value) that auto-saves via the same extended `PATCH /api/theses/[id]` this task adds — the user, not a made-up formula, is the one who "updates" it after reviewing the bear cases, which is what the spec's underlying intent (challenge conviction before committing) actually requires.

- [ ] **Step 1: Extend `app/api/theses/[id]/route.ts` — add `GET`, extend `PATCH`'s schema**

Add above the existing `PATCH` export:

```typescript
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: thesis, error } = await supabase.from("theses").select("*").eq("id", id).single();
  if (error || !thesis) {
    return NextResponse.json({ error: error?.message ?? "Thesis not found" }, { status: 404 });
  }

  const { data: tradePlan } = await supabase
    .from("trade_plans")
    .select("*")
    .eq("thesis_id", id)
    .maybeSingle();

  const { data: stock } = thesis.stock_id
    ? await supabase.from("stocks").select("exchange, last_price, last_price_at").eq("id", thesis.stock_id).single()
    : { data: null };

  return NextResponse.json({ thesis, tradePlan: tradePlan ?? null, stock: stock ?? null });
}
```

Replace `UpdateThesisSchema` with:

```typescript
const UpdateThesisSchema = z.object({
  status: z.enum(["draft", "active", "closed", "macro"]).optional(),
  bear_cases: z
    .array(z.object({ reason: z.string(), counter: z.string(), modified: z.boolean() }))
    .optional(),
  conviction_score: z.number().min(0).max(100).optional(),
});
```

(`PATCH`'s body is unchanged below that — `.update(parsed.data)` already forwards whichever of the three optional fields are present.)

- [ ] **Step 2: Write the stress-test route test**

```typescript
// app/api/theses/[id]/stress-test/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { generateText } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

const RAW = `\`\`\`json
{"bear_cases":[
  {"reason":"r1","counter":"c1"},{"reason":"r2","counter":"c2"},
  {"reason":"r3","counter":"c3"},{"reason":"r4","counter":"c4"}
]}
\`\`\``;

function buildMock(thesis: Record<string, unknown> | null) {
  const update = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { ...thesis, bear_cases: JSON.parse(RAW.replace(/```json|```/g, "")).bear_cases.map((b: object) => ({ ...b, modified: false })) }, error: null }),
    }),
  });
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: thesis, error: null }) }),
      }),
      update,
    }),
    _update: update,
  };
}

describe("POST /api/theses/[id]/stress-test", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates 4 bear cases and persists them onto the thesis", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildMock({ id: "t1", market_view: "v", mispricing: "m", catalyst: "c", invalidation_condition: "i" }) as never,
    );
    vi.mocked(generateText).mockResolvedValue({ text: RAW } as never);

    const res = await POST(new Request("http://test") as never, { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.thesis.bear_cases).toHaveLength(4);
    expect(body.thesis.bear_cases[0].modified).toBe(false);
  });

  it("returns 404 when the thesis doesn't exist", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildMock(null) as never);
    const res = await POST(new Request("http://test") as never, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — Run: `npx vitest run app/api/theses/[id]/stress-test/__tests__/route.test.ts` — Expected: FAIL, module not found

- [ ] **Step 4: Implement the stress-test route**

```typescript
// app/api/theses/[id]/stress-test/route.ts
import { NextResponse } from "next/server";
import { generateText } from "ai";

import {
  JARVIS_STRESS_TEST_SYSTEM_PROMPT,
  buildStressTestUserContext,
} from "@/lib/jarvis-thesis-prompt";
import { parseStressTestResponse } from "@/lib/jarvis-thesis-parser";
import { jarvisModel } from "@/lib/llm/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Spec Screen 2-3 Step 2 (US-11). Re-runnable — each call overwrites `theses.bear_cases`. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: thesis, error: fetchError } = await supabase
    .from("theses")
    .select("market_view, mispricing, catalyst, invalidation_condition")
    .eq("id", id)
    .single();
  if (fetchError || !thesis) {
    return NextResponse.json({ error: fetchError?.message ?? "Thesis not found" }, { status: 404 });
  }

  let rawResponse: string;
  try {
    const result = await generateText({
      model: jarvisModel,
      system: JARVIS_STRESS_TEST_SYSTEM_PROMPT,
      prompt: buildStressTestUserContext(thesis),
    });
    rawResponse = result.text;
  } catch (err) {
    return NextResponse.json({ error: `Jarvis model call failed: ${errorMessage(err)}` }, { status: 502 });
  }

  const parsed = parseStressTestResponse(rawResponse);
  if (!parsed.ok) {
    return NextResponse.json({ error: `Stress test extraction failed: ${parsed.error}` }, { status: 502 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("theses")
    .update({ bear_cases: parsed.data.bear_cases, raw_llm_response: rawResponse })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "Failed to save bear cases" }, { status: 500 });
  }

  return NextResponse.json({ thesis: updated });
}
```

- [ ] **Step 5: Run to verify it passes** — Run: `npx vitest run app/api/theses/[id]/stress-test/__tests__/route.test.ts` — Expected: PASS (2/2)

- [ ] **Step 6: Write the trade-plan creation route test**

```typescript
// app/api/trade-plans/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildMock(opts: { convictionTier: string; stockId?: string | null }) {
  const tradePlanInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "tp1", thesis_id: "t1" }, error: null }),
    }),
  });
  const recInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "rec1" }, error: null }),
    }),
  });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "theses") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "t1",
                  stock_id: opts.stockId ?? "s1",
                  ticker: "AAPL",
                  conviction_tier: opts.convictionTier,
                  market_view: "v",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "stocks") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { last_price: 150 }, error: null }),
            }),
          }),
        };
      }
      if (table === "trade_plans") return { insert: tradePlanInsert };
      if (table === "jarvis_recommendations") return { insert: recInsert };
      throw new Error(`unexpected table ${table}`);
    }),
    _recInsert: recInsert,
  };
}

const VALID_BODY = {
  thesis_id: "t1",
  entry_zone_low: 140,
  entry_zone_high: 150,
  stop_loss: 130,
  target_1: 170,
  target_2: 190,
  position_size_pct: 5,
};

describe("POST /api/trade-plans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a body missing stop_loss", async () => {
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ thesis_id: "t1" }) });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("creates a jarvis_recommendation for a Tier I thesis", async () => {
    const mock = buildMock({ convictionTier: "I" });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", { method: "POST", body: JSON.stringify(VALID_BODY) });
    const res = await POST(req as never);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.recommendation.id).toBe("rec1");
    expect(mock._recInsert).toHaveBeenCalled();
  });

  it("skips jarvis_recommendation creation for a Tier III thesis", async () => {
    const mock = buildMock({ convictionTier: "III" });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", { method: "POST", body: JSON.stringify(VALID_BODY) });
    const res = await POST(req as never);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.recommendation).toBe(null);
    expect(mock._recInsert).not.toHaveBeenCalled();
  });

  it("rejects a macro thesis with no stock_id", async () => {
    const mock = buildMock({ convictionTier: "I", stockId: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", { method: "POST", body: JSON.stringify(VALID_BODY) });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 7: Run to verify it fails** — Run: `npx vitest run app/api/trade-plans/__tests__/route.test.ts` — Expected: FAIL, module not found

- [ ] **Step 8: Implement `POST /api/trade-plans`**

```typescript
// app/api/trade-plans/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type { TradePlanInsert, JarvisRecommendationInsert, ConvictionTier } from "@/lib/types";

const CreateTradePlanSchema = z.object({
  thesis_id: z.string().min(1),
  entry_zone_low: z.number().nullable().optional(),
  entry_zone_high: z.number().nullable().optional(),
  add_tranche_low: z.number().nullable().optional(),
  add_tranche_high: z.number().nullable().optional(),
  stop_loss: z.number(),
  target_1: z.number().nullable().optional(),
  target_2: z.number().nullable().optional(),
  position_size_pct: z.number().nullable().optional(),
  max_portfolio_pct: z.number().nullable().optional(),
  time_exit_date: z.iso.date().nullable().optional(),
  time_exit_condition: z.string().nullable().optional(),
});

const RECOMMENDATION_TIERS: ConvictionTier[] = ["I", "II"];

/** Spec US-12's last bullet — the only writer of `trade_plans` and (conditionally) `jarvis_recommendations` in the app. See this task's I1 ruling above for the Tier I/II gate. */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateTradePlanSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { thesis_id, ...planFields } = parsed.data;

  const { data: thesis, error: thesisError } = await supabase
    .from("theses")
    .select("id, stock_id, ticker, conviction_tier")
    .eq("id", thesis_id)
    .single();
  if (thesisError || !thesis) {
    return NextResponse.json({ error: thesisError?.message ?? "Thesis not found" }, { status: 404 });
  }
  if (!thesis.stock_id) {
    return NextResponse.json(
      { error: "Cannot build a trade plan for a Macro Thesis with no stock." },
      { status: 400 },
    );
  }

  const aiSuggested: Record<string, unknown> = { ...planFields };
  const insert: TradePlanInsert = {
    thesis_id,
    ...planFields,
    ai_suggested: aiSuggested,
    edited_fields: [],
  };

  const { data: tradePlan, error: insertError } = await supabase
    .from("trade_plans")
    .insert(insert)
    .select("*")
    .single();
  if (insertError || !tradePlan) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create trade plan" }, { status: 500 });
  }

  let recommendation = null;
  if (thesis.conviction_tier && RECOMMENDATION_TIERS.includes(thesis.conviction_tier)) {
    const { data: stock } = await supabase
      .from("stocks")
      .select("last_price")
      .eq("id", thesis.stock_id)
      .single();

    const recInsert: JarvisRecommendationInsert = {
      thesis_id,
      trade_plan_id: tradePlan.id,
      stock_id: thesis.stock_id,
      ticker: thesis.ticker ?? "",
      conviction_tier: thesis.conviction_tier,
      price_at_recommendation: stock?.last_price ?? 0,
      thesis_summary: `${thesis.ticker ?? "Macro"} — Tier ${thesis.conviction_tier} trade plan locked.`,
      recommended_entry_low: planFields.entry_zone_low ?? null,
      recommended_entry_high: planFields.entry_zone_high ?? null,
      recommended_stop: planFields.stop_loss,
      recommended_target_1: planFields.target_1 ?? null,
      recommended_target_2: planFields.target_2 ?? null,
    };

    const { data: rec, error: recError } = await supabase
      .from("jarvis_recommendations")
      .insert(recInsert)
      .select("*")
      .single();
    if (recError) {
      return NextResponse.json({ error: recError.message }, { status: 500 });
    }
    recommendation = rec;
  }

  return NextResponse.json({ tradePlan, recommendation }, { status: 201 });
}
```

- [ ] **Step 9: Run to verify it passes** — Run: `npx vitest run app/api/trade-plans/__tests__/route.test.ts` — Expected: PASS (4/4)

- [ ] **Step 10: Build the stress-test panel**

```typescript
// components/thesis/stress-test-panel.tsx
"use client";

import { useState } from "react";
import type { BearCase } from "@/lib/types";

/** Spec Screen 2-3 Step 2 (US-11): left column = bear cases, right column = counters, horizontally paired. */
export function StressTestPanel({
  thesisId,
  bearCases,
  convictionScore,
  onApproved,
}: {
  thesisId: string;
  bearCases: BearCase[];
  convictionScore: number | null;
  onApproved: () => void;
}) {
  const [cases, setCases] = useState(bearCases);
  const [score, setScore] = useState(convictionScore ?? 50);
  const [saving, setSaving] = useState(false);

  function updateCounter(index: number, counter: string) {
    setCases((prev) => prev.map((c, i) => (i === index ? { ...c, counter, modified: true } : c)));
  }

  async function handleScoreCommit() {
    await fetch(`/api/theses/${thesisId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conviction_score: score }),
    });
  }

  async function handleApprove() {
    setSaving(true);
    try {
      await fetch(`/api/theses/${thesisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bear_cases: cases, conviction_score: score }),
      });
      onApproved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="font-display text-xs uppercase tracking-wide text-on-surface/50">Step 2 of 3</p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-on-surface/60">
          <span>Conviction Score</span>
          <span className="font-mono text-primary">{score}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          onMouseUp={handleScoreCommit}
          onTouchEnd={handleScoreCommit}
          className="w-full accent-[var(--color-primary)]"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cases.map((bc, i) => (
          <div key={i} className="contents">
            <div className="rounded-xl bg-status-red-container p-4">
              <p className="mb-1 font-display text-xs uppercase text-status-red">Bear Case {i + 1}</p>
              <p className="text-sm text-on-surface">{bc.reason}</p>
            </div>
            <div className="rounded-xl bg-status-green-container p-4">
              <div className="mb-1 flex items-center gap-2">
                <p className="font-display text-xs uppercase text-status-green">Counter</p>
                {bc.modified && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] text-primary">Modified</span>
                )}
              </div>
              <textarea
                value={bc.counter}
                onChange={(e) => updateCounter(i, e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg bg-surface-container-highest px-2 py-1 text-sm text-on-surface"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleApprove}
        disabled={saving}
        className="self-start rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
      >
        Stress Test Approved → Build Trade Plan
      </button>
    </div>
  );
}
```

- [ ] **Step 11: Build the trade-plan grid**

```typescript
// components/thesis/trade-plan-grid.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { computeRiskReward, computeMaxDrawdownPct, computeCashAtRisk } from "@/lib/risk-reward";
import { PriceBadge } from "@/components/shared/price-badge";
import type { ExchangeCode } from "@/lib/types";

type GridState = {
  entry_zone_low: string;
  entry_zone_high: string;
  add_tranche_low: string;
  add_tranche_high: string;
  stop_loss: string;
  target_1: string;
  target_2: string;
  position_size_pct: string;
  time_exit_date: string;
  time_exit_condition: string;
};

const EMPTY_GRID: GridState = {
  entry_zone_low: "",
  entry_zone_high: "",
  add_tranche_low: "",
  add_tranche_high: "",
  stop_loss: "",
  target_1: "",
  target_2: "",
  position_size_pct: "",
  time_exit_date: "",
  time_exit_condition: "",
};

/** Spec Screen 2-3 Step 3 (US-12): 9-cell grid. CMP is read-only/fetched, not part of the editable grid state. */
export function TradePlanGrid({
  thesisId,
  cmp,
  exchange,
  portfolioValue = 1_000_000,
}: {
  thesisId: string;
  cmp: number | null;
  exchange: ExchangeCode;
  portfolioValue?: number;
}) {
  const router = useRouter();
  const [grid, setGrid] = useState<GridState>(EMPTY_GRID);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const metrics = useMemo(() => {
    const entry = num(grid.entry_zone_low) ?? cmp;
    const stop = num(grid.stop_loss);
    const target = num(grid.target_1);
    if (entry === null || stop === null) return null;
    return {
      riskReward: target !== null ? computeRiskReward({ entry, stop, target }) : null,
      maxDrawdownPct: computeMaxDrawdownPct({ entry, stop }),
      cashAtRisk: computeCashAtRisk({
        portfolioValue,
        positionSizePct: num(grid.position_size_pct) ?? 0,
        entry,
        stop,
      }),
    };
  }, [grid, cmp, portfolioValue]);

  const canLock = grid.stop_loss.trim() !== "";

  function set(field: keyof GridState, value: string) {
    setGrid((prev) => ({ ...prev, [field]: value }));
  }

  async function handleLock() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/trade-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thesis_id: thesisId,
          entry_zone_low: num(grid.entry_zone_low),
          entry_zone_high: num(grid.entry_zone_high),
          add_tranche_low: num(grid.add_tranche_low),
          add_tranche_high: num(grid.add_tranche_high),
          stop_loss: num(grid.stop_loss),
          target_1: num(grid.target_1),
          target_2: num(grid.target_2),
          position_size_pct: num(grid.position_size_pct),
          time_exit_date: grid.time_exit_date || null,
          time_exit_condition: grid.time_exit_condition || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to lock plan");
      router.push(`/thesis/${thesisId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const FIELDS: { key: keyof GridState; label: string; type: "number" | "date" | "text" }[] = [
    { key: "entry_zone_low", label: "Entry Zone Low", type: "number" },
    { key: "entry_zone_high", label: "Entry Zone High", type: "number" },
    { key: "add_tranche_low", label: "Add Tranche Low", type: "number" },
    { key: "add_tranche_high", label: "Add Tranche High", type: "number" },
    { key: "stop_loss", label: "Stop Loss *", type: "number" },
    { key: "target_1", label: "Target 1", type: "number" },
    { key: "target_2", label: "Target 2", type: "number" },
    { key: "position_size_pct", label: "Position Size %", type: "number" },
    { key: "time_exit_date", label: "Time Exit Date", type: "date" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <p className="font-display text-xs uppercase tracking-wide text-on-surface/50">Step 3 of 3</p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-on-surface/50">CMP:</span>
        <PriceBadge price={cmp} exchange={exchange} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {FIELDS.map(({ key, label, type }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs text-on-surface/50">{label}</span>
            <input
              type={type}
              value={grid[key]}
              onChange={(e) => set(key, e.target.value)}
              className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm font-mono"
            />
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-on-surface/50">Time Exit Condition</span>
        <input
          type="text"
          placeholder='e.g. "Chetak share < 15%"'
          value={grid.time_exit_condition}
          onChange={(e) => set("time_exit_condition", e.target.value)}
          className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
        />
      </label>

      {metrics && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Risk/Reward</p>
            <p className="font-mono text-lg text-on-surface">{metrics.riskReward !== null ? `${metrics.riskReward.toFixed(2)}:1` : "—"}</p>
          </div>
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Max Drawdown</p>
            <p className="font-mono text-lg text-on-surface">{metrics.maxDrawdownPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Cash at Risk</p>
            <p className="font-mono text-lg text-on-surface">{metrics.cashAtRisk.toFixed(0)}</p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-status-red">{error}</p>}

      <button
        type="button"
        onClick={handleLock}
        disabled={!canLock || submitting}
        className="self-start rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
      >
        Lock & Save Plan
      </button>
    </div>
  );
}
```

- [ ] **Step 12: Build the shared "Last updated" indicator**

Spec Section 5 (Global / Cross-Screen Requirements → Price Data): *"'Last updated: [timestamp]' is visible on all screens that display prices."* This is the first task to fetch and render a live price, so it's introduced here rather than deferred — every later price-showing screen (Tasks 21, 23, 24, 29) imports this instead of rebuilding it.

```typescript
// components/shared/last-updated.tsx
import { formatExchangeTime } from "@/lib/format";
import type { ExchangeCode } from "@/lib/types";

/** Spec Section 5 (Price Data): "Last updated: [timestamp]" on every screen showing prices. */
export function LastUpdated({ at, exchange }: { at: string | null; exchange: ExchangeCode }) {
  if (!at) return null;
  return (
    <span className="text-xs text-on-surface/40">
      Last updated: {formatExchangeTime(new Date(at), exchange)}
    </span>
  );
}
```

- [ ] **Step 13: Build the wizard page**

```typescript
// app/(app)/thesis/[id]/plan/page.tsx
"use client";

import { use, useEffect, useState } from "react";

import { StressTestPanel } from "@/components/thesis/stress-test-panel";
import { TradePlanGrid } from "@/components/thesis/trade-plan-grid";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { LastUpdated } from "@/components/shared/last-updated";
import type { BearCase, ConvictionTier, ExchangeCode } from "@/lib/types";

type ThesisDetail = {
  id: string;
  stock_id: string | null;
  ticker: string | null;
  conviction_tier: ConvictionTier | null;
  conviction_score: number | null;
  bear_cases: BearCase[];
};

/**
 * CMP is fetched once, directly, via `POST /api/prices/refresh` (Task 4) —
 * the app's on-demand refresh mechanism (Global Constraint: no client-side
 * polling). There's no "Refresh Prices" button on this single-pass wizard,
 * so `usePriceRefresh` (Task 4's wrapper hook, meant for a page the user
 * stays on and can manually re-trigger) isn't needed here.
 */
export default function ThesisPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [thesis, setThesis] = useState<ThesisDetail | null>(null);
  const [step, setStep] = useState<2 | 3>(2);
  const [cmp, setCmp] = useState<number | null>(null);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);
  const [exchange, setExchange] = useState<ExchangeCode>("US");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/theses/${id}`);
    let body = await res.json();
    let currentThesis: ThesisDetail = body.thesis;
    if (currentThesis.bear_cases.length === 0) {
      await fetch(`/api/theses/${id}/stress-test`, { method: "POST" });
      const refetched = await fetch(`/api/theses/${id}`);
      body = await refetched.json();
      currentThesis = body.thesis;
    }
    setThesis(currentThesis);
    if (body.stock?.exchange) setExchange(body.stock.exchange);

    if (currentThesis.stock_id) {
      const priceRes = await fetch("/api/prices/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockIds: [currentThesis.stock_id] }),
      });
      const priceBody = await priceRes.json();
      const quote = priceBody.prices[currentThesis.stock_id];
      if (quote) {
        setCmp(quote.price);
        setPriceAsOf(quote.asOf);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !thesis) {
    return <SkeletonLoader lines={6} />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="font-display text-2xl text-on-surface">
          {thesis.ticker ?? "Macro Thesis"} — Validation & Plan
        </h1>
        <LastUpdated at={priceAsOf} exchange={exchange} />
      </div>
      {step === 2 ? (
        <StressTestPanel
          thesisId={id}
          bearCases={thesis.bear_cases}
          convictionScore={thesis.conviction_score}
          onApproved={() => setStep(3)}
        />
      ) : (
        <TradePlanGrid thesisId={id} cmp={cmp} exchange={exchange} />
      )}
    </div>
  );
}
```

- [ ] **Step 14: Manual verification**

Run: `npm run dev`, create a thesis via the drawer, click "Approve → Build Trade Plan", confirm it lands on `/thesis/:id/plan` Step 2 with 4 bear cases auto-generated, edit a counter (see "Modified" badge appear), advance to Step 3, confirm Risk/Reward recalculates as Stop/Target change, confirm "Lock & Save Plan" is disabled until Stop Loss has a value, lock it, confirm a `trade_plans` row and (for a Tier I/II thesis) a `jarvis_recommendations` row exist in Supabase.

- [ ] **Step 15: Commit**

```bash
/usr/bin/git add app/api/theses "app/api/theses/[id]/stress-test" app/api/trade-plans "app/(app)/thesis/[id]/plan" components/thesis/stress-test-panel.tsx components/thesis/trade-plan-grid.tsx components/shared/last-updated.tsx
/usr/bin/git commit -m "feat: Screen 2-3 — stress test review + 9-cell trade plan wizard (US-11, US-12)"
```

---

### Task 21: Screen HUB-3 — Stress Test & Trade Plan (review mode)

**Files:**
- Modify: `app/api/theses/route.ts` (add `GET`, alongside Task 9's `POST`)
- Modify: `lib/jarvis-thesis-parser.ts` (I7 fix — see ruling below)
- Modify: `lib/__tests__/jarvis-thesis-parser.test.ts` (add the null-narrative-field case)
- Create: `app/(app)/thesis/page.tsx`
- Create: `app/(app)/thesis/[id]/page.tsx`
- Create: `components/thesis/thesis-list.tsx`

**Interfaces:**
- Consumes: `GET /api/theses/:id` (Task 20), `PATCH /api/trade-plans/:id` (Task 19), `PATCH /api/theses/:id` (Task 19, extended by Task 20), `computeRiskReward`/`computeMaxDrawdownPct` (Task 18), `ConvictionBadge` (Task 10), `LastUpdated` (Task 20), `fetchInternalApi` (Global Constraint)
- Produces: `GET /api/theses` (`{ theses: Thesis[] }`), `/thesis` and `/thesis/:id` pages — the canonical "view any thesis" destination reused by Task 24 (Cockpit position-card click-through), Task 28 (Intelligence Feed's "Link to Thesis"), and Task 29 (Discovery's "HELD"/"DRAFT" badge links).

**Ruling — I7 fix (thesis-prompt/parser nullable-field contradiction):** `JARVIS_THESIS_SYSTEM_PROMPT` (Task 7) explicitly tells the model to "use null for any field you cannot responsibly determine" for every field in its JSON block, but `ThesisExtractSchema` (Task 8) only marked `ticker` as `.nullable()` — the five narrative fields (`market_view`, `mispricing`, `catalyst`, `time_horizon`, `invalidation_condition`) are plain `z.string()`. A model that follows its own system prompt and emits `null` for one of those on a genuinely thin thesis fails schema validation entirely (`extraction.ok: false`), discarding a response that was otherwise usable. This screen is the first one that displays those fields for extended review, so it's the right place to fix the root cause rather than paper over it with more null-coalescing at render time. Fix: relax the five narrative fields to `.nullable()` in `ThesisExtractSchema`, matching the prompt's own contract. `POST /api/theses`'s insert logic (Task 9) already assigns these straight from `parsed.extraction.data.*` into `ThesisInsert` fields that are already `string | null` in the DB — no caller-side changes needed.

- [ ] **Step 1: Apply the I7 fix to `lib/jarvis-thesis-parser.ts`**

Replace `ThesisExtractSchema`'s five narrative fields:

```typescript
export const ThesisExtractSchema = z.object({
  mode: z.enum(["stock_only", "thesis_only", "stock_plus_thesis"]),
  ticker: z.string().nullable(),
  market_view: z.string().nullable(),
  mispricing: z.string().nullable(),
  catalyst: z.string().nullable(),
  time_horizon: z.string().nullable(),
  invalidation_condition: z.string().nullable(),
  conviction_tier: z.enum(["I", "II", "III", "IV"]),
  conviction_score: z.number().min(0).max(100),
  stock_suggestions: z.array(
    z.object({ ticker: z.string(), rationale: z.string() }),
  ),
});
```

- [ ] **Step 2: Add the regression test to `lib/__tests__/jarvis-thesis-parser.test.ts`**

Append inside the existing `describe("parseThesisResponse", ...)` block:

```typescript
  it("accepts a null narrative field per the prompt's own contract (I7 fix)", () => {
    const raw = VALID_RESPONSE.replace('"catalyst": "Z will close the gap.",', '"catalyst": null,');
    const result = parseThesisResponse(raw);
    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.catalyst).toBe(null);
    }
  });
```

- [ ] **Step 3: Run to verify it passes** — Run: `npx vitest run lib/__tests__/jarvis-thesis-parser.test.ts` — Expected: PASS (6/6)

- [ ] **Step 4: Add `GET` to `app/api/theses/route.ts`**

Append below the existing `POST` export:

```typescript
export async function GET() {
  const supabase = createAdminClient();
  const { data: theses, error } = await supabase
    .from("theses")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ theses: theses ?? [] });
}
```

- [ ] **Step 5: Build the thesis list**

```typescript
// components/thesis/thesis-list.tsx
"use client";

import Link from "next/link";
import { ConvictionBadge } from "./conviction-badge";
import type { ConvictionTier, ThesisStatus } from "@/lib/types";

type Row = {
  id: string;
  ticker: string | null;
  status: ThesisStatus;
  conviction_tier: ConvictionTier | null;
  market_view: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<ThesisStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  macro: "Macro",
};

export function ThesisList({ rows }: { rows: Row[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((t) => (
        <Link
          key={t.id}
          href={`/thesis/${t.id}`}
          className="flex items-center justify-between rounded-xl bg-surface-container-low p-4 hover:bg-surface-container-high"
        >
          <div>
            <p className="font-display text-sm text-on-surface">{t.ticker ?? "Macro Thesis"}</p>
            <p className="mt-1 line-clamp-1 text-xs text-on-surface/60">{t.market_view ?? "—"}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-on-surface/50">{STATUS_LABEL[t.status]}</span>
            {t.conviction_tier && <ConvictionBadge tier={t.conviction_tier} />}
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Build the list page**

```typescript
// app/(app)/thesis/page.tsx
import { EmptyState } from "@/components/shared/empty-state";
import { ThesisList } from "@/components/thesis/thesis-list";
import { fetchInternalApi } from "@/lib/server-fetch";

export default async function ThesisListPage() {
  const res = await fetchInternalApi("/api/theses");
  const body = await res.json();
  const rows = body.theses ?? [];

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-on-surface">Stress Test & Trade Plan</h1>
      {rows.length === 0 ? (
        <EmptyState title="No theses yet." description="Start with a thesis →" />
      ) : (
        <ThesisList rows={rows} />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Build the HUB-3 review screen**

```typescript
// app/(app)/thesis/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

import { computeRiskReward, computeMaxDrawdownPct } from "@/lib/risk-reward";
import { ConvictionBadge } from "@/components/thesis/conviction-badge";
import { PriceBadge } from "@/components/shared/price-badge";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { LastUpdated } from "@/components/shared/last-updated";
import type { BearCase, ConvictionTier, ExchangeCode, TradePlan } from "@/lib/types";

type ThesisDetail = {
  id: string;
  stock_id: string | null;
  ticker: string | null;
  market_view: string | null;
  mispricing: string | null;
  catalyst: string | null;
  time_horizon: string | null;
  invalidation_condition: string | null;
  conviction_tier: ConvictionTier | null;
  conviction_score: number | null;
  bear_cases: BearCase[];
  created_at: string;
};

const NARRATIVE_FIELDS: { key: keyof ThesisDetail; label: string }[] = [
  { key: "market_view", label: "Market View" },
  { key: "mispricing", label: "Mispricing" },
  { key: "catalyst", label: "Catalyst" },
  { key: "time_horizon", label: "Time Horizon" },
  { key: "invalidation_condition", label: "Invalidation" },
];

const PLAN_FIELDS: { key: keyof TradePlan; label: string }[] = [
  { key: "entry_zone_low", label: "Entry Low" },
  { key: "entry_zone_high", label: "Entry High" },
  { key: "add_tranche_low", label: "Add Low" },
  { key: "add_tranche_high", label: "Add High" },
  { key: "stop_loss", label: "Stop Loss" },
  { key: "target_1", label: "Target 1" },
  { key: "target_2", label: "Target 2" },
  { key: "position_size_pct", label: "Size %" },
  { key: "time_exit_date", label: "Time Exit" },
];

export default function ThesisReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [thesis, setThesis] = useState<ThesisDetail | null>(null);
  const [tradePlan, setTradePlan] = useState<TradePlan | null>(null);
  const [cmp, setCmp] = useState<number | null>(null);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);
  const [exchange, setExchange] = useState<ExchangeCode>("US");
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/theses/${id}`);
    const body = await res.json();
    setThesis(body.thesis);
    setTradePlan(body.tradePlan);
    if (body.stock?.exchange) setExchange(body.stock.exchange);
    if (body.thesis.stock_id) {
      const priceRes = await fetch("/api/prices/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockIds: [body.thesis.stock_id] }),
      });
      const priceBody = await priceRes.json();
      const quote = priceBody.prices[body.thesis.stock_id];
      if (quote) {
        setCmp(quote.price);
        setPriceAsOf(quote.asOf);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleFieldEdit(field: keyof TradePlan, value: string) {
    if (!tradePlan) return;
    const numeric = value.trim() === "" ? null : Number(value);
    await fetch(`/api/trade-plans/${tradePlan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: numeric }),
    });
    await load();
  }

  /** Ruling: re-runs the stress test only (Task 20's route) — thesis structuring already happened in Screen 1 and locked trade-plan numbers are user-owned once set. No separate "last regenerated" timestamp column exists (Task 1's schema is already live); `thesis.created_at` is shown as the closest available proxy rather than adding a migration for this cosmetic timestamp. */
  async function handleRerun() {
    setRerunning(true);
    try {
      await fetch(`/api/theses/${id}/stress-test`, { method: "POST" });
      await load();
    } finally {
      setRerunning(false);
    }
  }

  if (loading || !thesis) return <SkeletonLoader lines={8} />;

  const riskReward =
    tradePlan?.stop_loss != null && tradePlan?.entry_zone_low != null && tradePlan?.target_1 != null
      ? computeRiskReward({ entry: tradePlan.entry_zone_low, stop: tradePlan.stop_loss, target: tradePlan.target_1 })
      : null;
  const maxDrawdown =
    tradePlan?.stop_loss != null && tradePlan?.entry_zone_low != null
      ? computeMaxDrawdownPct({ entry: tradePlan.entry_zone_low, stop: tradePlan.stop_loss })
      : null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-on-surface">{thesis.ticker ?? "Macro Thesis"}</h1>
          <p className="mt-1 text-xs text-on-surface/50">Last analysed {new Date(thesis.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-3">
          {thesis.conviction_tier && <ConvictionBadge tier={thesis.conviction_tier} />}
          <PriceBadge price={cmp} exchange={exchange} />
          <LastUpdated at={priceAsOf} exchange={exchange} />
        </div>
      </div>

      {thesis.conviction_score !== null && (
        <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${thesis.conviction_score}%` }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-sm uppercase text-on-surface/50">Thesis</h2>
          {NARRATIVE_FIELDS.map(({ key, label }) => (
            <div key={key} className="rounded-xl bg-surface-container-low p-4">
              <p className="mb-1 text-xs uppercase text-on-surface/50">{label}</p>
              <p className="text-sm text-on-surface">{(thesis[key] as string | null) ?? "—"}</p>
            </div>
          ))}
          <div className="flex flex-col gap-3">
            <h3 className="font-display text-sm uppercase text-on-surface/50">Bear Cases</h3>
            {thesis.bear_cases.map((bc, i) => (
              <div key={i} className="rounded-xl bg-surface-container-low p-3 text-sm">
                <p className="text-status-red">{bc.reason}</p>
                <p className="mt-1 text-status-green">{bc.counter}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleRerun}
            disabled={rerunning}
            className="self-start rounded-xl bg-surface-container-highest px-4 py-2 text-xs text-on-surface/70 hover:text-on-surface disabled:opacity-40"
          >
            {rerunning ? "Re-running..." : "Re-run AI Analysis"}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="font-display text-sm uppercase text-on-surface/50">Trade Plan</h2>
          {tradePlan ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                {PLAN_FIELDS.map(({ key, label }) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-xs text-on-surface/50">{label}</span>
                    <input
                      defaultValue={tradePlan[key] as string | number | null ?? ""}
                      onBlur={(e) => handleFieldEdit(key, e.target.value)}
                      className={`rounded-lg px-3 py-2 text-sm font-mono ${
                        tradePlan.edited_fields.includes(key)
                          ? "bg-surface-container-highest text-primary underline decoration-primary decoration-2 underline-offset-4"
                          : "bg-surface-container-highest text-on-surface"
                      }`}
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="text-xs text-on-surface/50">Risk/Reward</p>
                  <p className="font-mono text-lg text-on-surface">{riskReward !== null ? `${riskReward.toFixed(2)}:1` : "—"}</p>
                </div>
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="text-xs text-on-surface/50">Max Drawdown</p>
                  <p className="font-mono text-lg text-on-surface">{maxDrawdown !== null ? `${maxDrawdown.toFixed(1)}%` : "—"}</p>
                </div>
              </div>
            </>
          ) : (
            <Link
              href={`/thesis/${id}/plan`}
              className="rounded-xl bg-primary px-4 py-2 text-center text-sm font-medium text-on-primary"
            >
              Build Trade Plan
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, visit `/thesis` — confirm the list renders and links to `/thesis/:id`; on a thesis with a locked plan, edit a numeric field and confirm it gets the amber-underline treatment (US-07) and auto-saves on blur (no explicit Save button).

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add app/api/theses lib/jarvis-thesis-parser.ts lib/__tests__/jarvis-thesis-parser.test.ts "app/(app)/thesis" components/thesis/thesis-list.tsx
/usr/bin/git commit -m "feat: Screen HUB-3 — thesis list + stress test/trade plan review (US-06, US-07 UI)"
```

---

### Task 22: `POST /api/positions/[id]/exits`

**Files:**
- Create: `app/api/positions/[id]/exits/route.ts`
- Test: `app/api/positions/[id]/exits/__tests__/route.test.ts`
- Modify: `app/api/positions/route.ts` (`GET` — broaden the status filter; see I3 ruling)

**Interfaces:**
- Consumes: `computeWeightedAverageEntry` (Task 11), `createAdminClient`
- Produces: `POST /api/positions/:id/exits` (body `{ date, quantity, price, type, reason?, override?, override_reason? }` → `201 { exit: Exit; remainingQuantity: number; positionStatus: PositionStatus; promptJournal: boolean }`) — consumed by Task 23's Log Trim / Exit — Stop Hit modals.

**Ruling (resolves plan Deferred Finding I3):** `positions.status` becomes `'partial_exit'` here — the moment any exit leaves quantity remaining — and `'closed'` when quantity reaches zero. It was never queried anywhere because `GET /api/positions` (Task 13) filtered `.eq("status", "active")`, silently excluding partially-exited positions from the Active Positions screen even though they're still open and still need monitoring. Fixed below.

- [ ] **Step 1: Broaden `GET /api/positions`'s status filter**

In `app/api/positions/route.ts`, change:

```typescript
    .eq("status", "active");
```

to:

```typescript
    .in("status", ["active", "partial_exit"]);
```

- [ ] **Step 2: Write the exits route test**

```typescript
// app/api/positions/[id]/exits/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildMock(opts: { entries: { quantity: number }[]; existingExits: { quantity: number }[] }) {
  const positionUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "exits") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "ex1", position_id: "p1", quantity: 30, price: 180, type: "trim_t1" },
                error: null,
              }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: opts.existingExits, error: null }),
          }),
        };
      }
      if (table === "entries") {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: opts.entries, error: null }) }) };
      }
      if (table === "positions") {
        return { update: positionUpdate };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _positionUpdate: positionUpdate,
  };
}

describe("POST /api/positions/[id]/exits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets position status to partial_exit when quantity remains", async () => {
    const mock = buildMock({ entries: [{ quantity: 100 }], existingExits: [] });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 30, price: 180, type: "trim_t1" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.remainingQuantity).toBe(70);
    expect(body.positionStatus).toBe("partial_exit");
    expect(body.promptJournal).toBe(false);
    expect(mock._positionUpdate).toHaveBeenCalledWith({ status: "partial_exit" });
  });

  it("sets position status to closed and prompts a journal entry when quantity reaches zero", async () => {
    const mock = buildMock({ entries: [{ quantity: 100 }], existingExits: [{ quantity: 30 }] });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 70, price: 210, type: "trim_t2" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    const body = await res.json();

    expect(body.remainingQuantity).toBe(0);
    expect(body.positionStatus).toBe("closed");
    expect(body.promptJournal).toBe(true);
    expect(mock._positionUpdate).toHaveBeenCalledWith({ status: "closed" });
  });

  it("rejects an override without a reason of at least 40 characters", async () => {
    const mock = buildMock({ entries: [{ quantity: 100 }], existingExits: [] });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 100, price: 80, type: "stop_hit", override: true, override_reason: "too short" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — Run: `npx vitest run app/api/positions/[id]/exits/__tests__/route.test.ts` — Expected: FAIL, module not found

- [ ] **Step 4: Implement**

```typescript
// app/api/positions/[id]/exits/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const AddExitSchema = z
  .object({
    date: z.iso.date(),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().positive(),
    type: z.enum(["trim_t1", "trim_t2", "stop_hit", "time_exit", "manual"]),
    reason: z.string().trim().optional(),
    override: z.boolean().optional(),
    override_reason: z.string().trim().optional(),
  })
  /** Spec US-17: an override reason, when provided, must be at least 40 characters — the deliberate friction that makes a discipline break require actually explaining itself. */
  .refine((data) => !data.override || (data.override_reason?.length ?? 0) >= 40, {
    message: "override_reason must be at least 40 characters when override is true",
    path: ["override_reason"],
  });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: positionId } = await params;
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = AddExitSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: exit, error: insertError } = await supabase
    .from("exits")
    .insert({ position_id: positionId, ...parsed.data })
    .select("*")
    .single();
  if (insertError || !exit) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to insert exit" }, { status: 500 });
  }

  const [{ data: entries, error: entriesError }, { data: exits, error: exitsError }] = await Promise.all([
    supabase.from("entries").select("quantity").eq("position_id", positionId),
    supabase.from("exits").select("quantity").eq("position_id", positionId),
  ]);
  if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 });
  if (exitsError) return NextResponse.json({ error: exitsError.message }, { status: 500 });

  const totalEntered = (entries ?? []).reduce((sum, e) => sum + e.quantity, 0);
  const totalExited = (exits ?? []).reduce((sum, e) => sum + e.quantity, 0);
  const remainingQuantity = totalEntered - totalExited;
  const positionStatus = remainingQuantity <= 0 ? "closed" : "partial_exit";

  const { error: updateError } = await supabase
    .from("positions")
    .update({ status: positionStatus })
    .eq("id", positionId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(
    { exit, remainingQuantity, positionStatus, promptJournal: remainingQuantity <= 0 },
    { status: 201 },
  );
}
```

- [ ] **Step 5: Run to verify it passes** — Run: `npx vitest run app/api/positions/[id]/exits/__tests__/route.test.ts` — Expected: PASS (3/3)

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/api/positions
/usr/bin/git commit -m "feat: POST /api/positions/:id/exits — trim/stop/time exits, position status (US-16, US-17)"
```

---

### Task 23: Screen 5–6 — Exit & Monitoring

**Files:**
- Create: `supabase/migrations/0010_trade_plan_thesis_conditions.sql`
- Modify: `lib/types.ts` (add `ThesisCondition` type; add `thesis_conditions` to `TradePlan`/`TradePlanInsert`)
- Modify: `app/api/trade-plans/[id]/route.ts` (accept `thesis_conditions` outside the `edited_fields` diff loop)
- Modify: `app/api/trade-plans/[id]/__tests__/route.test.ts` (add the `thesis_conditions` case)
- Create: `app/api/positions/[id]/route.ts` (`GET`, joined)
- Create: `app/(app)/positions/[id]/page.tsx`
- Create: `components/positions/exit-ladder.tsx`
- Create: `components/positions/log-trim-modal.tsx`
- Create: `components/positions/stop-exit-modal.tsx`
- Create: `components/positions/thesis-metrics-panel.tsx`
- Create: `components/positions/discipline-banner.tsx`
- Create: `components/positions/positions-page-client.tsx`
- Modify: `app/(app)/positions/page.tsx` (split into a server-fetch shell + `PositionsPageClient`, which renders `DisciplineBanner` for the most urgent position — US-04)

**Interfaces:**
- Consumes: `POST /api/positions/:id/exits` (Task 22), `computeWeightedAverageEntry` (Task 11), `computePositionPnl`/`computeDistanceToStop` (Task 13), `PATCH /api/trade-plans/:id` (Task 19), `LastUpdated` (Task 20), `fetchInternalApi`
- Produces: `GET /api/positions/:id` (`{ position; tradePlan; entries; exits; thesis; stock }`), `<DisciplineBanner />` reused by Task 24's Cockpit alert rail.

**Ruling — `thesis_conditions` (resolves the "3-4 key measurable thesis conditions" requirement from US-15):** the spec names this field but Task 1's already-migrated, already-live schema has nowhere to store it — `trade_plans` has no such column, and no other table fits. Since Task 1's schema is a done, deployed migration (not something this plan revises after the fact), this task adds one small forward migration rather than inventing an unpersisted client-only workaround for a real financial-tracking field. `thesis_conditions` is a `jsonb` array of `{ label, target, currentValue }`, editable from this screen and (optionally, left empty at creation) from Task 20's wizard.

- [ ] **Step 1: Write the migration**

```sql
-- 0010_trade_plan_thesis_conditions.sql
-- US-15's "3-4 key measurable thesis conditions" — has no column anywhere in the
-- Task 1 schema. Added here, where it's first surfaced to the user, rather than
-- retrofitted into an already-applied migration.
alter table trade_plans add column thesis_conditions jsonb not null default '[]';
```

Run: `mcp__claude_ai_Supabase__apply_migration` for this file. Verify with `mcp__claude_ai_Supabase__list_tables` that `trade_plans.thesis_conditions` exists.

- [ ] **Step 2: Add `ThesisCondition` to `lib/types.ts`**

```typescript
/** One measurable thesis condition tracked on a locked trade plan (spec US-15). */
export type ThesisCondition = {
  label: string;
  target: string;
  currentValue: string;
};
```

Add `thesis_conditions: ThesisCondition[];` to the `TradePlan` type, and add `"thesis_conditions"` to `TradePlanInsert`'s `Partial<Pick<TradePlan, ...>>` field list.

- [ ] **Step 3: Extend `app/api/trade-plans/[id]/route.ts` to accept `thesis_conditions`**

Replace `UpdateTradePlanSchema` with:

```typescript
const UpdateTradePlanSchema = z
  .object({
    ...Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, z.union([z.number(), z.string()]).nullable().optional()])),
    thesis_conditions: z
      .array(z.object({ label: z.string(), target: z.string(), currentValue: z.string() }))
      .optional(),
  })
  .strict();
```

Then, in the `PATCH` handler, destructure `thesis_conditions` out of `parsed.data` **before** the `edited_fields` diff loop, so it's applied to the update but never treated as an AI-suggested field to diff against:

```typescript
  const { thesis_conditions, ...editableData } = parsed.data;

  const aiSuggested = (existing.ai_suggested ?? {}) as Record<string, unknown>;
  const existingEditedFields = new Set<string>(existing.edited_fields ?? []);
  for (const [field, value] of Object.entries(editableData)) {
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
      ...editableData,
      ...(thesis_conditions !== undefined ? { thesis_conditions } : {}),
      edited_fields: [...existingEditedFields],
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
```

- [ ] **Step 4: Add the regression test**

Append to `app/api/trade-plans/[id]/__tests__/route.test.ts`:

```typescript
  it("updates thesis_conditions without adding it to edited_fields", async () => {
    const req = new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ thesis_conditions: [{ label: "Chetak share", target: ">=18%", currentValue: "16%" }] }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: "tp1" }) });
    expect(res.status).toBe(200);
    const updateArg = vi.mocked(createAdminClient).mock.results[0].value.from().update.mock.calls[0][0];
    expect(updateArg.thesis_conditions).toHaveLength(1);
    expect(updateArg.edited_fields ?? []).not.toContain("thesis_conditions");
  });
```

- [ ] **Step 5: Run to verify it passes** — Run: `npx vitest run app/api/trade-plans/[id]/__tests__/route.test.ts` — Expected: PASS (2/2)

- [ ] **Step 6: Build `GET /api/positions/[id]`**

```typescript
// app/api/positions/[id]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .select("*")
    .eq("id", id)
    .single();
  if (positionError || !position) {
    return NextResponse.json({ error: positionError?.message ?? "Position not found" }, { status: 404 });
  }

  const [{ data: entries }, { data: exits }, { data: tradePlan }, { data: thesis }, { data: stock }] = await Promise.all([
    supabase.from("entries").select("*").eq("position_id", id).order("date", { ascending: true }),
    supabase.from("exits").select("*").eq("position_id", id).order("date", { ascending: true }),
    supabase.from("trade_plans").select("*").eq("id", position.trade_plan_id).single(),
    supabase.from("theses").select("*").eq("id", position.thesis_id).single(),
    supabase.from("stocks").select("*").eq("id", position.stock_id).single(),
  ]);

  return NextResponse.json({
    position,
    entries: entries ?? [],
    exits: exits ?? [],
    tradePlan: tradePlan ?? null,
    thesis: thesis ?? null,
    stock: stock ?? null,
  });
}
```

- [ ] **Step 7: Build the exit ladder**

```typescript
// components/positions/exit-ladder.tsx
"use client";

import type { Exit, TradePlan } from "@/lib/types";

type LadderRow = { key: string; label: string; status: "PENDING" | "HIT" | "DONE" };

/** Spec US-15: 5-row exit ladder — T1 Trim (40%) / T2 Trim (40%) / Runner Hold (20%) / Stop Exit / Time Exit. */
export function ExitLadder({
  tradePlan,
  exits,
  currentPrice,
  onLogTrim,
  onLogStop,
}: {
  tradePlan: TradePlan;
  exits: Exit[];
  currentPrice: number | null;
  onLogTrim: (tier: "trim_t1" | "trim_t2") => void;
  onLogStop: () => void;
}) {
  const hasExit = (type: Exit["type"]) => exits.some((e) => e.type === type);

  const rows: LadderRow[] = [
    {
      key: "trim_t1",
      label: "T1 Trim (40%)",
      status: hasExit("trim_t1") ? "DONE" : currentPrice !== null && tradePlan.target_1 !== null && currentPrice >= tradePlan.target_1 ? "HIT" : "PENDING",
    },
    {
      key: "trim_t2",
      label: "T2 Trim (40%)",
      status: hasExit("trim_t2") ? "DONE" : currentPrice !== null && tradePlan.target_2 !== null && currentPrice >= tradePlan.target_2 ? "HIT" : "PENDING",
    },
    { key: "runner", label: "Runner Hold (20%)", status: hasExit("trim_t1") && hasExit("trim_t2") ? "DONE" : "PENDING" },
    {
      key: "stop_hit",
      label: "Stop Exit",
      status: hasExit("stop_hit") ? "DONE" : currentPrice !== null && tradePlan.stop_loss !== null && currentPrice <= tradePlan.stop_loss ? "HIT" : "PENDING",
    },
    { key: "time_exit", label: "Time Exit", status: hasExit("time_exit") ? "DONE" : "PENDING" },
  ];

  const STATUS_STYLE: Record<LadderRow["status"], string> = {
    PENDING: "text-on-surface/40",
    HIT: "text-primary",
    DONE: "text-status-green",
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-4">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between py-2">
          <span className="text-sm text-on-surface">{row.label}</span>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium ${STATUS_STYLE[row.status]}`}>{row.status}</span>
            {row.key === "trim_t1" && row.status !== "DONE" && (
              <button type="button" onClick={() => onLogTrim("trim_t1")} className="text-xs text-primary underline">
                Log Trim
              </button>
            )}
            {row.key === "trim_t2" && row.status !== "DONE" && (
              <button type="button" onClick={() => onLogTrim("trim_t2")} className="text-xs text-primary underline">
                Log Trim
              </button>
            )}
            {row.key === "stop_hit" && row.status !== "DONE" && (
              <button type="button" onClick={onLogStop} className="text-xs text-status-red underline">
                Exit — Stop Hit
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Build the trim/stop modals**

```typescript
// components/positions/log-trim-modal.tsx
"use client";

import { useState } from "react";

/** Spec US-16. On save, `promptJournal` in the response (Task 22) drives navigation to Screen 7 if this was the final exit. */
export function LogTrimModal({
  positionId,
  tier,
  onClose,
  onSaved,
}: {
  positionId: string;
  tier: "trim_t1" | "trim_t2" | "manual";
  onClose: () => void;
  onSaved: (promptJournal: boolean) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/positions/${positionId}/exits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, quantity: Number(quantity), price: Number(price), type: tier }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to log trim");
      onSaved(body.promptJournal);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-4 font-display text-lg text-on-surface">Log Trim</h2>
        <div className="mb-4 flex flex-col gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input type="number" placeholder="Quantity Sold" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input type="number" placeholder="Price Sold At" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !quantity || !price}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

```typescript
// components/positions/stop-exit-modal.tsx
"use client";

import { useState } from "react";

/** Spec US-17. Override reason must be ≥40 chars — enforced client-side for immediate feedback and again server-side (Task 22) as the source of truth. */
export function StopExitModal({
  positionId,
  remainingQuantity,
  onClose,
  onSaved,
}: {
  positionId: string;
  remainingQuantity: number;
  onClose: () => void;
  onSaved: (promptJournal: boolean) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOverride = overrideReason.trim().length > 0;
  const overrideTooShort = isOverride && overrideReason.trim().length < 40;

  async function handleSubmit() {
    if (overrideTooShort) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${positionId}/exits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          quantity: remainingQuantity,
          price: Number(price),
          type: "stop_hit",
          override: isOverride,
          override_reason: isOverride ? overrideReason : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to log exit");
      onSaved(body.promptJournal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-4 font-display text-lg text-on-surface">Exit — Stop Hit</h2>
        <div className="mb-4 flex flex-col gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <p className="text-xs text-on-surface/50">Quantity (full remaining): {remainingQuantity}</p>
          <input type="number" placeholder="Price Sold At" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <textarea
            placeholder="Override reason (optional — leave blank to exit per plan)"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            rows={3}
            className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
          />
          {overrideTooShort && (
            <p className="text-xs text-status-red">Override reason must be at least 40 characters ({overrideReason.trim().length}/40).</p>
          )}
        </div>
        {error && <p className="mb-3 text-sm text-status-red">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !price || overrideTooShort}
            className="rounded-xl bg-status-red px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
          >
            {isOverride ? "Override & Exit" : "Exit Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Build the thesis-metrics panel**

```typescript
// components/positions/thesis-metrics-panel.tsx
"use client";

import { useState } from "react";
import type { ThesisCondition } from "@/lib/types";

/** Spec US-15: 3-4 measurable thesis conditions with editable current values — see this task's ruling for `thesis_conditions`'s migration. */
export function ThesisMetricsPanel({
  tradePlanId,
  conditions,
  warningText,
}: {
  tradePlanId: string;
  conditions: ThesisCondition[];
  warningText: string | null;
}) {
  const [rows, setRows] = useState(conditions);

  async function handleBlur(index: number, value: string) {
    const next = rows.map((r, i) => (i === index ? { ...r, currentValue: value } : r));
    setRows(next);
    await fetch(`/api/trade-plans/${tradePlanId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thesis_conditions: next }),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-sm uppercase text-on-surface/50">Thesis Metrics</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-on-surface/50">No thesis conditions tracked for this plan.</p>
      ) : (
        rows.map((c, i) => (
          <div key={c.label} className="flex items-center justify-between rounded-xl bg-surface-container-low p-3">
            <div>
              <p className="text-sm text-on-surface">{c.label}</p>
              <p className="text-xs text-on-surface/50">needs {c.target}</p>
            </div>
            <input
              defaultValue={c.currentValue}
              onBlur={(e) => handleBlur(i, e.target.value)}
              className="w-24 rounded-lg bg-surface-container-highest px-2 py-1 text-right text-sm font-mono"
            />
          </div>
        ))
      )}
      {warningText && (
        <div className="rounded-xl bg-primary-container px-4 py-3 text-sm text-primary">{warningText}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Build the discipline banner (US-04)**

```typescript
// components/positions/discipline-banner.tsx
"use client";

/** Spec US-04. Blocking red banner when at/through stop; non-blocking amber toast-style bar when a target has been reached but not yet trimmed. Reused by Task 24's Cockpit alert rail (rendered smaller there). */
export function DisciplineBanner({
  ticker,
  currentPrice,
  stopLoss,
  target1,
  t1Trimmed,
  onExitNow,
  onLogTrim,
}: {
  ticker: string;
  currentPrice: number | null;
  stopLoss: number | null;
  target1: number | null;
  t1Trimmed: boolean;
  onExitNow: () => void;
  onLogTrim: () => void;
}) {
  if (currentPrice === null) return null;

  if (stopLoss !== null && currentPrice <= stopLoss) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl bg-status-red-container px-4 py-3">
        <span className="text-sm font-medium text-status-red">
          Stop Hit — {ticker} at {currentPrice}. Exit required.
        </span>
        <button type="button" onClick={onExitNow} className="rounded-lg bg-status-red px-3 py-1.5 text-xs font-medium text-on-primary">
          Exit Now
        </button>
      </div>
    );
  }

  if (!t1Trimmed && target1 !== null && currentPrice >= target1) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl bg-primary-container px-4 py-3">
        <span className="text-sm font-medium text-primary">T1 Hit — {ticker}. Trim 40%?</span>
        <div className="flex gap-2">
          <button type="button" onClick={onLogTrim} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary">
            Confirm
          </button>
        </div>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 11: Build the Screen 5–6 page**

```typescript
// app/(app)/positions/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { computePositionPnl, computeDistanceToStop } from "@/lib/position-metrics";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { ExitLadder } from "@/components/positions/exit-ladder";
import { LogTrimModal } from "@/components/positions/log-trim-modal";
import { StopExitModal } from "@/components/positions/stop-exit-modal";
import { ThesisMetricsPanel } from "@/components/positions/thesis-metrics-panel";
import { DisciplineBanner } from "@/components/positions/discipline-banner";
import { PriceBadge } from "@/components/shared/price-badge";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { LastUpdated } from "@/components/shared/last-updated";
import type { Entry, Exit, Position, Thesis, TradePlan, Stock } from "@/lib/types";

type Detail = {
  position: Position;
  entries: Entry[];
  exits: Exit[];
  tradePlan: TradePlan | null;
  thesis: Thesis | null;
  stock: Stock | null;
};

export default function PositionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [trimTier, setTrimTier] = useState<"trim_t1" | "trim_t2" | null>(null);
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/positions/${id}`);
    const body = await res.json();
    setDetail(body);
    if (body.stock?.id) {
      await fetch("/api/prices/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockIds: [body.stock.id] }),
      });
      const refreshed = await fetch(`/api/positions/${id}`);
      setDetail(await refreshed.json());
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function handleSaved(promptJournal: boolean) {
    setTrimTier(null);
    setStopModalOpen(false);
    if (promptJournal) {
      router.push(`/journal/new?positionId=${id}`);
    } else {
      load();
    }
  }

  if (loading || !detail || !detail.tradePlan) return <SkeletonLoader lines={8} />;

  const { position, entries, exits, tradePlan, thesis, stock } = detail;
  const weightedAverage = computeWeightedAverageEntry(entries);
  const currentPrice = stock?.last_price ?? null;
  const remaining = weightedAverage.totalQuantity - exits.reduce((s, e) => s + e.quantity, 0);
  const pnl = currentPrice !== null ? computePositionPnl({ currentPrice, avgEntry: weightedAverage.averagePrice, quantity: remaining }) : null;
  const distToStop = currentPrice !== null ? computeDistanceToStop({ currentPrice, stopLoss: tradePlan.stop_loss }) : null;
  const distToT1 = currentPrice !== null && tradePlan.target_1 !== null ? tradePlan.target_1 - currentPrice : null;
  const distToT2 = currentPrice !== null && tradePlan.target_2 !== null ? tradePlan.target_2 - currentPrice : null;

  return (
    <div>
      <DisciplineBanner
        ticker={position.ticker}
        currentPrice={currentPrice}
        stopLoss={tradePlan.stop_loss}
        target1={tradePlan.target_1}
        t1Trimmed={exits.some((e) => e.type === "trim_t1")}
        onExitNow={() => setStopModalOpen(true)}
        onLogTrim={() => setTrimTier("trim_t1")}
      />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl text-on-surface">{position.ticker}</h1>
        <div className="flex items-center gap-3">
          <PriceBadge price={currentPrice} exchange={stock?.exchange ?? "US"} />
          <LastUpdated at={stock?.last_price_at ?? null} exchange={stock?.exchange ?? "US"} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Avg Entry</p>
            <p className="font-mono text-lg text-on-surface">{weightedAverage.averagePrice.toFixed(2)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Return</p>
              <p className={`font-mono text-lg ${pnl && pnl.percent >= 0 ? "text-status-green" : "text-status-red"}`}>
                {pnl ? `${pnl.percent >= 0 ? "+" : ""}${pnl.percent.toFixed(2)}%` : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Dist. to Stop</p>
              <p className="font-mono text-lg text-on-surface">{distToStop ? distToStop.rupees.toFixed(2) : "—"}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Dist. to T1</p>
              <p className="font-mono text-lg text-on-surface">{distToT1 !== null ? distToT1.toFixed(2) : "—"}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Dist. to T2</p>
              <p className="font-mono text-lg text-on-surface">{distToT2 !== null ? distToT2.toFixed(2) : "—"}</p>
            </div>
          </div>
          <ThesisMetricsPanel
            tradePlanId={tradePlan.id}
            conditions={tradePlan.thesis_conditions}
            warningText={thesis?.invalidation_condition ?? null}
          />
        </div>

        <ExitLadder
          tradePlan={tradePlan}
          exits={exits}
          currentPrice={currentPrice}
          onLogTrim={setTrimTier}
          onLogStop={() => setStopModalOpen(true)}
        />
      </div>

      {trimTier && (
        <LogTrimModal positionId={position.id} tier={trimTier} onClose={() => setTrimTier(null)} onSaved={handleSaved} />
      )}
      {stopModalOpen && (
        <StopExitModal positionId={position.id} remainingQuantity={remaining} onClose={() => setStopModalOpen(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
```

- [ ] **Step 12: Wire the banner into the Positions list (US-04's HUB-2 half)**

`DisciplineBanner` needs `router.push` for its button handlers, which a server component can't hold — so `app/(app)/positions/page.tsx` (currently a server component, Task 13) splits into a server component that does the `fetchInternalApi` call and a new client component that renders the banner + table. `t1Trimmed` is hardcoded `false` below deliberately: the list view's `GET /api/positions` join (Task 13) doesn't include each row's `exits`, only Task 23's own `GET /api/positions/:id` does — the banner re-evaluates with real exit data once the user is on that position's own detail page, so a stale `false` here just means this list-level banner never shows "already trimmed" and always offers the trim action, which is the safe direction to be wrong in (a redundant offer, not a missed alert).

Create `components/positions/positions-page-client.tsx`:

```typescript
// components/positions/positions-page-client.tsx
"use client";

import { useRouter } from "next/navigation";

import { computeDistanceToStop } from "@/lib/position-metrics";
import { DisciplineBanner } from "./discipline-banner";
import { PositionsTable, type PositionRow } from "./positions-table";

export function PositionsPageClient({ rows }: { rows: PositionRow[] }) {
  const router = useRouter();

  const withDistance = rows
    .filter((r) => r.stock?.last_price != null)
    .map((r) => ({
      row: r,
      distance: computeDistanceToStop({ currentPrice: r.stock!.last_price!, stopLoss: r.tradePlan?.stop_loss ?? null }),
    }))
    .filter((x): x is { row: PositionRow; distance: NonNullable<ReturnType<typeof computeDistanceToStop>> } => x.distance !== null)
    .sort((a, b) => a.distance.rupees - b.distance.rupees);
  const mostUrgent = withDistance[0]?.row;

  return (
    <>
      {mostUrgent && (
        <DisciplineBanner
          ticker={mostUrgent.position.ticker}
          currentPrice={mostUrgent.stock?.last_price ?? null}
          stopLoss={mostUrgent.tradePlan?.stop_loss ?? null}
          target1={mostUrgent.tradePlan?.target_1 ?? null}
          t1Trimmed={false}
          onExitNow={() => router.push(`/positions/${mostUrgent.position.id}`)}
          onLogTrim={() => router.push(`/positions/${mostUrgent.position.id}`)}
        />
      )}
      <PositionsTable rows={rows} />
    </>
  );
}
```

Replace `app/(app)/positions/page.tsx` in full:

```typescript
// app/(app)/positions/page.tsx
import { EmptyState } from "@/components/shared/empty-state";
import { PositionsPageClient } from "@/components/positions/positions-page-client";
import type { PositionRow } from "@/components/positions/positions-table";
import { fetchInternalApi } from "@/lib/server-fetch";

async function fetchPositions(): Promise<PositionRow[]> {
  const res = await fetchInternalApi("/api/positions");
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
        <PositionsPageClient rows={rows} />
      )}
    </div>
  );
}
```

- [ ] **Step 13: Manual verification**

Run: `npm run dev`, open a position with a trade plan, log a trim on T1, confirm the exit ladder row flips to DONE and the position's remaining quantity/P&L update; log a full stop exit, confirm you're redirected to `/journal/new?positionId=...`.

- [ ] **Step 14: Commit**

```bash
/usr/bin/git add supabase/migrations/0010_trade_plan_thesis_conditions.sql lib/types.ts app/api/trade-plans app/api/positions "app/(app)/positions" components/positions
/usr/bin/git commit -m "feat: Screen 5-6 — Exit & Monitoring, exit ladder, discipline banner (US-04, US-15, US-16, US-17)"
```

---

### Task 24: Screen HUB-1 — Velocity Cockpit dashboard

**Files:**
- Create: `app/api/cockpit/route.ts`
- Modify: `app/(app)/page.tsx` (replace the Task 19 fix-wave stopgap redirect with the real dashboard)
- Create: `components/cockpit/portfolio-summary.tsx`
- Create: `components/cockpit/alert-rail.tsx`
- Test: `app/api/cockpit/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `computeWeightedAverageEntry` (Task 11), `computePositionPnl`/`computeDistanceToStop` (Task 13), `RecommendationStats` (Task 16, with its new `compact` prop — see Step 4), `useNewThesisDrawer` (Task 6), `LastUpdated` (Task 20), `fetchInternalApi`
- Produces: `GET /api/cockpit` (`{ positions: PositionRow[]; recommendations: RecommendationRow[]; totalOpenPnl: { absolute: number; percent: number }; overdueTickers: string[] }`) — the dashboard's single aggregated read.

**Ruling — "today / week / MTD" P&L (spec US-01):** the v2 schema deliberately dropped `price_cache` (plan Decision #2 — full schema replace) and nothing in Task 1's live schema stores a time series of portfolio value. Computing a genuine day-over-day or week-over-week P&L delta requires a snapshot table populated on a schedule (a new migration plus a new cron-invoked Edge Function), which is out of scope for what is otherwise a UI-assembly task over data this plan already has. Rather than fabricate a "today %" number from data that can't support it, this task ships the one P&L figure the schema **can** compute correctly — total unrealized P&L across all open positions, since entry — labeled honestly as "Total Open P&L," not "Today." The day/week/MTD breakdown is a real, named gap for a future task (a `portfolio_snapshots` table + a new scheduled Edge Function), not a silent omission.

- [ ] **Step 1: Write the cockpit route test**

```typescript
// app/api/cockpit/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { GET } from "../route";

function buildMock() {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = "2020-01-01";
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") {
        return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [{ id: "p1", ticker: "AAPL", stock_id: "s1", trade_plan_id: "tp1", thesis_id: "t1", status: "active" }], error: null }) }) };
      }
      if (table === "entries") {
        return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [{ position_id: "p1", quantity: 10, price: 100 }], error: null }) }) };
      }
      if (table === "exits") {
        return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      }
      if (table === "stocks") {
        return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [{ id: "s1", last_price: 120, exchange: "US" }], error: null }) }) };
      }
      if (table === "trade_plans") {
        return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: overdue }], error: null }) }) };
      }
      if (table === "theses") {
        return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [{ id: "t1", conviction_tier: "I" }], error: null }) }) };
      }
      if (table === "jarvis_recommendations") {
        return { select: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("GET /api/cockpit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates positions, total open P&L, and overdue theses", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildMock() as never);
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalOpenPnl.absolute).toBe(200); // (120-100)*10
    expect(body.overdueTickers).toContain("AAPL");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run app/api/cockpit/__tests__/route.test.ts` — Expected: FAIL, module not found

- [ ] **Step 3: Implement the route**

```typescript
// app/api/cockpit/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { computePositionPnl } from "@/lib/position-metrics";

export async function GET() {
  const supabase = createAdminClient();

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("*")
    .in("status", ["active", "partial_exit"]);
  if (positionsError) return NextResponse.json({ error: positionsError.message }, { status: 500 });

  const positionRows = positions ?? [];
  const positionIds = positionRows.map((p) => p.id);
  const stockIds = [...new Set(positionRows.map((p) => p.stock_id))];
  const tradePlanIds = [...new Set(positionRows.map((p) => p.trade_plan_id))];
  const thesisIds = [...new Set(positionRows.map((p) => p.thesis_id))];

  const [{ data: entries }, { data: exits }, { data: stocks }, { data: tradePlans }, { data: theses }, { data: recs }] =
    await Promise.all([
      positionIds.length ? supabase.from("entries").select("*").in("position_id", positionIds) : Promise.resolve({ data: [] }),
      positionIds.length ? supabase.from("exits").select("*").in("position_id", positionIds) : Promise.resolve({ data: [] }),
      stockIds.length ? supabase.from("stocks").select("*").in("id", stockIds) : Promise.resolve({ data: [] }),
      tradePlanIds.length ? supabase.from("trade_plans").select("*").in("id", tradePlanIds) : Promise.resolve({ data: [] }),
      thesisIds.length ? supabase.from("theses").select("id, conviction_tier").in("id", thesisIds) : Promise.resolve({ data: [] }),
      supabase.from("jarvis_recommendations").select("*").order("recommended_at", { ascending: false }),
    ]);

  const entriesByPosition = new Map<string, { quantity: number; price: number }[]>();
  for (const e of entries ?? []) {
    const list = entriesByPosition.get(e.position_id) ?? [];
    list.push({ quantity: e.quantity, price: e.price });
    entriesByPosition.set(e.position_id, list);
  }
  const exitedByPosition = new Map<string, number>();
  for (const ex of exits ?? []) {
    exitedByPosition.set(ex.position_id, (exitedByPosition.get(ex.position_id) ?? 0) + ex.quantity);
  }
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));
  const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));
  const thesisById = new Map((theses ?? []).map((t) => [t.id, t]));

  let totalAbsolute = 0;
  const positionResult = positionRows.map((p) => {
    const stock = stockById.get(p.stock_id);
    const tradePlan = tradePlanById.get(p.trade_plan_id);
    const weightedAverage = computeWeightedAverageEntry(entriesByPosition.get(p.id) ?? []);
    const remaining = weightedAverage.totalQuantity - (exitedByPosition.get(p.id) ?? 0);
    if (stock?.last_price != null && remaining > 0) {
      totalAbsolute += computePositionPnl({ currentPrice: stock.last_price, avgEntry: weightedAverage.averagePrice, quantity: remaining }).absolute;
    }
    return {
      position: p,
      stock,
      tradePlan,
      weightedAverage,
      convictionTier: thesisById.get(p.thesis_id)?.conviction_tier ?? undefined,
    };
  });

  const totalCost = positionResult.reduce((sum, r) => sum + r.weightedAverage.averagePrice * r.weightedAverage.totalQuantity, 0);
  const totalOpenPnl = { absolute: totalAbsolute, percent: totalCost > 0 ? (totalAbsolute / totalCost) * 100 : 0 };

  const today = new Date().toISOString().slice(0, 10);
  const overdueTickers = positionRows
    .filter((p) => {
      const tp = tradePlanById.get(p.trade_plan_id);
      return tp?.time_exit_date != null && tp.time_exit_date < today;
    })
    .map((p) => p.ticker);

  const recStockIds = [...new Set((recs ?? []).map((r) => r.stock_id))];
  const { data: recStocks } = recStockIds.length
    ? await supabase.from("stocks").select("id, last_price, exchange").in("id", recStockIds)
    : { data: [] };
  const recStockById = new Map((recStocks ?? []).map((s) => [s.id, s]));
  const recommendations = (recs ?? []).map((r) => ({ recommendation: r, stock: recStockById.get(r.stock_id) }));

  return NextResponse.json({ positions: positionResult, recommendations, totalOpenPnl, overdueTickers });
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `npx vitest run app/api/cockpit/__tests__/route.test.ts` — Expected: PASS (1/1)

- [ ] **Step 5: Add a `compact` prop to `components/recommendations/recommendation-stats.tsx`**

Add `compact?: boolean` to its props and, when true, render only the 5-stat grid (skip the per-tier row and the Hypothetical P&L toggle) — reuses the same `stats` computation, no duplicated logic (spec US-02, this component's own Task 16 comment already anticipated this reuse):

```typescript
export function RecommendationStats({ rows, compact = false }: { rows: Row[]; compact?: boolean }) {
  // ...existing `stats` useMemo unchanged...

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {/* ...unchanged 5-stat grid... */}
      </div>
      {!compact && (
        <div className="flex items-center gap-4 text-xs text-on-surface/60">
          {/* ...unchanged tier breakdown + hypothetical toggle... */}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Build the portfolio summary + alert rail**

```typescript
// components/cockpit/portfolio-summary.tsx
export function PortfolioSummary({
  totalOpenPnl,
  positionCount,
  pendingRecCount,
}: {
  totalOpenPnl: { absolute: number; percent: number };
  positionCount: number;
  pendingRecCount: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="text-xs uppercase text-on-surface/50">Total Open P&L</p>
        <p className={`mt-1 font-mono text-xl ${totalOpenPnl.absolute >= 0 ? "text-status-green" : "text-status-red"}`}>
          {totalOpenPnl.absolute >= 0 ? "+" : ""}
          {totalOpenPnl.absolute.toFixed(2)} ({totalOpenPnl.percent.toFixed(2)}%)
        </p>
      </div>
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="text-xs uppercase text-on-surface/50">Active Positions</p>
        <p className="mt-1 font-mono text-xl text-on-surface">{positionCount}</p>
      </div>
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="text-xs uppercase text-on-surface/50">Pending Recommendations</p>
        <p className="mt-1 font-mono text-xl text-on-surface">{pendingRecCount}</p>
      </div>
    </div>
  );
}
```

```typescript
// components/cockpit/alert-rail.tsx
import Link from "next/link";
import { computeDistanceToStop } from "@/lib/position-metrics";
import type { PositionRow } from "@/components/positions/positions-table";

/** Spec US-01: RED pill within 3% of stop, AMBER chip for an overdue thesis-test date. */
export function AlertRail({ positions, overdueTickers }: { positions: PositionRow[]; overdueTickers: string[] }) {
  const nearStop = positions.filter((r) => {
    if (r.stock?.last_price == null || r.tradePlan?.stop_loss == null) return false;
    const dist = computeDistanceToStop({ currentPrice: r.stock.last_price, stopLoss: r.tradePlan.stop_loss });
    return dist !== null && dist.percent <= 3;
  });

  if (nearStop.length === 0 && overdueTickers.length === 0) return null;

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {nearStop.map((r) => (
        <Link
          key={r.position.id}
          href={`/positions/${r.position.id}`}
          className="rounded-full bg-status-red-container px-3 py-1 text-xs font-medium text-status-red"
        >
          {r.position.ticker} near stop
        </Link>
      ))}
      {overdueTickers.map((ticker) => (
        <span key={ticker} className="rounded-full bg-primary-container px-3 py-1 text-xs font-medium text-primary">
          ⏱ Thesis Test Overdue — {ticker}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Replace the stopgap `app/(app)/page.tsx`**

```typescript
// app/(app)/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { PortfolioSummary } from "@/components/cockpit/portfolio-summary";
import { AlertRail } from "@/components/cockpit/alert-rail";
import { PositionsTable, type PositionRow } from "@/components/positions/positions-table";
import { RecommendationStats } from "@/components/recommendations/recommendation-stats";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { useNewThesisDrawer } from "@/components/layout/new-thesis-context";

export default function CockpitPage() {
  const { open } = useNewThesisDrawer();
  const [data, setData] = useState<{
    positions: PositionRow[];
    recommendations: Parameters<typeof RecommendationStats>[0]["rows"];
    totalOpenPnl: { absolute: number; percent: number };
    overdueTickers: string[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/cockpit")
      .then((res) => res.json())
      .then(setData);
  }, []);

  if (!data) return <SkeletonLoader lines={6} />;

  const pendingRecCount = data.recommendations.filter((r) => !r.recommendation.converted_to_position).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl text-on-surface">Velocity Cockpit</h1>
        <button
          type="button"
          onClick={() => open()}
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary shadow-ambient"
        >
          <Plus className="size-4" /> New Thesis
        </button>
      </div>

      <PortfolioSummary
        totalOpenPnl={data.totalOpenPnl}
        positionCount={data.positions.length}
        pendingRecCount={pendingRecCount}
      />

      <div className="mt-6">
        <AlertRail positions={data.positions} overdueTickers={data.overdueTickers} />
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm uppercase text-on-surface/50">Active Positions</h2>
          <Link href="/positions" className="text-xs text-primary underline">View all</Link>
        </div>
        {data.positions.length === 0 ? (
          <EmptyState title="No active positions." description="Start with a thesis →" />
        ) : (
          <PositionsTable rows={data.positions} />
        )}
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm uppercase text-on-surface/50">Jarvis Recommendations</h2>
          <Link href="/recommendations" className="text-xs text-primary underline">View tracker</Link>
        </div>
        {data.recommendations.length === 0 ? (
          <EmptyState title="No Jarvis recommendations yet." description="Build a trade plan to start tracking." />
        ) : (
          <RecommendationStats rows={data.recommendations} compact />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Wire the "Last updated" indicator into this screen (spec Section 5 Price Data)**

Task 20 introduced `<LastUpdated at exchange />` and already uses it on the plan wizard; Task 21's HUB-3 review screen already threads a live `priceAsOf` through the same `POST /api/prices/refresh` call and renders it too. This task's `app/(app)/page.tsx` is the third and last screen (of the ones drafted so far) that shows a price: import `LastUpdated` from `@/components/shared/last-updated` and, next to the "Active Positions" section heading, render one using the most recent `last_price_at` across `data.positions`:

```typescript
import { LastUpdated } from "@/components/shared/last-updated";

// inside CockpitPage, after `data` is loaded:
const mostRecentPositionPriceAt = data.positions.reduce<string | null>(
  (latest, r) => (r.stock?.last_price_at && (!latest || r.stock.last_price_at > latest) ? r.stock.last_price_at : latest),
  null,
);
```

```jsx
<div className="mb-3 flex items-center justify-between">
  <div className="flex items-center gap-3">
    <h2 className="font-display text-sm uppercase text-on-surface/50">Active Positions</h2>
    <LastUpdated at={mostRecentPositionPriceAt} exchange="NSE" />
  </div>
  <Link href="/positions" className="text-xs text-primary underline">View all</Link>
</div>
```

(`app/(app)/positions/[id]/page.tsx`, Task 23, doesn't need a retrofit — its `detail.stock?.last_price_at`/`detail.stock?.exchange` are already available from `GET /api/positions/:id`'s join; add `<LastUpdated at={detail.stock?.last_price_at ?? null} exchange={detail.stock?.exchange ?? "US"} />` beside its header `<PriceBadge />` as part of Task 23 itself, not deferred here.)

- [ ] **Step 9: Manual verification**

Run: `npm run dev`, visit `/`, confirm it no longer redirects to `/positions`, confirm Total Open P&L / Active Positions / Pending Recommendations render, confirm the RED near-stop pill and AMBER overdue chip appear when applicable, click a position card and confirm it navigates to `/positions/:id`, confirm a "Last updated" timestamp is visible on the Cockpit, HUB-3 review, plan wizard, and position-detail screens.

- [ ] **Step 10: Commit**

```bash
/usr/bin/git add app/api/cockpit "app/(app)/page.tsx" components/cockpit components/recommendations/recommendation-stats.tsx
/usr/bin/git commit -m "feat: Screen HUB-1 — Velocity Cockpit dashboard (US-01, US-02); wire Section 5's Last-updated rule into the Cockpit"
```

---

## Phase 3 — P2

### Task 25: `POST /api/journal` + Jarvis-verdict generation

**Files:**
- Create: `lib/jarvis-journal-prompt.ts`
- Create: `lib/jarvis-journal-parser.ts`
- Create: `app/api/journal/route.ts`
- Test: `lib/__tests__/jarvis-journal-parser.test.ts`
- Test: `app/api/journal/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `computeWeightedAverageEntry` (Task 11), `jarvisModel` (`@/lib/llm/openrouter`), `createAdminClient`
- Produces: `POST /api/journal` (body: `{ position_id, thesis_outcome, entry_quality, sizing_quality, stop_management, exit_quality, discipline_score, what_went_right?, what_went_wrong?, lessons?, generate_only?, jarvis_verdict?, tags? }`) — with `generate_only: true`, returns `200 { verdict: string | null; suggestedTags: string[]; autoFilled: {...} }` and persists nothing (a preview call); otherwise validates all rating/outcome fields, persists a `trade_journal_entries` row, sets `positions.status = 'closed'`, and returns `201 { entry: TradeJournalEntry }`. Consumed by Task 26's review form (spec Global Constraint — AI calls get a skeleton loader, per Section 5 "Loading States": target <15s, amber-pulsing `<SkeletonLoader />`, never a bare spinner).

**Ruling — one endpoint, two modes, resolves the spec's "Jarvis Verdict... Displayed read-only with an Edit option":** rather than build a second `PATCH /api/journal/[id]` purely so a user can edit an AI-generated verdict before it's ever saved, `generate_only: true` runs the P&L/date computation + the Jarvis LLM call and returns a *preview* (nothing persisted); Task 26's form then lets the user edit that preview's `verdict`/`tags` text in local state before the final save (`generate_only` omitted) persists whatever the client currently holds. This is simpler than a persist-then-patch cycle and matches the spec's actual UX ("Edit" happens on a value the user hasn't committed yet).

**Ruling — auto-suggested tags:** the spec's own examples ("Indian EV", "Buyback Signal") read as thematic, LLM-derived tags, not something a regex heuristic can produce reliably. Since a Jarvis LLM call already runs for the verdict, the same call also returns `suggested_tags` in its structured JSON — one model call, not two independent tagging mechanisms. `"Discipline Break"` is the one exception: it's appended **programmatically**, never left to the model, whenever any of the position's `exits` rows has `override: true` — that's a deterministic fact from the DB, not a judgment call worth risking on LLM output.

- [ ] **Step 1: Write the journal-parser test**

```typescript
// lib/__tests__/jarvis-journal-parser.test.ts
import { describe, expect, it } from "vitest";
import { parseJournalVerdict } from "@/lib/jarvis-journal-parser";

const RAW = `\`\`\`json
{"verdict": "You sized correctly and respected the stop. The thesis played out as planned.", "suggested_tags": ["Indian EV", "Buyback Signal"]}
\`\`\``;

describe("parseJournalVerdict", () => {
  it("extracts the verdict and suggested tags", () => {
    const result = parseJournalVerdict(RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.verdict).toContain("sized correctly");
      expect(result.data.suggestedTags).toEqual(["Indian EV", "Buyback Signal"]);
    }
  });

  it("never throws on garbage input", () => {
    expect(() => parseJournalVerdict("not json")).not.toThrow();
    expect(parseJournalVerdict("not json").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/__tests__/jarvis-journal-parser.test.ts` — Expected: FAIL, module not found

- [ ] **Step 3: Write the prompt + parser**

```typescript
// lib/jarvis-journal-prompt.ts

/** Spec US-18's "Jarvis Verdict" — a 2-sentence AI post-mortem, run once per journal save/preview. */
export const JARVIS_JOURNAL_SYSTEM_PROMPT = `You are Jarvis, reviewing a completed trade after the fact.
You will be given the original thesis and the trade's actual outcome. Write a blunt, 2-sentence
post-mortem: what the trader got right or wrong, stated plainly — this is not encouragement, it is
calibration. Also suggest 2-4 short thematic tags for this trade (e.g. "Indian EV", "Buyback Signal",
sector/strategy names) — never suggest "Discipline Break", that tag is applied programmatically from
the trade's actual exit records, not from your judgment.

Output exactly one fenced code block using json as the fence's info string, containing ONE object:

{ "verdict": string, "suggested_tags": string[] }`;

export function buildJournalUserContext(input: {
  ticker: string;
  marketView: string | null;
  invalidationCondition: string | null;
  convictionTier: string | null;
  pnlPct: number;
  thesisOutcome: string;
  disciplineScore: number;
}): string {
  return [
    `Ticker: ${input.ticker}`,
    `Original thesis (Market View): ${input.marketView ?? "n/a"}`,
    `Invalidation condition: ${input.invalidationCondition ?? "n/a"}`,
    `Conviction Tier at entry: ${input.convictionTier ?? "n/a"}`,
    `Realized P&L: ${input.pnlPct.toFixed(2)}%`,
    `User-selected thesis outcome: ${input.thesisOutcome}`,
    `User's self-rated discipline score (1-5): ${input.disciplineScore}`,
    "",
    "Write the verdict and suggest tags.",
  ].join("\n");
}
```

```typescript
// lib/jarvis-journal-parser.ts
import { z } from "zod";
import { extractTrailingJsonBlock } from "./jarvis-thesis-parser";

const JournalVerdictSchema = z.object({
  verdict: z.string(),
  suggested_tags: z.array(z.string()),
});

export type JournalVerdictExtraction =
  | { ok: true; data: { verdict: string; suggestedTags: string[] } }
  | { ok: false; error: string };

/** Same never-throws contract as the other Jarvis parsers. */
export function parseJournalVerdict(raw: string): JournalVerdictExtraction {
  try {
    const rawJson = extractTrailingJsonBlock(raw);
    if (rawJson === null) return { ok: false, error: "No valid ```json code block found." };
    const result = JournalVerdictSchema.safeParse(rawJson);
    if (!result.success) return { ok: false, error: `Schema validation failed: ${result.error.message}` };
    return { ok: true, data: { verdict: result.data.verdict, suggestedTags: result.data.suggested_tags } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `npx vitest run lib/__tests__/jarvis-journal-parser.test.ts` — Expected: PASS (2/2)

- [ ] **Step 5: Write the route test**

```typescript
// app/api/journal/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { generateText } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

const VERDICT_RAW = `\`\`\`json
{"verdict": "Good discipline overall.", "suggested_tags": ["Indian EV"]}
\`\`\``;

function buildMock(opts: { overrideExit?: boolean } = {}) {
  const journalInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "j1" }, error: null }) }),
  });
  const positionUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "p1", ticker: "AAPL", thesis_id: "t1" }, error: null }) }) }), update: positionUpdate };
      if (table === "entries") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [{ date: "2026-01-01", quantity: 10, price: 100 }], error: null }) }) };
      if (table === "exits") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [{ date: "2026-02-01", quantity: 10, price: 120, override: opts.overrideExit ?? false }], error: null }) }) };
      if (table === "theses") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { market_view: "v", invalidation_condition: "i", conviction_tier: "I" }, error: null }) }) }) };
      if (table === "trade_journal_entries") return { insert: journalInsert };
      throw new Error(`unexpected table ${table}`);
    }),
    _journalInsert: journalInsert,
    _positionUpdate: positionUpdate,
  };
}

describe("POST /api/journal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generate_only returns a preview without persisting", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildMock() as never);
    vi.mocked(generateText).mockResolvedValue({ text: VERDICT_RAW } as never);
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ position_id: "p1", generate_only: true }) });
    const res = await POST(req as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.verdict).toContain("Good discipline");
    expect(body.autoFilled.pnlPct).toBeCloseTo(20, 1);
  });

  it("persists the review, appends Discipline Break for an overridden exit, and closes the position", async () => {
    const mock = buildMock({ overrideExit: true });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    vi.mocked(generateText).mockResolvedValue({ text: VERDICT_RAW } as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({
        position_id: "p1",
        thesis_outcome: "confirmed",
        entry_quality: 4, sizing_quality: 4, stop_management: 3, exit_quality: 4, discipline_score: 2,
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    const inserted = mock._journalInsert.mock.calls[0][0];
    expect(inserted.tags).toContain("Discipline Break");
    expect(mock._positionUpdate).toHaveBeenCalledWith({ status: "closed" });
  });
});
```

- [ ] **Step 6: Run to verify it fails** — Run: `npx vitest run app/api/journal/__tests__/route.test.ts` — Expected: FAIL, module not found

- [ ] **Step 7: Implement the route**

```typescript
// app/api/journal/route.ts
import { NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import { JARVIS_JOURNAL_SYSTEM_PROMPT, buildJournalUserContext } from "@/lib/jarvis-journal-prompt";
import { parseJournalVerdict } from "@/lib/jarvis-journal-parser";
import { jarvisModel } from "@/lib/llm/openrouter";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TradeJournalEntryInsert } from "@/lib/types";

export const maxDuration = 60;

const CreateJournalSchema = z.object({
  position_id: z.string().min(1),
  generate_only: z.boolean().optional(),
  thesis_outcome: z.enum(["confirmed", "partially_confirmed", "invalidated"]).optional(),
  entry_quality: z.number().int().min(1).max(5).optional(),
  sizing_quality: z.number().int().min(1).max(5).optional(),
  stop_management: z.number().int().min(1).max(5).optional(),
  exit_quality: z.number().int().min(1).max(5).optional(),
  discipline_score: z.number().int().min(1).max(5).optional(),
  what_went_right: z.string().optional(),
  what_went_wrong: z.string().optional(),
  lessons: z.string().optional(),
  jarvis_verdict: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = CreateJournalSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  if (!input.generate_only) {
    const required = ["thesis_outcome", "entry_quality", "sizing_quality", "stop_management", "exit_quality", "discipline_score"] as const;
    for (const field of required) {
      if (input[field] === undefined) {
        return NextResponse.json({ error: `${field} is required unless generate_only is true` }, { status: 400 });
      }
    }
  }

  const supabase = createAdminClient();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .select("id, ticker, thesis_id")
    .eq("id", input.position_id)
    .single();
  if (positionError || !position) {
    return NextResponse.json({ error: positionError?.message ?? "Position not found" }, { status: 404 });
  }

  const [{ data: entries }, { data: exits }, { data: thesis }] = await Promise.all([
    supabase.from("entries").select("date, quantity, price").eq("position_id", position.id),
    supabase.from("exits").select("date, quantity, price, override").eq("position_id", position.id),
    supabase.from("theses").select("market_view, invalidation_condition, conviction_tier").eq("id", position.thesis_id).single(),
  ]);

  const entryRows = entries ?? [];
  const exitRows = exits ?? [];
  const weightedAverage = computeWeightedAverageEntry(entryRows);
  const totalCost = weightedAverage.averagePrice * weightedAverage.totalQuantity;
  const totalProceeds = exitRows.reduce((sum, e) => sum + e.quantity * e.price, 0);
  const pnlRupees = totalProceeds - totalCost;
  const pnlPct = totalCost > 0 ? (pnlRupees / totalCost) * 100 : 0;
  const entryDates = entryRows.map((e) => e.date);
  const exitDates = exitRows.map((e) => e.date);
  const hasOverride = exitRows.some((e) => e.override);

  let verdict: string | null = input.jarvis_verdict ?? null;
  let suggestedTags: string[] = input.tags ?? [];
  if (verdict === null && (input.tags === undefined || input.tags.length === 0)) {
    try {
      const result = await generateText({
        model: jarvisModel,
        system: JARVIS_JOURNAL_SYSTEM_PROMPT,
        prompt: buildJournalUserContext({
          ticker: position.ticker,
          marketView: thesis?.market_view ?? null,
          invalidationCondition: thesis?.invalidation_condition ?? null,
          convictionTier: thesis?.conviction_tier ?? null,
          pnlPct,
          thesisOutcome: input.thesis_outcome ?? "unknown",
          disciplineScore: input.discipline_score ?? 0,
        }),
      });
      const parsedVerdict = parseJournalVerdict(result.text);
      if (parsedVerdict.ok) {
        verdict = parsedVerdict.data.verdict;
        suggestedTags = parsedVerdict.data.suggestedTags;
      }
    } catch {
      // Best-effort — a failed Jarvis call must never block saving the review itself.
    }
  }
  const tags = hasOverride ? [...suggestedTags, "Discipline Break"] : suggestedTags;

  if (input.generate_only) {
    return NextResponse.json({
      verdict,
      suggestedTags: tags,
      autoFilled: { ticker: position.ticker, entryDates, exitDates, pnlRupees, pnlPct, convictionTier: thesis?.conviction_tier ?? null },
    });
  }

  const insert: TradeJournalEntryInsert = {
    position_id: position.id,
    ticker: position.ticker,
    entry_dates: entryDates,
    exit_dates: exitDates,
    pnl_rupees: pnlRupees,
    pnl_pct: pnlPct,
    thesis_outcome: input.thesis_outcome!,
    conviction_tier_used: thesis?.conviction_tier ?? "IV",
    entry_quality: input.entry_quality!,
    sizing_quality: input.sizing_quality!,
    stop_management: input.stop_management!,
    exit_quality: input.exit_quality!,
    discipline_score: input.discipline_score!,
    what_went_right: input.what_went_right ?? null,
    what_went_wrong: input.what_went_wrong ?? null,
    lessons: input.lessons ?? null,
    jarvis_verdict: verdict,
    tags,
  };

  const { data: entry, error: insertError } = await supabase
    .from("trade_journal_entries")
    .insert(insert)
    .select("*")
    .single();
  if (insertError || !entry) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to save journal entry" }, { status: 500 });
  }

  /** Belt-and-suspenders with Task 22's quantity-driven closure — spec US-18 says explicitly that saving the review is what closes the position, so this is idempotent-but-authoritative even if Task 22 already closed it. */
  const { error: closeError } = await supabase.from("positions").update({ status: "closed" }).eq("id", position.id);
  if (closeError) {
    return NextResponse.json({ error: closeError.message }, { status: 500 });
  }

  return NextResponse.json({ entry }, { status: 201 });
}
```

- [ ] **Step 8: Run to verify it passes** — Run: `npx vitest run app/api/journal/__tests__/route.test.ts` — Expected: PASS (2/2)

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add lib/jarvis-journal-prompt.ts lib/jarvis-journal-parser.ts lib/__tests__/jarvis-journal-parser.test.ts app/api/journal
/usr/bin/git commit -m "feat: POST /api/journal — auto-filled review + Jarvis verdict (US-18)"
```

---

### Task 26: Screen 7 — Trade Journal & Review (form)

**Files:**
- Create: `components/journal/star-rating.tsx`
- Create: `components/journal/journal-review-form.tsx`
- Create: `app/(app)/journal/new/page.tsx`

**Interfaces:**
- Consumes: `GET /api/positions/:id` (Task 23, for the auto-filled summary — reused rather than a new endpoint), `POST /api/journal` (Task 25, both its `generate_only` preview mode and its persist mode)
- Produces: `<StarRating value onChange />` (reused nowhere else in this plan, but factored out since it's used 5 times on this one screen), `/journal/new?positionId=X` — reached from Task 23's `handleSaved(promptJournal: true)` redirect.

**Ruling — 5 sections vs. the schema's 3 free-text columns:** the spec lists five editable text sections ("What went right / What went wrong / Was the stop correct / What would I do differently / Key lesson") but `trade_journal_entries` (Task 1, already live) has exactly three: `what_went_right`, `what_went_wrong`, `lessons`. Per this plan's own stated precedence ("where the spec and this plan disagree, this plan wins," and Task 1's schema is a completed, deployed migration this plan does not revise after the fact), the form presents 3 sections with labels that fold in the other two rather than adding a schema migration for pure copy: **"What went right"**, **"What went wrong (including: was the stop correct?)"**, **"Lessons / what I'd do differently"**.

- [ ] **Step 1: Build the star rating widget**

```typescript
// components/journal/star-rating.tsx
"use client";

export function StarRating({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-on-surface/70">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={n <= value ? "text-primary" : "text-on-surface/20"}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build the review form**

```typescript
// components/journal/journal-review-form.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { StarRating } from "./star-rating";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import type { ThesisOutcome } from "@/lib/types";

type AutoFilled = {
  ticker: string;
  entryDates: string[];
  exitDates: string[];
  pnlRupees: number;
  pnlPct: number;
  convictionTier: string | null;
};

const OUTCOME_OPTIONS: ThesisOutcome[] = ["confirmed", "partially_confirmed", "invalidated"];

/** Spec Screen 7 (US-18). Two-phase: generate a Jarvis verdict preview first (editable), then persist. */
export function JournalReviewForm({ positionId }: { positionId: string }) {
  const router = useRouter();
  const [autoFilled, setAutoFilled] = useState<AutoFilled | null>(null);
  const [verdict, setVerdict] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ThesisOutcome>("confirmed");
  const [ratings, setRatings] = useState({ entry_quality: 3, sizing_quality: 3, stop_management: 3, exit_quality: 3, discipline_score: 3 });
  const [text, setText] = useState({ what_went_right: "", what_went_wrong: "", lessons: "" });
  const [editingVerdict, setEditingVerdict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position_id: positionId, generate_only: true }),
    })
      .then((res) => res.json())
      .then((body) => {
        setAutoFilled(body.autoFilled);
        setVerdict(body.verdict ?? "");
        setTags(body.suggestedTags ?? []);
        setLoading(false);
      });
  }, [positionId]);

  async function handleSave() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position_id: positionId,
          thesis_outcome: outcome,
          ...ratings,
          ...text,
          jarvis_verdict: verdict || null,
          tags,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save review");
      router.push("/journal");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !autoFilled) return <SkeletonLoader lines={6} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="font-display text-lg text-on-surface">{autoFilled.ticker}</p>
        <p className="mt-1 text-xs text-on-surface/60">
          Entry {autoFilled.entryDates.join(", ")} · Exit {autoFilled.exitDates.join(", ")} · Tier {autoFilled.convictionTier ?? "—"}
        </p>
        <p className={`mt-2 font-mono text-lg ${autoFilled.pnlRupees >= 0 ? "text-status-green" : "text-status-red"}`}>
          {autoFilled.pnlRupees >= 0 ? "+" : ""}
          {autoFilled.pnlRupees.toFixed(2)} ({autoFilled.pnlPct.toFixed(2)}%)
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-on-surface/50">Thesis Outcome</span>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as ThesisOutcome)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
          {OUTCOME_OPTIONS.map((o) => (
            <option key={o} value={o}>{o.replace("_", " ")}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-4">
        <StarRating label="Entry Quality" value={ratings.entry_quality} onChange={(v) => setRatings((r) => ({ ...r, entry_quality: v }))} />
        <StarRating label="Sizing" value={ratings.sizing_quality} onChange={(v) => setRatings((r) => ({ ...r, sizing_quality: v }))} />
        <StarRating label="Stop Management" value={ratings.stop_management} onChange={(v) => setRatings((r) => ({ ...r, stop_management: v }))} />
        <StarRating label="Exit Timing" value={ratings.exit_quality} onChange={(v) => setRatings((r) => ({ ...r, exit_quality: v }))} />
        <StarRating label="Overall Discipline" value={ratings.discipline_score} onChange={(v) => setRatings((r) => ({ ...r, discipline_score: v }))} />
      </div>

      {(
        [
          ["what_went_right", "What went right"],
          ["what_went_wrong", "What went wrong (including: was the stop correct?)"],
          ["lessons", "Lessons / what I'd do differently"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-xs text-on-surface/50">{label}</span>
          <textarea
            rows={3}
            value={text[key]}
            onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))}
            className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
          />
        </label>
      ))}

      <div className="rounded-xl bg-primary-container p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-display text-xs uppercase text-primary">Jarvis Verdict</p>
          <button type="button" onClick={() => setEditingVerdict((v) => !v)} className="text-xs text-primary underline">
            {editingVerdict ? "Done" : "Edit"}
          </button>
        </div>
        {editingVerdict ? (
          <textarea value={verdict} onChange={(e) => setVerdict(e.target.value)} rows={3} className="w-full rounded-lg bg-surface-container-highest px-3 py-2 text-sm text-on-surface" />
        ) : (
          <p className="text-sm text-primary">{verdict || "—"}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span key={tag} className="rounded-full bg-surface-container-highest px-3 py-1 text-xs text-on-surface/70">{tag}</span>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={submitting}
        className="self-start rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
      >
        Save Review
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Build the page**

```typescript
// app/(app)/journal/new/page.tsx
import { JournalReviewForm } from "@/components/journal/journal-review-form";

export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ positionId?: string }>;
}) {
  const { positionId } = await searchParams;
  if (!positionId) {
    return <p className="text-sm text-on-surface/60">Missing positionId.</p>;
  }
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 font-display text-2xl text-on-surface">Trade Journal & Review</h1>
      <JournalReviewForm positionId={positionId} />
    </div>
  );
}
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, fully exit a position (Task 23's flow), confirm the redirect to `/journal/new?positionId=...`, confirm auto-filled ticker/dates/P&L render, confirm the Jarvis Verdict preview loads (amber skeleton first, per Section 5's Loading States rule), edit it, save, confirm you land on `/journal` and the position now shows `closed`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add components/journal "app/(app)/journal/new"
/usr/bin/git commit -m "feat: Screen 7 — Trade Journal & Review form (US-18)"
```

---

### Task 27: Journal archive/browse screen

**Files:**
- Modify: `app/api/journal/route.ts` (add `GET`, alongside Task 25's `POST`)
- Create: `app/(app)/journal/page.tsx`
- Create: `components/journal/journal-archive-table.tsx`

**Interfaces:**
- Consumes: `fetchInternalApi` (Global Constraint)
- Produces: `GET /api/journal` (`{ entries: TradeJournalEntry[] }`), `/journal` — the sidebar's "Journal" nav target.

- [ ] **Step 1: Add `GET` to `app/api/journal/route.ts`**

```typescript
export async function GET() {
  const supabase = createAdminClient();
  const { data: entries, error } = await supabase
    .from("trade_journal_entries")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: entries ?? [] });
}
```

- [ ] **Step 2: Build the archive table**

```typescript
// components/journal/journal-archive-table.tsx
"use client";

import { useMemo, useState } from "react";
import type { TradeJournalEntry, ThesisOutcome } from "@/lib/types";

/** Spec US-19: filterable archive + aggregate stats + expandable rows. */
export function JournalArchiveTable({ entries }: { entries: TradeJournalEntry[] }) {
  const [tickerFilter, setTickerFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<ThesisOutcome | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (tickerFilter && !e.ticker.toLowerCase().includes(tickerFilter.toLowerCase())) return false;
      if (outcomeFilter !== "all" && e.thesis_outcome !== outcomeFilter) return false;
      return true;
    });
  }, [entries, tickerFilter, outcomeFilter]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const avgDiscipline = total > 0 ? filtered.reduce((s, e) => s + e.discipline_score, 0) / total : 0;
    const wins = filtered.filter((e) => e.pnl_pct !== null && e.pnl_pct > 0).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const tagCounts = new Map<string, number>();
    for (const e of filtered) for (const tag of e.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const mostCommonTag = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    return { total, avgDiscipline, winRate, mostCommonTag };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Trades Reviewed", stats.total],
          ["Avg Discipline", stats.avgDiscipline.toFixed(1)],
          ["Win Rate", `${stats.winRate.toFixed(0)}%`],
          ["Most Common Lesson Tag", stats.mostCommonTag],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-surface-container-low p-4">
            <p className="font-display text-xs uppercase text-on-surface/50">{label}</p>
            <p className="mt-1 font-mono text-lg text-on-surface">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <input
          placeholder="Filter by ticker"
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
          className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
        />
        <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as ThesisOutcome | "all")} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
          <option value="all">All outcomes</option>
          <option value="confirmed">Confirmed</option>
          <option value="partially_confirmed">Partially Confirmed</option>
          <option value="invalidated">Invalidated</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl bg-surface-container-low">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-on-surface/50">
              <th className="p-3">Ticker</th>
              <th className="p-3">P&L %</th>
              <th className="p-3">Outcome</th>
              <th className="p-3">Discipline</th>
              <th className="p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <>
                <tr
                  key={e.id}
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="cursor-pointer border-t border-outline-variant/10 hover:bg-surface-container-high"
                >
                  <td className="p-3 font-medium">{e.ticker}</td>
                  <td className={`p-3 font-mono ${e.pnl_pct != null && e.pnl_pct >= 0 ? "text-status-green" : "text-status-red"}`}>
                    {e.pnl_pct != null ? `${e.pnl_pct >= 0 ? "+" : ""}${e.pnl_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="p-3">{e.thesis_outcome.replace("_", " ")}</td>
                  <td className="p-3">{e.discipline_score}/5</td>
                  <td className="p-3 text-on-surface/60">{e.created_at.slice(0, 10)}</td>
                </tr>
                {expanded === e.id && (
                  <tr key={`${e.id}-detail`} className="border-t border-outline-variant/10 bg-surface-container-lowest">
                    <td colSpan={5} className="p-4 text-sm text-on-surface/80">
                      <p><span className="text-on-surface/50">Jarvis Verdict:</span> {e.jarvis_verdict ?? "—"}</p>
                      <p className="mt-2"><span className="text-on-surface/50">Lessons:</span> {e.lessons ?? "—"}</p>
                      <div className="mt-2 flex gap-2">
                        {e.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-surface-container-highest px-2 py-0.5 text-xs">{tag}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build the page**

```typescript
// app/(app)/journal/page.tsx
import { EmptyState } from "@/components/shared/empty-state";
import { JournalArchiveTable } from "@/components/journal/journal-archive-table";
import { fetchInternalApi } from "@/lib/server-fetch";

export default async function JournalArchivePage() {
  const res = await fetchInternalApi("/api/journal");
  const body = await res.json();
  const entries = body.entries ?? [];

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-on-surface">Trade Journal</h1>
      {entries.length === 0 ? (
        <EmptyState title="No journal entries yet." description="Exit a position to write your first review →" />
      ) : (
        <JournalArchiveTable entries={entries} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, visit `/journal`, confirm the aggregate stats strip and filters render, click a row and confirm it expands to show the Jarvis Verdict and tags.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add app/api/journal "app/(app)/journal/page.tsx" components/journal/journal-archive-table.tsx
/usr/bin/git commit -m "feat: Journal archive/browse screen with filters + aggregate stats (US-19)"
```

---

### Task 28: Screen HUB-4 — Intelligence Feed (manual signals)

**Files:**
- Create: `app/api/signals/route.ts` (`GET`, `POST`)
- Create: `app/api/signals/[id]/route.ts` (`PATCH` — archive)
- Create: `app/(app)/feed/page.tsx`
- Create: `components/feed/signal-card.tsx`
- Create: `components/feed/add-signal-modal.tsx`
- Create: `components/feed/agenda-sidebar.tsx`
- Create: `components/feed/thesis-preview-drawer.tsx`
- Test: `app/api/signals/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `IntelligenceSignalInsert` (`@/lib/types`), `fetchInternalApi`
- Produces: `GET /api/signals` (`{ signals: IntelligenceSignal[] }`, active-only, sorted red→amber→blue→grey then recency), `POST /api/signals` (manual add, per plan Decision #4 — no news/AI ingestion source is chosen anywhere in the spec, so this ships fully functional against manually-entered signals only), `PATCH /api/signals/:id` (`{ archived_at: now }`).

**Ruling — "Today's Agenda" data source:** the spec asks for "upcoming thesis-test dates for the next 14 days" — this is `trade_plans.time_exit_date`, already modeled (no new table needed), joined through `positions` for the ticker. `GET /api/signals` computes this alongside the feed itself in one response, since both are read together on the same screen.

- [ ] **Step 1: Write the route test**

```typescript
// app/api/signals/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { GET, POST } from "../route";

function buildMock() {
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "sig1", priority: "red" }, error: null }) }),
  });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "intelligence_signals") {
        return {
          select: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  { id: "s1", priority: "blue", created_at: "2026-08-20", headline: "b" },
                  { id: "s2", priority: "red", created_at: "2026-08-19", headline: "r" },
                ],
                error: null,
              }),
            }),
          }),
          insert,
        };
      }
      if (table === "positions") return { select: vi.fn().mockReturnValue({}) };
      throw new Error(`unexpected table ${table}`);
    }),
    _insert: insert,
  };
}

describe("GET /api/signals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sorts red before blue regardless of recency", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildMock() as never);
    const res = await GET();
    const body = await res.json();
    expect(body.signals[0].priority).toBe("red");
  });
});

describe("POST /api/signals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a body with no headline", async () => {
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ priority: "blue" }) });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("creates a manual signal", async () => {
    const mock = buildMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ priority: "red", headline: "Margin miss" }) });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    expect(mock._insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run app/api/signals/__tests__/route.test.ts` — Expected: FAIL, module not found

- [ ] **Step 3: Implement `app/api/signals/route.ts`**

```typescript
// app/api/signals/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type { IntelligenceSignalInsert } from "@/lib/types";

const PRIORITY_ORDER: Record<string, number> = { red: 0, amber: 1, blue: 2, grey: 3 };

const CreateSignalSchema = z.object({
  priority: z.enum(["red", "amber", "blue", "grey"]),
  headline: z.string().trim().min(1),
  ticker: z.string().trim().optional(),
  theme: z.string().trim().optional(),
  thesis_id: z.string().optional(),
});

/** Spec US-08: sorted RED -> AMBER -> BLUE -> GREY, then recency within each tier. Also returns the "Today's Agenda" 14-day time-exit list. */
export async function GET() {
  const supabase = createAdminClient();

  const { data: signals, error } = await supabase
    .from("intelligence_signals")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sorted = [...(signals ?? [])].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const today = new Date().toISOString().slice(0, 10);
  const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: positions } = await supabase.from("positions").select("id, ticker, trade_plan_id").in("status", ["active", "partial_exit"]);
  const tradePlanIds = [...new Set((positions ?? []).map((p) => p.trade_plan_id))];
  const { data: tradePlans } = tradePlanIds.length
    ? await supabase.from("trade_plans").select("id, time_exit_date").in("id", tradePlanIds)
    : { data: [] };
  const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));

  const agenda = (positions ?? [])
    .map((p) => ({ ticker: p.ticker, timeExitDate: tradePlanById.get(p.trade_plan_id)?.time_exit_date ?? null }))
    .filter((a) => a.timeExitDate !== null && a.timeExitDate >= today && a.timeExitDate <= in14Days)
    .sort((a, b) => a.timeExitDate!.localeCompare(b.timeExitDate!));

  return NextResponse.json({ signals: sorted, agenda });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = CreateSignalSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();
  const insert: IntelligenceSignalInsert = parsed.data;
  const { data: signal, error } = await supabase.from("intelligence_signals").insert(insert).select("*").single();
  if (error || !signal) return NextResponse.json({ error: error?.message ?? "Failed to create signal" }, { status: 500 });
  return NextResponse.json({ signal }, { status: 201 });
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `npx vitest run app/api/signals/__tests__/route.test.ts` — Expected: PASS (3/3)

- [ ] **Step 5: Implement `app/api/signals/[id]/route.ts`**

```typescript
// app/api/signals/[id]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Spec US-08's "archived (moves to Reviewed tab with timestamp)." */
export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();
  const { data: signal, error } = await supabase
    .from("intelligence_signals")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !signal) return NextResponse.json({ error: error?.message ?? "Signal not found" }, { status: 404 });
  return NextResponse.json({ signal });
}
```

- [ ] **Step 6: Build the signal card + agenda sidebar + thesis preview drawer**

```typescript
// components/feed/signal-card.tsx
"use client";

import type { IntelligenceSignal } from "@/lib/types";

const PRIORITY_STYLE: Record<IntelligenceSignal["priority"], string> = {
  red: "bg-status-red-container text-status-red",
  amber: "bg-primary-container text-primary",
  blue: "bg-status-blue-container text-status-blue",
  grey: "bg-surface-container-highest text-on-surface/60",
};

export function SignalCard({
  signal,
  onLinkToThesis,
  onArchive,
}: {
  signal: IntelligenceSignal;
  onLinkToThesis: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-surface-container-low p-4">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_STYLE[signal.priority]}`}>
            {signal.priority}
          </span>
          {signal.ticker && <span className="text-xs font-medium text-on-surface">{signal.ticker}</span>}
          {signal.theme && <span className="text-xs text-on-surface/50">{signal.theme}</span>}
        </div>
        <p className="text-sm text-on-surface">{signal.headline}</p>
        <p className="mt-1 text-xs text-on-surface/40">{new Date(signal.created_at).toLocaleString()}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {signal.thesis_id && (
          <button type="button" onClick={onLinkToThesis} className="text-xs text-primary underline">Link to Thesis</button>
        )}
        <button type="button" onClick={onArchive} className="text-xs text-on-surface/40 underline">Archive</button>
      </div>
    </div>
  );
}
```

```typescript
// components/feed/agenda-sidebar.tsx
export function AgendaSidebar({ agenda }: { agenda: { ticker: string; timeExitDate: string | null }[] }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-4">
      <h2 className="mb-3 font-display text-sm uppercase text-on-surface/50">Today&apos;s Agenda</h2>
      {agenda.length === 0 ? (
        <p className="text-sm text-on-surface/50">No thesis tests due in the next 14 days.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agenda.map((a) => (
            <li key={a.ticker} className="flex justify-between text-sm">
              <span className="text-on-surface">{a.ticker}</span>
              <span className="text-on-surface/60">{a.timeExitDate}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```typescript
// components/feed/thesis-preview-drawer.tsx
"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";

type ThesisPreview = { ticker: string | null; market_view: string | null; invalidation_condition: string | null };

/** Spec US-08's "Link to Thesis" slide-out — shows the linked thesis with the signal highlighted as supporting/contrary evidence. */
export function ThesisPreviewDrawer({ thesisId, headline, onClose }: { thesisId: string; headline: string; onClose: () => void }) {
  const [thesis, setThesis] = useState<ThesisPreview | null>(null);

  useEffect(() => {
    fetch(`/api/theses/${thesisId}`).then((res) => res.json()).then((body) => setThesis(body.thesis));
  }, [thesisId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-surface-container-low p-6 shadow-ambient">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-on-surface/60 hover:text-on-surface" aria-label="Close">
          <X className="size-5" />
        </button>
        {!thesis ? (
          <SkeletonLoader lines={4} />
        ) : (
          <>
            <h2 className="font-display text-lg text-on-surface">{thesis.ticker ?? "Macro Thesis"}</h2>
            <div className="rounded-xl bg-primary-container p-4">
              <p className="text-xs uppercase text-primary">This signal</p>
              <p className="mt-1 text-sm text-primary">{headline}</p>
            </div>
            <div className="rounded-xl bg-surface-container-highest p-4">
              <p className="text-xs text-on-surface/50">Market View</p>
              <p className="mt-1 text-sm text-on-surface">{thesis.market_view ?? "—"}</p>
            </div>
            <div className="rounded-xl bg-surface-container-highest p-4">
              <p className="text-xs text-on-surface/50">Invalidation</p>
              <p className="mt-1 text-sm text-on-surface">{thesis.invalidation_condition ?? "—"}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Build the add-signal modal**

```typescript
// components/feed/add-signal-modal.tsx
"use client";

import { useState } from "react";
import type { IntelligenceSignal } from "@/lib/types";

export function AddSignalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [priority, setPriority] = useState<IntelligenceSignal["priority"]>("blue");
  const [headline, setHeadline] = useState("");
  const [ticker, setTicker] = useState("");
  const [theme, setTheme] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority, headline, ticker: ticker || undefined, theme: theme || undefined }),
      });
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-4 font-display text-lg text-on-surface">Add Signal</h2>
        <div className="mb-4 flex flex-col gap-3">
          <select value={priority} onChange={(e) => setPriority(e.target.value as IntelligenceSignal["priority"])} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
            <option value="red">Red — thesis-break</option>
            <option value="amber">Amber — thesis test</option>
            <option value="blue">Blue — general signal</option>
            <option value="grey">Grey — background</option>
          </select>
          <input placeholder="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input placeholder="Ticker (optional)" value={ticker} onChange={(e) => setTicker(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input placeholder="Theme (optional)" value={theme} onChange={(e) => setTheme(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={submitting || !headline.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Build the feed page**

```typescript
// app/(app)/feed/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { SignalCard } from "@/components/feed/signal-card";
import { AgendaSidebar } from "@/components/feed/agenda-sidebar";
import { AddSignalModal } from "@/components/feed/add-signal-modal";
import { ThesisPreviewDrawer } from "@/components/feed/thesis-preview-drawer";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import type { IntelligenceSignal } from "@/lib/types";

export default function FeedPage() {
  const [signals, setSignals] = useState<IntelligenceSignal[] | null>(null);
  const [agenda, setAgenda] = useState<{ ticker: string; timeExitDate: string | null }[]>([]);
  const [tab, setTab] = useState<"active" | "reviewed">("active");
  const [addOpen, setAddOpen] = useState(false);
  const [previewSignal, setPreviewSignal] = useState<IntelligenceSignal | null>(null);

  async function load() {
    const res = await fetch("/api/signals");
    const body = await res.json();
    setSignals(body.signals ?? []);
    setAgenda(body.agenda ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleArchive(id: string) {
    await fetch(`/api/signals/${id}`, { method: "PATCH" });
    load();
  }

  if (!signals) return <SkeletonLoader lines={6} />;

  const visible = signals.filter((s) => (tab === "active" ? !s.archived_at : !!s.archived_at));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl text-on-surface">Jarvis Intelligence Feed</h1>
          <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-on-primary">
            <Plus className="size-4" /> Add Signal
          </button>
        </div>

        <div className="mb-4 flex gap-4 text-sm">
          <button type="button" onClick={() => setTab("active")} className={tab === "active" ? "text-primary" : "text-on-surface/50"}>Active</button>
          <button type="button" onClick={() => setTab("reviewed")} className={tab === "reviewed" ? "text-primary" : "text-on-surface/50"}>Reviewed</button>
        </div>

        {visible.length === 0 ? (
          <EmptyState title="No signals yet." description="Add a signal to start tracking thesis-relevant news →" />
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((s) => (
              <SignalCard
                key={s.id}
                signal={s}
                onLinkToThesis={() => setPreviewSignal(s)}
                onArchive={() => handleArchive(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AgendaSidebar agenda={agenda} />

      {addOpen && <AddSignalModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />}
      {previewSignal?.thesis_id && (
        <ThesisPreviewDrawer thesisId={previewSignal.thesis_id} headline={previewSignal.headline} onClose={() => setPreviewSignal(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Manual verification**

Run: `npm run dev`, visit `/feed`, add a signal, confirm it sorts by priority (add a red one after a blue one and confirm it jumps to the top), archive it and confirm it moves to the Reviewed tab, confirm the Today's Agenda sidebar lists any position with a `time_exit_date` in the next 14 days.

- [ ] **Step 10: Commit**

```bash
/usr/bin/git add app/api/signals "app/(app)/feed" components/feed
/usr/bin/git commit -m "feat: Screen HUB-4 — Intelligence Feed with manual signals + Today's Agenda (US-08)"
```

---

## Phase 4 — P3

### Task 29: Screen 8 — Opportunity Discovery (manual watchlist)

**Files:**
- Create: `app/api/opportunities/route.ts` (`GET`, `POST`)
- Create: `app/(app)/discovery/page.tsx`
- Create: `components/discovery/opportunity-card.tsx`
- Create: `components/discovery/add-watchlist-modal.tsx`

**Interfaces:**
- Consumes: `OpportunityInsert` (`@/lib/types`), `LastUpdated` (Task 20), `fetchInternalApi`
- Produces: `GET /api/opportunities` (`{ opportunities: OpportunityRow[] }`, each row carrying computed `held`/`draft` flags, a resolved `currentPrice`, and `lastPriceAt`), `POST /api/opportunities` (both the full AI-style entry and the lightweight "Add to Watchlist" ticker-only entry via `watching_only: true`), `/discovery` — this plan's last new screen.

**Note (Section 5 Price Data — "Last updated" rule):** since every card resolves its own `currentPrice`, this screen shows the single most-recent `lastPriceAt` across all rows once, next to the page heading, via `<LastUpdated />` (Task 20) — see Step 4.

**Ruling — resolving CMP for "Near 52W High" (US-20):** `opportunities` (Task 1 schema) has no `stock_id` FK — it denormalizes `ticker`/`market` directly, matching this plan's Decision #2 pattern. `GET /api/opportunities` resolves each row's current price with a best-effort lookup against `stocks` by `(ticker, exchange)`; a miss just means that card shows "Price unavailable" (Task 6's `PriceBadge`) and skips the 52W-high chip, same graceful-degradation pattern used everywhere else in this app.

- [ ] **Step 1: Implement `app/api/opportunities/route.ts`**

```typescript
// app/api/opportunities/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type { OpportunityInsert } from "@/lib/types";

const CreateOpportunitySchema = z.object({
  ticker: z.string().trim().min(1),
  market: z.enum(["NSE", "BSE", "US"]),
  sector: z.string().optional(),
  conviction_tier: z.enum(["I", "II", "III", "IV"]).optional(),
  thesis_summary: z.string().optional(),
  pe: z.number().optional(),
  sector_median_pe: z.number().optional(),
  fifty_two_week_low: z.number().optional(),
  fifty_two_week_high: z.number().optional(),
  watching_only: z.boolean().optional(),
});

/** Spec US-20/US-21. Resolves each row's CMP + HELD/DRAFT badges by cross-referencing `stocks`/`positions`/`theses` on `ticker` — no FK exists between `opportunities` and those tables (Decision #2's denormalized-ticker pattern). */
export async function GET() {
  const supabase = createAdminClient();

  const { data: opportunities, error } = await supabase
    .from("opportunities")
    .select("*")
    .order("conviction_tier", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = opportunities ?? [];
  if (rows.length === 0) return NextResponse.json({ opportunities: [] });

  const tickers = [...new Set(rows.map((o) => o.ticker))];
  const [{ data: stocks }, { data: positions }, { data: theses }] = await Promise.all([
    supabase.from("stocks").select("ticker, exchange, last_price, last_price_at").in("ticker", tickers),
    supabase.from("positions").select("ticker").in("status", ["active", "partial_exit"]).in("ticker", tickers),
    supabase.from("theses").select("ticker, status").eq("status", "draft").in("ticker", tickers),
  ]);
  const stockByTicker = new Map((stocks ?? []).map((s) => [s.ticker, s]));
  const heldTickers = new Set((positions ?? []).map((p) => p.ticker));
  const draftTickers = new Set((theses ?? []).map((t) => t.ticker));

  const result = rows.map((o) => {
    const stock = stockByTicker.get(o.ticker);
    return {
      opportunity: o,
      currentPrice: stock?.last_price ?? null,
      lastPriceAt: stock?.last_price_at ?? null,
      held: heldTickers.has(o.ticker),
      draft: draftTickers.has(o.ticker),
    };
  });

  return NextResponse.json({ opportunities: result });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = CreateOpportunitySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();
  const insert: OpportunityInsert = parsed.data;
  const { data: opportunity, error } = await supabase.from("opportunities").insert(insert).select("*").single();
  if (error || !opportunity) return NextResponse.json({ error: error?.message ?? "Failed to create opportunity" }, { status: 500 });
  return NextResponse.json({ opportunity }, { status: 201 });
}
```

- [ ] **Step 2: Build the opportunity card**

```typescript
// components/discovery/opportunity-card.tsx
import Link from "next/link";
import { ConvictionBadge } from "@/components/thesis/conviction-badge";
import { PriceBadge } from "@/components/shared/price-badge";
import type { ConvictionTier, ExchangeCode } from "@/lib/types";

type Row = {
  opportunity: {
    id: string;
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
  currentPrice: number | null;
  held: boolean;
  draft: boolean;
};

/** Spec US-20/US-21. "Explore" reuses Task 10's page via its existing `?ticker=` searchParam — no new route needed. */
export function OpportunityCard({ row }: { row: Row }) {
  const { opportunity: o, currentPrice, held, draft } = row;

  const near52wHigh =
    currentPrice !== null && o.fifty_two_week_high !== null && currentPrice > o.fifty_two_week_high * 0.85;

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm text-on-surface">{o.ticker}</span>
        <div className="flex items-center gap-2">
          {o.watching_only && <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[10px] text-on-surface/50">WATCHING</span>}
          {held && <span className="rounded-full bg-status-green-container px-2 py-0.5 text-[10px] text-status-green">HELD</span>}
          {draft && <span className="rounded-full bg-primary-container px-2 py-0.5 text-[10px] text-primary">DRAFT</span>}
          {o.conviction_tier && <ConvictionBadge tier={o.conviction_tier} />}
        </div>
      </div>
      <p className="text-xs text-on-surface/50">{o.sector ?? "—"}</p>
      {o.thesis_summary && <p className="line-clamp-2 text-sm text-on-surface/80">{o.thesis_summary}</p>}
      <div className="flex items-center justify-between text-xs text-on-surface/60">
        <span>PE {o.pe ?? "—"} vs sector {o.sector_median_pe ?? "—"}</span>
        <PriceBadge price={currentPrice} exchange={o.market} />
      </div>
      {near52wHigh && (
        <span className="w-fit rounded-full bg-primary-container px-2 py-0.5 text-[10px] text-primary">Near 52W High ⚠</span>
      )}
      <Link
        href={held ? `/positions` : draft ? `/thesis` : `/thesis/new?ticker=${o.ticker}`}
        className="rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-medium text-on-primary"
      >
        {held || draft ? "Review Thesis" : "Explore"}
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Build the add-to-watchlist modal**

```typescript
// components/discovery/add-watchlist-modal.tsx
"use client";

import { useState } from "react";
import type { ExchangeCode } from "@/lib/types";

/** Spec US-21: ticker only, no thesis required. */
export function AddWatchlistModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [ticker, setTicker] = useState("");
  const [market, setMarket] = useState<ExchangeCode>("NSE");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, market, watching_only: true }),
      });
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-4 font-display text-lg text-on-surface">Add to Watchlist</h2>
        <div className="mb-4 flex flex-col gap-3">
          <input placeholder="Ticker" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <select value={market} onChange={(e) => setMarket(e.target.value as ExchangeCode)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
            <option value="NSE">NSE</option>
            <option value="BSE">BSE</option>
            <option value="US">US</option>
          </select>
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={submitting || !ticker.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build the discovery page**

```typescript
// app/(app)/discovery/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { OpportunityCard } from "@/components/discovery/opportunity-card";
import { AddWatchlistModal } from "@/components/discovery/add-watchlist-modal";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { LastUpdated } from "@/components/shared/last-updated";
import type { ConvictionTier } from "@/lib/types";

type Row = Parameters<typeof OpportunityCard>[0]["row"];

const TIER_ORDER: Record<ConvictionTier, number> = { I: 0, II: 1, III: 2, IV: 3 };

export default function DiscoveryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tierFilter, setTierFilter] = useState<ConvictionTier | "all">("all");
  const [sortBy, setSortBy] = useState<"tier" | "pe" | "recency">("tier");
  const [addOpen, setAddOpen] = useState(false);

  async function load() {
    const res = await fetch("/api/opportunities");
    const body = await res.json();
    setRows(body.opportunities ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const byTier = tierFilter === "all" ? rows : rows.filter((r) => r.opportunity.conviction_tier === tierFilter);
    /** Spec US-20: sort options are Conviction Tier (default) / PE / Recency — deliberately no "Trending"/"Popular". */
    return [...byTier].sort((a, b) => {
      if (sortBy === "pe") return (a.opportunity.pe ?? Infinity) - (b.opportunity.pe ?? Infinity);
      if (sortBy === "recency") return 0; // rows already arrive newest-relevant from the API's default order
      const tierA = a.opportunity.conviction_tier ? TIER_ORDER[a.opportunity.conviction_tier] : 4;
      const tierB = b.opportunity.conviction_tier ? TIER_ORDER[b.opportunity.conviction_tier] : 4;
      return tierA - tierB;
    });
  }, [rows, tierFilter, sortBy]);

  if (!rows) return <SkeletonLoader lines={6} />;

  const mostRecentPriceAt = rows.reduce<string | null>(
    (latest, r) => (r.lastPriceAt && (!latest || r.lastPriceAt > latest) ? r.lastPriceAt : latest),
    null,
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl text-on-surface">Opportunity Discovery</h1>
          <LastUpdated at={mostRecentPriceAt} exchange="NSE" />
        </div>
        <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-on-primary">
          <Plus className="size-4" /> Add to Watchlist
        </button>
      </div>

      <div className="mb-6 flex gap-3">
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as ConvictionTier | "all")} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
          <option value="all">All Tiers</option>
          {(["I", "II", "III", "IV"] as ConvictionTier[]).map((t) => (
            <option key={t} value={t}>Tier {t}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
          <option value="tier">Sort: Conviction Tier</option>
          <option value="pe">Sort: PE</option>
          <option value="recency">Sort: Recency</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No opportunities yet." description="Add a stock to your watchlist to start tracking →" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => (
            <OpportunityCard key={row.opportunity.id} row={row} />
          ))}
        </div>
      )}

      {addOpen && <AddWatchlistModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />}
    </div>
  );
}
```

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, visit `/discovery`, click "Add to Watchlist", add a ticker, confirm it appears with a "WATCHING" badge; confirm filtering by tier and sorting by PE both work; confirm a ticker that's already an active position shows "HELD" with a "Review Thesis" CTA instead of "Explore".

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add app/api/opportunities "app/(app)/discovery" components/discovery
/usr/bin/git commit -m "feat: Screen 8 — Opportunity Discovery, manual watchlist (US-20, US-21)"
```

---

## Final

### Task 30: Whole-plan verification pass

**Files:** none — this task runs the app end-to-end and confirms every user story, not write code. If any check below fails, fix the underlying task's code directly (this is the final gate before `superpowers:finishing-a-development-branch`, not a place to defer new findings).

**Interfaces:** N/A.

- [ ] **Step 1: Automated gates**

Run, in order, and confirm each is clean before moving to Step 2:

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

- [ ] **Step 2: Database integrity check**

Run `mcp__claude_ai_Supabase__list_tables` and `mcp__claude_ai_Supabase__get_advisors` — confirm all 11 tables from Task 1 plus Task 23's `thesis_conditions` column exist, RLS is enabled with no policies on every new table, and no new advisor warnings have appeared since Task 1's fix wave.

- [ ] **Step 3: Scripted manual walkthrough (`npm run dev`)**

Work through every user story in one continuous session, in this order, confirming the acceptance criteria named:

1. **US-09/US-10** — Open the New Thesis drawer from any screen (Section 5 Navigation rule: must be reachable without leaving the page), submit a Mode 2 (thesis-only) input, confirm the 6-field thesis renders and a duplicate-warning banner appears if a thesis for the same ticker already exists.
2. **US-11/US-12** — Approve the thesis, confirm Step 2 auto-generates 4 bear cases, edit one counter and confirm the "Modified" badge + conviction slider both work, advance to Step 3, confirm Risk/Reward recalculates live, confirm "Lock & Save Plan" is disabled until Stop Loss is set, lock it.
3. **I1 (spec-resolved)** — Confirm in Supabase that a `jarvis_recommendations` row was created if and only if the thesis was Tier I/II.
4. **US-13/US-14** — From the Recommendation Tracker (or directly), log a buy outside the entry zone and confirm the amber "outside your planned zone" warning appears but never blocks the button.
5. **US-01/US-02** — Visit `/`, confirm Total Open P&L, position/recommendation counts, the RED near-stop pill (if applicable), and the AMBER overdue-thesis chip all render; confirm the "Last updated" timestamp (Section 5 Price Data rule) is visible.
6. **US-03/US-15** — Visit `/positions`, confirm sort-by-urgency defaults to nearest-stop-first; open a position and confirm the exit ladder, thesis metrics panel, and Jarvis Warning box all render.
7. **US-04** — Manually set a stock's `last_price` (via Supabase) to breach its stop; reload the position and Cockpit and confirm the blocking red banner and RED alert-rail pill both appear; test the override path and confirm a sub-40-character reason is rejected client- and server-side.
8. **US-05** — Add a second entry tranche to a position and confirm the weighted average recalculates correctly.
9. **US-06/US-07** — Visit `/thesis/:id` for the locked plan, edit a numeric field, confirm it auto-saves on blur and shows the amber-underline "edited" treatment, confirm "Re-run AI Analysis" regenerates bear cases.
10. **US-16/US-17** — Log a T1 trim, confirm the exit ladder flips to DONE and P&L updates; fully exit the position via a stop-hit with an override, confirm you're redirected to the journal.
11. **US-18/US-19** — Complete the journal review (confirm the amber skeleton loads the Jarvis Verdict preview, per Section 5 Loading States), save it, confirm the position shows `closed`, then visit `/journal` and confirm the entry appears with the "Discipline Break" tag (from the override) and the aggregate stats update.
12. **US-08** — Visit `/feed`, add a Red-priority signal, confirm it sorts above older lower-priority ones, archive it, confirm it moves to the Reviewed tab, confirm Today's Agenda lists any position due within 14 days.
13. **US-20/US-21** — Visit `/discovery`, add a ticker to the watchlist, confirm the "WATCHING" badge and lower visual weight vs. a full opportunity card; confirm the "HELD"/"DRAFT" cross-reference badges are correct against real positions/theses; click "Explore" and confirm it lands on `/thesis/new?ticker=...` pre-filled.
14. **US-22/US-23/US-24** — Revisit `/recommendations`, confirm the full stats strip (already shipped, Task 16) still reflects the new recommendations created in this walkthrough.

- [ ] **Step 4: Error-handling spot checks (Section 5)**

Temporarily break the OpenRouter API key (or point `OPENROUTER_MODEL_ID` at a bogus model) and confirm a thesis-generation call fails with the spec's "Jarvis is thinking... Taking longer than usual. [Retry]" copy, not a raw stack trace; restore the key afterward. Confirm a stock with no resolvable Yahoo symbol shows "Price unavailable" rather than a broken UI.

- [ ] **Step 5: Confirm no client-side polling exists**

Grep the diff for `setInterval`/`setTimeout` used for polling anywhere under `app/` or `components/` — none should exist (Section 5 Price Data rule: prices update only on page load and the explicit "Refresh Prices" action, which this plan implements as an on-load `POST /api/prices/refresh` call per screen, never a timer).

- [ ] **Step 6: Update the plan's Task Index**

Mark all 30 tasks complete in this file's Task Index section (top of the document) so a future reader can see the plan is fully executed.

- [ ] **Step 7: Final commit**

```bash
/usr/bin/git add -A
/usr/bin/git commit -m "chore: Task 30 — whole-plan verification pass, all 24 user stories confirmed end-to-end"
```

At this point every task in this plan is complete. Proceed to `superpowers:finishing-a-development-branch`.
