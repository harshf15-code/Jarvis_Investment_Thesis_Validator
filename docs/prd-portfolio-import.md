# PRD: Import Portfolio & Portfolio-Level Intelligence

**Status:** Draft for review
**Author:** Drafted with Claude, from a conversation with Harsh
**Last updated:** 2026-08-31
**Related code:** `app/(app)/positions/page.tsx`, `components/positions/positions-page-client.tsx`, `app/api/positions/route.ts`, `lib/jarvis-memorandum.ts`, `lib/jarvis-council.ts`, `lib/market-data.ts`, `supabase/migrations/0006_thesis_cockpit_schema.sql`, `supabase/migrations/0017_investment_council.sql`

---

## Problem Statement

Every position in Jarvis today has to be born inside Jarvis: `positions` requires a `thesis_id` and a `trade_plan_id`, both `NOT NULL`, both produced by the thesis → memorandum flow. That's correct for trades Jarvis originated, but it means a trader's *pre-existing* holdings — stocks bought before they started using this app — are structurally invisible to it. Jarvis can't price them next to the rest of the book, can't watch them for a stop or a time exit, and the Investment Council can't be asked "does this portfolio make sense" because there is no portfolio, only whatever subset happened to start life as a Jarvis thesis.

That's a real gap for the app's own stated purpose. The README's premise is "it watches the market and emails you when a level is hit" and the Cockpit's promise is "portfolio state at a glance" — neither is true today for a trader whose book predates Jarvis, which is most traders on day one.

This PRD covers three tightly-coupled capabilities that close that gap:

1. **Import Portfolio** — bring pre-existing holdings into Jarvis's data model so they sit alongside Jarvis-originated positions everywhere (Cockpit, Positions, Journal, alerts).
2. **Per-holding Jarvis analysis** — an initial read on each imported holding (grounded in *why the trader bought it* and what they're watching for), plus a recurring watch that flags earnings and fundamentals developments that might threaten the original reason to stay invested.
3. **Portfolio-wide Investment Council** — the existing Council roster (`council_members`), but consulted on the whole portfolio's construction — concentration, diversification, sizing — not one thesis at a time.

## Goals

1. Let a trader get their *entire* real portfolio into Jarvis — not just what they've bought through it — without hand-entering every position one field at a time.
2. Give every imported holding the same "why am I in this, and is it still working" scrutiny a Jarvis-originated position gets from its memorandum, even though no memorandum was ever run to buy it.
3. Keep that scrutiny *running*, not one-and-done — flag material developments (an earnings date, a fundamentals shift) against the trader's stated reason for holding, without requiring the trader to remember to re-check.
4. Let the Investment Council speak to the portfolio as a whole — the thing an actual advisor would review first — not only to one position in isolation.
5. Reuse the app's existing engineering discipline throughout: one OpenRouter model, Zod-validated structured output, per-user Postgres RLS, and — critically — the *existing* `positions`/`entries`/`theses`/`trade_plans` tables rather than a second, parallel portfolio model that every other screen (Cockpit, Journal, alerts) would need to learn about separately.

## Non-Goals (v1)

- **No direct broker API integration.** Import is CSV-based in v1. A direct Zerodha Kite Connect pull was considered (this environment happens to have a live Kite MCP connection) and explicitly deferred — see Future Considerations — in favor of a broker-agnostic mechanism that works for any broker's export and doesn't couple the feature to one account's live credentials.
- **No live web search or news/transcript ingestion.** The recurring watch (capability 2) is grounded in an earnings *calendar* and *fundamentals deltas* pulled from the same Yahoo Finance source the rest of the app already uses — not open-ended "read the news and summarize management commentary." See the callout under Requirement 2 — this is a real scope reduction from the original ask and is called out on purpose, not glossed over.
- **No per-tranche import history.** A holdings CSV gives a single average cost and quantity, not a trade-by-trade history. Import records one collapsed entry per holding (weighted-average cost as of the import date), not a reconstructed tranche-by-tranche history. A future tradebook-CSV import could add real history later without a breaking change (see Future Considerations).
- **No automated re-import / sync.** Each CSV upload is a one-time, reviewed batch. There's no "keep this in sync with my broker" background job in v1 — re-importing is a trader-initiated action.
- **No extension of the recurring watch to Jarvis-originated positions in v1.** Scoped to imported holdings only, per the trader's ask, even though the schema is designed so this isn't a breaking change to add later (see Future Considerations).
- **No portfolio Council history UI beyond a simple list.** The report itself persists and is browsable, but no diffing/trending across multiple Council runs in v1.

## Decisions Already Made

These came out of clarifying questions before drafting, and shape everything below:

| Question | Decision |
|---|---|
| How do holdings get in? | **CSV upload**, broker-agnostic, with a column-mapping + preview step (not a blind parse) before anything is committed. |
| Direct Kite Connect import? | Considered, explicitly **deferred** — see Non-Goals and Future Considerations. |
| Is the per-holding watch a one-off or ongoing? | **Recurring**, scheduled like the existing `poll-prices`/`daily-digest` Edge Functions — the trader shouldn't have to remember to re-check. |
| What grounds "new earnings reports, management commentary"? | **Earnings calendar + fundamentals deltas only** — no live web search, no asking the model to invent commentary it can't actually know. This narrows "management commentary" to what's structurally knowable (an earnings date has passed, a fundamental has moved); see the callout under Requirement 2. |
| Does the portfolio Council also give per-holding calls, or structure only? | **Both** — a structural read (concentration, diversification, sizing, cash) *and* an explicit trim/add/hold view per holding from each council member. |
| How do imported holdings fit the schema? | They become ordinary rows in the **existing** `theses` → `trade_plans` → `positions` → `entries` tables via a minimal, auto-generated thesis and trade plan (see Architecture below) — not a second, parallel "holdings" table that every other screen would need to special-case. |

## Architecture: fitting imports into the existing model

`positions.thesis_id` and `positions.trade_plan_id` are both `NOT NULL` foreign keys, and `position-metrics.ts`, the Journal, the Cockpit, and the price/alert poller all assume every position has both. Rather than making those columns nullable (which ripples into every query and view that joins through them), an import creates:

- one **`theses`** row per imported holding — `input_text` holds the trader's optional "why I bought this" blurb, `mode` defaults to `'stock_only'` (no free-text thesis was parsed, so the field's normal meaning doesn't apply), `status` is `'active'`. A new `source` column (`thesis_source` enum: `'jarvis' | 'imported'`, default `'jarvis'`) marks provenance so the UI can badge imported theses and so a future recurring-watch expansion can query by source without a schema change.
- one **`trade_plans`** row per imported holding — every level (`entry_zone_low`, `stop_loss`, `target_1`, …) is `null`; there's no AI-suggested trade plan because no analysis produced one. `ai_suggested` stays `{}`.
- one **`positions`** row, `status = 'active'`.
- one **`entries`** row — `tranche = 'T1'`, `quantity`/`price` = the CSV's quantity/average cost, `date` = a trader-supplied "as of" date (CSVs from a holdings export don't carry original purchase dates), `notes` flags it as an import with an unverified date.

This means: Cockpit totals, the Positions table, `position-metrics.ts`'s weighted-average math, the Journal, and the existing price/stop/target/time-exit alert poller all work on imported holdings **for free**, with zero changes to any of those surfaces. The only genuinely new tables are the ones with no existing analog: an import audit log, the holding-watch history, the portfolio-level objective, and the portfolio Council report. Full migration sketch:

```
thesis_source (enum: 'jarvis', 'imported')
  alter table theses add column source thesis_source not null default 'jarvis';

portfolio_imports        -- one row per CSV upload, for audit/undo-by-reference
  id, user_id, created_at, source_filename, total_rows,
  imported_rows, skipped_rows, status ('completed'|'partial'|'failed'), errors jsonb

  alter table theses add column import_batch_id uuid references portfolio_imports(id) on delete set null;

holding_reviews           -- append-only: one row per watch run (initial + every recurring trigger)
  id, user_id, thesis_id, position_id, created_at,
  trigger ('manual' | 'earnings_calendar' | 'fundamentals_delta' | 'scheduled'),
  document jsonb, raw_llm_response

portfolio_profile         -- single row per user
  user_id (pk), objective text, updated_at

portfolio_council_reports -- append-only history, not replace-in-place (composition changes over time;
                           -- a trader may want to compare what the Council said last quarter vs. now)
  id, user_id, created_at, document jsonb, holdings_snapshot jsonb, raw_llm_response
```

All new tables follow the `0013`/`0017` template exactly: `user_id` defaulting to `auth.uid()`, an index on it, and an `owner_all` RLS policy.

## User Stories

- As an investor, I want to **upload a CSV of my current holdings** and see a preview — resolved ticker, company name, exchange, quantity, average cost — before anything is saved, so I can catch a bad row (a typo'd symbol, a delisted stock) rather than discovering it later on my Cockpit.
- As an investor, when a column in my CSV isn't auto-detected correctly (different brokers name columns differently), I want to **remap it myself** from a dropdown, so the import isn't blocked by a header name Jarvis didn't expect.
- As an investor, I want to **add a short note on why I bought each holding** (optional, at import time or later from the position page), so Jarvis's ongoing read on that holding is grounded in *my* original reasoning, not a generic read on the ticker.
- As an investor, I want to state **what I'm trying to do with this portfolio overall** (optional, one field, editable anytime), so the Investment Council's structural read is judged against my actual goal, not an assumed one.
- As an investor, once a holding is imported, I want Jarvis to **run an initial analysis on it immediately**, so I get a first read (is the thesis still intact, what to watch) right away rather than waiting for the next scheduled check.
- As an investor, I want Jarvis to **keep watching each imported holding** for an upcoming or newly-reported earnings date, or a material shift in its fundamentals (P/E, margins, growth), and tell me whether that changes my reason to stay invested — without me having to remember to check.
- As an investor, I want a flagged holding to **show up in my existing Feed** (and the daily digest email), the same place Jarvis already tells me about things worth my attention, rather than a second inbox I have to separately check.
- As an investor, I want to **consult the Investment Council on my whole portfolio** — not one stock — and get a read on structure: am I too concentrated, too diversified, sized sensibly, holding too much or too little cash for what I said I'm trying to do.
- As an investor, I want that portfolio-level Council to **also weigh in per holding** — a trim/add/hold view from each member — so I get both the forest and the trees in one place.
- As an investor, I want the portfolio Council to work off **current** prices and fundamentals for every holding, not stale numbers from whenever each was imported or last analyzed, since "what should my advisors think of this portfolio *today*" is the actual question.
- As an investor, I want it clear which of my positions came from Jarvis's own analysis and which I imported, so I know which ones have a real trade plan (entry, stop, targets) behind them and which don't yet.

## Requirements

### Must-Have (P0)

**1. CSV Portfolio Import**

- New entry point: an "Import Holdings" action on `/positions` (`components/positions/positions-page-client.tsx`), opening a dedicated import flow (modal or `/positions/import` route — engineering's call, but it must be a multi-step flow, not a single-shot upload-and-commit).
- **Step 1 — Upload & map:** accept a CSV file. Parse the header row and attempt to auto-detect the ticker/symbol, quantity, and average-price columns by common header names (Zerodha Kite Console's holdings export is the primary target format, but the mapping step must not assume it — any CSV with those three logical columns, however named, must be importable). Every auto-detected mapping is shown and editable via a dropdown before proceeding; ticker, quantity, and average price are required mappings, a purchase-date column is optional.
- **Step 2 — Resolve & preview:** for every row, resolve the ticker against the existing `stocks` table / Yahoo lookup path (the same resolution used by the thesis candidate pipeline), and show a preview table: resolved company name, exchange, quantity, average cost, and a per-row status (resolved / needs attention). A row that fails to resolve (unsupported exchange, symbol not found, obvious duplicate of an existing open position) is flagged inline with why, and is excluded from the commit unless the trader fixes or explicitly confirms it — never silently dropped without being shown.
- If no purchase-date column was mapped, prompt once for a single "as of" date to apply to every row in the batch (clearly labeled as an approximation, not a real purchase date).
- Optional per-row free-text field: "Why did you buy this?" — skippable per row, addable later from the position page.
- Optional, asked once (only if `portfolio_profile` has no row yet): "What's the goal for this portfolio?" — feeds `portfolio_profile.objective`.
- **Step 3 — Confirm & commit:** on confirm, atomically create the `portfolio_imports` batch row plus, for every resolved row, the `theses` (`source='imported'`) / `trade_plans` / `positions` / `entries` rows per the Architecture section above. Partial success is allowed and recorded (`portfolio_imports.status = 'partial'`) — one bad row must not fail the whole batch.
- Acceptance criteria:
  - [ ] A trader can upload a CSV and reach a full preview (resolved tickers, quantities, costs) without anything being written to the database yet.
  - [ ] Column mapping works for at least Zerodha Kite Console's holdings export out of the box, and can be manually remapped for any other CSV shape.
  - [ ] A row that fails ticker resolution is visibly flagged with a reason, not silently skipped.
  - [ ] After commit, every successfully imported holding appears on `/positions` and in Cockpit totals identically to a Jarvis-originated position, aside from an "Imported" badge (from `theses.source`).
  - [ ] The import batch (filename, row counts, timestamp, any skipped rows and why) is retrievable later for audit — a trader can answer "what did I import last Tuesday and did anything fail."
  - [ ] Re-uploading a CSV that includes a ticker already held as an open position is flagged as a likely duplicate rather than silently creating a second position in the same stock.

**2. Per-Holding Jarvis Analysis (initial + recurring watch)**

> **Scope callout:** the trader's original ask was for Jarvis to watch for "new Earnings Reports, management commentary etc." This app has no news, transcript, or live-search data source today — only price/fundamentals (Yahoo Finance) and the model's own trained knowledge, which the Council feature already deliberately avoids leaning on for anything "current." Per the decision above, v1 grounds this feature in an **earnings calendar and fundamentals deltas** — concrete, structural signals — rather than asking the model to narrate "management commentary" it cannot actually know happened. This is a real narrowing of the original ask; a live news/search integration is the natural way to close that gap and is listed under Future Considerations, not silently dropped.

- Immediately after an import commits, trigger one `holding_reviews` run per imported holding (`trigger = 'manual'`, effectively "initial"), grounded in: the trader's "why I bought this" blurb (if given), current price/fundamentals, and the portfolio objective (if set). Output: a structured read — is the original reasoning (if given) still intact, what to watch, and a stay/trim/exit-leaning read — following the same Zod-validated, nullable-fields-degrade-individually pattern as `lib/jarvis-memorandum.ts`.
- New scheduled Edge Function (e.g. `holding-watch`, `pg_cron`, mirroring `poll-prices`'s cadence), scoped in v1 to positions on **imported** theses (`theses.source = 'imported'`) only. For each, on a schedule (daily is the default assumption — open question below on exact cadence):
  - checks whether a known earnings date is newly upcoming (within N days) or has newly passed since the last check (`trigger = 'earnings_calendar'`);
  - checks whether fundamentals (P/E, margins, revenue growth — the same fields already fetched in `lib/market-data.ts`) have moved beyond a threshold since the last snapshot (`trigger = 'fundamentals_delta'`);
  - if either fires, runs a new `holding_reviews` entry and writes an `intelligence_signals` row so it surfaces in the existing Feed and daily digest email — reusing that pipeline rather than building a second notification surface.
- A trader can also manually re-run the analysis on demand from the position page (`trigger = 'manual'`) at any time, not only via the schedule.
- Acceptance criteria:
  - [ ] Every imported holding gets an initial `holding_reviews` entry within the same flow as the import, without a separate trader action.
  - [ ] A holding review that finds nothing material still produces a visible "checked, nothing material" result — not silence — matching the app's "never silently null" discipline.
  - [ ] A flagged development (earnings date, fundamentals delta) appears in `/feed` and in the daily digest email, tied back to the holding it concerns.
  - [ ] The review is explicit about what it is and isn't grounded in — it must not present a fabricated "management said X on the earnings call" as fact; only calendar/fundamentals-level statements are asserted as fact, everything else is framed as the model's own read.
  - [ ] History of reviews for a holding is browsable on its position page (`/positions/[id]`), not just the latest.
  - [ ] A holding review costs at most one model call per trigger (no N+1 fan-out here — this is a single-persona read, not a Council).

**3. Portfolio-Wide Investment Council**

- Reuses the **same** `council_members` roster used by the existing per-thesis Council — no second roster to manage.
- New entry point: a "Consult Investment Council on My Portfolio" action on `/positions` (the natural "here's my whole book" screen), opening the same style of member picker (min 3, max 7) used by the thesis-level Council.
- Backend pipeline, mirroring `lib/jarvis-council.ts`'s shape: for each selected member, one independent model call grounded in (a) every open position's current weight/value in the portfolio, (b) **freshly fetched** price and fundamentals per holding (not whatever was last cached — "what would my advisor say today"), and (c) the trader's stated `portfolio_profile.objective`, if set. Per the decision above, each member's output covers **both**:
  - a structural read: concentration, sector/theme tilts, position sizing relative to the rest of the book, cash allocation — framed against the stated objective when one exists;
  - a per-holding view: an explicit trim / add / hold lean on each position, with the single biggest reason.
  One further synthesis call combines the panel into a single portfolio-level verdict plus where members agreed/split, following the same structure as the thesis-level Council's synthesis.
- Acceptance criteria:
  - [ ] A consult costs N+1 model calls (same formula as the thesis Council) **plus** the live market-data fetches needed to refresh every holding first — call this out explicitly in the confirm step, since a large portfolio makes this consult meaningfully more expensive/slower than a thesis-level one.
  - [ ] If a member's call fails, their card shows the failure and the rest of the report (including synthesis from whichever succeeded) still renders — same discipline as the thesis Council.
  - [ ] The report persists (`portfolio_council_reports`) and is browsable after the fact without re-running.
  - [ ] Re-running produces a **new** history entry (not a silent replace) — a trader can compare what the Council said about the same portfolio at two different points in time.
  - [ ] The report shows which holdings it reviewed and as of when (`holdings_snapshot`), so a report doesn't silently read as current once the portfolio has since changed.
  - [ ] The same mandatory AI-simulation disclaimer from the thesis-level Council appears here too, wherever a persona's name and opinion show up.
  - [ ] Works correctly whether the portfolio is entirely imported holdings, entirely Jarvis-originated positions, or a mix — the Council doesn't distinguish provenance, only the trim/add/hold and structural read.

### Nice-to-Have (P1)

- A dedicated "import history" view listing every `portfolio_imports` batch with the ability to see exactly which positions came from which batch.
- Letting the trader adjust the earnings-calendar/fundamentals-delta thresholds that trigger a recurring watch run, instead of a single fixed default for everyone.
- Surfacing the portfolio objective directly on the Cockpit, not only inside the import flow and the Council consult.
- A lighter "quick add" manual-entry path (single holding, no CSV) for a trader who just wants to add one missed position rather than a full re-import.
- Trend view across multiple `portfolio_council_reports` over time (has concentration gone up or down since the last consult).

### Future Considerations (P2)

- **Direct Zerodha Kite Connect import** — pull holdings straight from the broker instead of a CSV export, removing the manual download/upload step entirely. Deliberately deferred from v1 (see Non-Goals) so the import mechanism isn't coupled to one broker's live API from day one; the CSV path's column-mapping UI is designed so a Kite-native import could be added later as a second source into the *same* preview/commit flow, not a parallel one.
- **Live news/transcript grounding for the per-holding watch** — the natural way to actually deliver on "management commentary," via a web-search or news-API integration feeding the `holding_reviews` prompt with real, dated source material instead of only calendar/fundamentals triggers. This is the most direct way to close the scope gap flagged under Requirement 2.
- **Extending the recurring watch to Jarvis-originated positions**, not just imported ones — the schema (`holding_reviews` keyed by `thesis_id`/`position_id`, not by source) doesn't need to change for this, only the Edge Function's query scope.
- **Tradebook (not just holdings) CSV import**, to reconstruct real per-tranche entry history instead of one collapsed average-cost entry.
- **Automated periodic re-sync** with a connected broker, once a direct integration exists, instead of trader-initiated one-off imports.

## Success Metrics

**Leading indicators** (evaluate at 2 and 4 weeks post-launch):
- **Import completion rate**: % of started imports (a CSV is uploaded) that reach a committed batch. Low completion would point at the mapping/preview step being confusing rather than the mechanism being unwanted.
- **Holding-note attach rate**: % of imported holdings that get a "why I bought this" note, either at import or after — a proxy for whether the grounding context is felt to be worth the extra effort.
- **Watch-to-Feed conversion**: % of scheduled `holding-watch` runs that produce a Feed-visible flag vs. a "nothing material" result — too high suggests the fundamentals-delta threshold is too sensitive (noise), too low suggests it's too tight to ever fire.
- **Portfolio Council adoption**: % of accounts with ≥2 open positions that run at least one portfolio-level consult within 30 days of having enough positions to make one meaningful.

**Lagging indicators** (evaluate at 8–12 weeks):
- **Repeat portfolio consults**: % of users who run the portfolio Council more than once, and whether portfolio composition measurably shifted between runs (directional signal only).
- **Imported-holding retention of the watch feature**: of holdings that got at least one Feed flag, % where the trader took a visible action afterward (logged an exit, edited the holding's note) vs. no visible reaction — a rough read on whether the flags are actually useful or just noise.

**Same open dependency as the Council PRD**: this codebase has no analytics tool wired in today; instrumenting the above needs its own scoping (see Open Questions).

## Open Questions

- **[product]** Exact cadence for the recurring `holding-watch` job — daily (mirroring `poll-prices`'s frequency during market hours) is this PRD's working assumption, but earnings dates and fundamentals don't move at market-tick speed, so a slower cadence (e.g. once daily after close, or even weekly) may be enough and cheaper. Needs a decision before the Edge Function is scoped.
- **[product]** Should the fundamentals-delta threshold be a fixed percentage move (e.g. P/E moves >15% since last snapshot) or metric-specific? A fixed threshold is simpler to ship but may over- or under-trigger depending on the metric.
- **[product]** For the portfolio Council's per-holding trim/add/hold view — does every member have to give a view on every single holding, or only the ones they have a real opinion on? For a portfolio with many positions this changes token cost materially and is worth deciding before the prompt is written, not after.
- **[legal/product]** Same open question as the existing Investment Council PRD applies here with more force: a portfolio-level "advisor" framing edges closer to something a trader could mistake for real financial advice than a single thesis critique does. Worth confirming the existing disclaimer language is strong enough at this surface, or whether portfolio-level output needs its own, more prominent version.
- **[engineering]** Where exactly does the "Import Holdings" entry point live — a modal over `/positions`, or its own route (`/positions/import`)? A dedicated route is easier to resume mid-import (e.g. after fixing an unresolved row) but is a bigger UI lift than a modal.
- **[engineering]** `resolveYahooSymbol`/the ticker-resolution path used by the thesis pipeline assumes a ticker string is already known; a CSV column holding full company names instead of symbols (some non-Kite exports do this) needs a name→ticker resolution step this PRD hasn't scoped. Worth confirming whether v1 requires the CSV to carry a ticker/symbol column specifically, with name-only CSVs explicitly unsupported until a resolver exists.
- **[data]** Same instrumentation gap as the Investment Council PRD — no analytics tool is currently connected to this project.

## Timeline Considerations

- No hard external deadline.
- Suggested phasing:
  - **Phase 1 (this PRD's P0 scope, Requirement 1):** CSV import — upload, column mapping, preview/resolve, commit into the existing `theses`/`trade_plans`/`positions`/`entries` tables via the synthetic-thesis pattern. Ships value (a complete Cockpit/Positions view) even before Requirements 2 and 3 exist.
  - **Phase 2 (Requirement 2):** Initial + recurring per-holding analysis — the `holding_reviews` table, the initial run wired into the import flow, then the scheduled `holding-watch` Edge Function and its Feed integration.
  - **Phase 3 (Requirement 3):** Portfolio-wide Investment Council — reuses the roster from the existing Council feature, so this phase is mostly the new aggregate pipeline, `portfolio_profile`, and `portfolio_council_reports`.
  - **Phase 4 (P1/P2):** Import history UI, quick-add manual entry, adjustable thresholds, direct Kite Connect import, live news grounding.
- **Sequencing note:** Phase 1 has no hard dependency on the existing Investment Council feature (`docs/prd-investment-council.md`) shipping first, but Phase 3 directly reuses its roster and Zod/RLS patterns — if that feature's [legal] open question about using real public figures' names is still unresolved when Phase 3 starts, it blocks Phase 3's default roster the same way it blocks that PRD's own Phase 1.
