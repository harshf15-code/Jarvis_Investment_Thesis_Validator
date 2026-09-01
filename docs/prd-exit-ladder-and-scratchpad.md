# PRD: Exit Discipline for Imported Holdings & the Portfolio Scratchpad

**Status:** Draft for review
**Author:** Drafted with Claude, from a conversation with Harsh
**Last updated:** 2026-08-31
**Related code:** `components/positions/exit-ladder.tsx`, `app/(app)/positions/[id]/page.tsx`, `components/positions/holding-rationale-panel.tsx`, `lib/holding-watch.ts`, `app/api/theses/[id]/route.ts`, `lib/jarvis-thesis-parser.ts`, `lib/jarvis-portfolio-council.ts`, `supabase/migrations/0006_thesis_cockpit_schema.sql`, `supabase/migrations/0020_portfolio_import.sql`, `supabase/migrations/0022_holding_watch.sql`, `supabase/functions/poll-prices/index.ts`

---

## Problem Statement

This covers two gaps, both discovered while using the imported-holdings flow shipped in `docs/prd-portfolio-import.md`.

**1. A stated reason never becomes an exit plan.** `HoldingRationalePanel` lets a trader record "why I own this" on an imported holding, and `HoldingReviewsPanel` gets real value from it — Jarvis's recurring read judges whether that stated reason still holds. But the `trade_plans` row behind an imported position is written **all-null at import time** (0020) and nothing ever fills it in. `ExitLadder` (`components/positions/exit-ladder.tsx`) reads `tradePlan.target_1`, `.target_2` and `.stop_loss` to decide each row's status — with all three null, every row sits at `PENDING` forever; a `HIT` is structurally impossible. `poll-prices` has nothing to evaluate either (confirmed by reading `supabase/functions/poll-prices/index.ts`: it acts purely on `stop_loss`/`target_1`/`target_2`/`time_exit_date`, all of which are null here). The one piece of information that could ground a real stop and targets — the trader's own stated reason for holding — sits right there on the same page and is never used for this.

**2. The pattern behind what gets bought is never reflected back.** Across a real book — HAL, a defense-sector name, a banking name, a Pepsi bottler — there is a legible pattern in what gets chosen, whether by sector, by market structure, or by the shape of the thesis (a monopoly/duopoly angle, a policy tailwind, a steady cash-generative consumer franchise). Nothing in the app looks at the *whole* book and says that back to the trader, and there is no dedicated place to jot a fresh idea that pattern suggests before it becomes a formal thesis. `theses.status = 'draft'` is the closest existing thing, but it is a half-finished formal thesis, not a scratchpad, and the trader flagged this overlap himself while describing the idea.

## Goals

1. Close the loop from "why I own this" to real exit discipline: once a rationale is recorded, give the trader a concrete, Jarvis-proposed stop and targets they explicitly approve — so the exit ladder can actually progress past `PENDING` and `poll-prices` has real levels to watch.
2. Never write a number the trader hasn't seen and approved — same review-before-commit discipline the regular memorandum's Trade Plan tab already has, not a silent auto-fill.
3. Give the trader an on-demand, honestly-grounded reflection on what his current holdings and theses say about his own taste as an investor.
4. Give the trader a lightweight place to note a fresh idea — prompted by that pattern read or by anything else — without forcing it into the formal thesis pipeline.
5. Reuse the app's existing discipline throughout: one OpenRouter model call per action, Zod-validated fenced-JSON output, per-user RLS, the `llm_usage` spend ledger, and — for the exit plan specifically — the existing `trade_plans` columns rather than new schema.

## Non-Goals (v1)

- **No silent/automatic exit-plan generation.** Saving a rationale never itself triggers a model call; building the exit plan is always a separate, explicit action the trader takes when ready. (Confirmed via clarifying question — see Decisions Already Made.)
- **No bulk "build all my imported holdings' exit plans" action.** One holding at a time in v1; a trader with many unattended imported holdings still visits each one.
- **No change to Jarvis-originated positions.** This only touches imported holdings, mirroring the existing `watched` scoping already established for the recurring holding review.
- **No scheduled/recurring pattern read.** The Scratchpad's pattern read runs on demand only in v1, the same way the portfolio Council does — no new `pg_cron` job.
- **No automatic promotion of a Scratchpad note into a thesis.** A note can link out to `/thesis/new?ticker=…` (P1) but nothing auto-converts a note's text into `theses.input_text`.
- **The Scratchpad does not reuse or restructure `draft` theses.** It is a new, separate concept (see Decisions Already Made) — a future pass could rationalize the two if they turn out to overlap in practice, but that is explicitly deferred.

## Decisions Already Made

These came out of clarifying questions before drafting, and shape everything below:

| Question | Decision |
|---|---|
| How should the exit ladder for an imported holding get filled in? | **Jarvis proposes stop-loss + targets from the stated rationale, live price and fundamentals; the trader reviews and can edit every number before anything is saved** — not manual-only, not a full memorandum re-run. |
| Does building the exit plan happen automatically when the rationale is saved? | **No — an explicit action** (e.g. a "Build Exit Plan" button), kept visibly separate from saving the rationale. |
| What is the Scratchpad? | **Both at once, on one panel:** Jarvis's on-demand pattern read on the current book, and a freeform notes area for the trader's own new ideas — living together so one can prompt the other. |
| Should the Scratchpad reuse `draft` theses? | **No — a new, standalone concept**, decoupled from the `theses` pipeline entirely. |
| Should the exit-plan approval carry its own disclaimer given how thin the basis is (one sentence + current price, vs. a full memorandum)? | **Yes** — the approval screen carries an explicit disclaimer, distinct from the standard editable-before-save review. |
| Does the exit-plan call see the portfolio objective? | **Yes, when one is set** (`portfolio_profiles.objective`) — same input the portfolio Council already uses. |
| What happens to exits/entries already logged when an exit plan is rebuilt (P1)? | **Rebuild is allowed, with an explicit "this will overwrite your current levels" warning.** Logged exits/entries are historical records and are never modified by a rebuild — only the `trade_plans` levels change. |
| Does the pattern read get a nudge like the recurring holding review? | **No — on-demand only.** Confirms the "explicit action, not automatic" decision extends to the pattern read too. |
| Should the pattern read use fetched sector/industry data or lean on the model's general knowledge? | **Fetched data.** Pulling Yahoo's `assetProfile` module (sector/industry) is in scope for v1 — moved out of Future Considerations — so the read is grounded in real per-ticker data, not only the model's trained classification. |
| Where does the "Build Exit Plan" prompt sit relative to the `ExitLadder` card? | **Both shown together** — the ladder still renders (all `PENDING`) with the build prompt alongside it, rather than hiding the ladder until a plan exists. |

## Architecture

### Part 1 — Exit Plan Builder (imported holdings)

**No new tables.** The two columns this needs already exist on `trade_plans` and are currently always empty for an imported holding:

- `ai_suggested jsonb` — will hold the raw model proposal (numeric levels + short per-level rationale) before any trader edits, the same role it plays for a Jarvis-originated plan.
- `edited_fields text[]` — will record which of `stop_loss` / `target_1` / `target_2` / `time_exit_date` the trader changed from what was proposed.

The build action is a `PATCH` (update, not insert) against the imported holding's **already-existing** `trade_plans` row — every imported position gets one at import time (0020), all-null. Once real numbers land in it:

- `ExitLadder` needs **no code changes** — it already reads `tradePlan.stop_loss` / `.target_1` / `.target_2` directly.
- `poll-prices` needs **no code changes** — confirmed by reading `supabase/functions/poll-prices/index.ts`: it evaluates stop/target/time-exit breach purely off those same four columns, with no branch on thesis source.

**One geometry nuance worth flagging now, not discovering it in code review:** `sanitizeTradePlanGeometry` (`lib/jarvis-thesis-parser.ts`) — the function that keeps a proposed trade plan internally consistent — anchors its stop-loss and target checks against `entry_zone_low/high` and `add_tranche_low/high`. Neither concept applies here: the trader already owns the shares, so there is no entry zone to buy into, only a current price and an average cost already paid. The exit-plan builder needs its **own**, simpler geometry check (stop below current price, target_1 above it, target_2 above target_1), not a reuse of the existing function as-is.

**New enum value:** `alter type llm_feature add value 'imported_exit_plan'`, mirroring exactly how 0022 added `'holding_review'` — so the spend ledger can label this call.

**New API surface (naming indicative, not final):**
- `POST /api/positions/[id]/exit-plan` — runs the model call, returns the proposal. Does **not** write anything.
- `PATCH /api/positions/[id]/exit-plan` (or reuse the existing trade-plan update route if one exists) — commits the trader-approved numbers into `trade_plans`, sets `ai_suggested` and `edited_fields`.

**UI integration point:** `app/(app)/positions/[id]/page.tsx` currently always renders `<ExitLadder tradePlan={tradePlan} …/>`. When `thesis?.source === 'imported'` and `stop_loss`/`target_1`/`target_2` are all still null, `ExitLadder` keeps rendering as-is (every row `PENDING`, exactly as today) with the build/CTA flow shown alongside it — not replacing it — so the trader sees what's missing and why, rather than the card disappearing:
- If `statedRationale(thesis.input_text, ticker)` is `null` (no reason recorded yet — the same helper `HoldingRationalePanel` already uses), the prompt points there first: "Add why you own this before Jarvis can propose an exit plan."
- If a rationale exists, the prompt is "Build Exit Plan" — one click runs the model call and opens a review step: proposed numbers (editable, with the short rationale behind each one) plus an explicit disclaimer that this plan comes from one stated reason and today's price/fundamentals, not a full comparative analysis — before anything saves.

### Part 2 — Portfolio Scratchpad

**Two new tables**, both following the `0013`/`0017`/`0020` template exactly (`user_id` defaulting to `auth.uid()`, an index on it, one `owner_all` RLS policy):

```
scratchpad_notes            -- the trader's own freeform ideas
  id, user_id, created_at, updated_at,
  body text not null,
  ticker text,              -- optional, free text — not validated against `stocks`;
                             -- a speculative idea may not resolve yet
  archived_at timestamptz   -- soft delete/archive, not a hard delete

portfolio_pattern_reads     -- append-only, same reasoning as `portfolio_council_reports`:
                             -- the book changes over time and a trader may want to compare
                             -- what Jarvis said about their pattern in June vs. now
  id, user_id, created_at,
  document jsonb not null,  -- the read itself (see schema sketch below)
  raw_llm_response text,
  holdings_snapshot jsonb not null   -- what was reviewed, so an old read never quietly
                                     -- reads as current once the book has moved on
```

**Pattern-read document shape (sketch, mirrors the honesty discipline of `HoldingReadSchema` / `StressTabSchema`):**

```
{
  headline: string,                 // one line: the pattern, stated plainly
  signals: [
    { theme: string, tickers: [string], note: string }   // each cluster grounded in real holdings
  ],
  not_explained: string | null,     // holdings that don't fit any cluster — honesty, not silence
  grounded_in: [string]             // same idea as HoldingRead.grounded_in
}
```

**Sector/industry is now fetched, not inferred.** `lib/market-data.ts`'s `getFundamentals`/`getHoldingSnapshot` already call `yahooFinance.quoteSummary(yahooSymbol, { modules: [...] })` — adding `"assetProfile"` to that modules array (the same one-line pattern that added `calendarEvents` for the holding watch) returns `sector` and `industry` per symbol. A new function (e.g. `getSectorProfile(yahooSymbol)`, or an `assetProfile` addition to the existing calls) fetches this per held ticker — one Yahoo round trip per symbol, same as fundamentals — and it is passed to the model as a structured fact, not left to the model's own trained classification. Where Yahoo has no `assetProfile` for a symbol (see Open Questions), that ticker's sector/industry is simply absent rather than guessed.

**What grounds the read:** every active position (ticker, company name where known, source `jarvis`/`imported`, fetched sector/industry), the stated rationale where one exists, each linked thesis's structured fields (`market_view`, `mispricing`, `catalyst`, `conviction_tier`), the portfolio objective (`portfolio_profiles.objective`, reused from the Council feature) where set, and the trader's own current Scratchpad notes — so the read and the notes can inform each other, per the "both, on one panel" decision.

**New enum value:** `alter type llm_feature add value 'portfolio_pattern_read'`.

**New route + nav entry:** `/scratchpad`, added to the Screens table in `README.md` alongside `/discovery` and `/recommendations`.

## User Stories

**Exit Plan Builder**
- As a trader who just recorded why I own an imported holding, I want Jarvis to propose a stop and targets from that reason and the current price, so my exit ladder can actually track progress instead of sitting on `PENDING` forever.
- As a trader, I want to review and edit every proposed number before it's saved, so I never end up with a stop or target I didn't actually choose.
- As a trader with an imported holding I haven't explained yet, I want to be told to add my reason first rather than getting a plan built from nothing, so the numbers are grounded in something real.
- As a trader, once my exit plan is set, I want the same alerting my Jarvis-originated positions already get (a breached stop, a hit target, a time exit) so an imported holding isn't a second-class position going forward.

**Scratchpad**
- As a trader, I want to ask Jarvis what pattern it sees across what I currently own, so I can see my own investing style stated back to me in plain terms.
- As a trader, I want that read to say plainly when a holding doesn't fit any pattern, rather than forcing everything into a tidy story.
- As a trader, I want a place to jot a new idea — a ticker, a half-formed thought — without it turning into a formal thesis I have to finish right away.
- As a trader, I want my notes and Jarvis's pattern read to sit on the same screen, so a note can react to the pattern and the pattern can reference my notes.
- As a trader, when a Scratchpad idea is ready, I want an easy way to turn it into a real thesis, so the idea doesn't have to be re-typed from scratch.

## Requirements

### Must-Have (P0)

**Exit Plan Builder**
- [ ] "Build Exit Plan" is offered on an imported holding's position page only when `thesis.source === 'imported'` and its trade plan's `stop_loss`/`target_1`/`target_2` are all still null.
- [ ] If no rationale is recorded yet (`statedRationale()` returns `null`), the prompt directs the trader to `HoldingRationalePanel` instead of offering to build a plan from nothing.
- [ ] The model call is grounded in: the stated rationale, current price, fetched fundamentals, quantity, average cost, held-since date, and the portfolio objective (`portfolio_profiles.objective`) when one is set — the same inputs `buildHoldingReviewContext` already assembles for the recurring review, reused rather than re-derived, plus the objective the portfolio Council already uses.
- [ ] Output is validated with a Zod schema (nullable-with-`.catch` fields, same discipline as `HoldingReadSchema`/`Memorandum`) and passes through a new, position-appropriate geometry sanitizer (stop below current price; target_1 above it; target_2 above target_1) — not the existing `sanitizeTradePlanGeometry`, which assumes an entry zone that doesn't apply here.
- [ ] Nothing is written to `trade_plans` until the trader explicitly approves — the proposal is shown first, every number is editable, and only the approved values are saved.
- [ ] The approval screen carries an explicit disclaimer that the plan is proposed from a single stated rationale and today's price/fundamentals, not a full comparative analysis — separate from, and in addition to, the editable-before-save review itself.
- [ ] Saving writes `stop_loss`/`target_1`/`target_2` (and `time_exit_date`/`time_exit_condition` if proposed) into the existing `trade_plans` row, stores the raw proposal in `ai_suggested`, and records any trader-changed field in `edited_fields`.
- [ ] The model call is logged to `llm_usage` under a new `imported_exit_plan` feature value and respects the existing daily/monthly budget check.
- [ ] Once saved, `ExitLadder` renders using the real values with no component changes, and the next `poll-prices` run can evaluate the position with no Edge Function changes.

**Scratchpad**
- [ ] `/scratchpad` route, linked from nav, added to the Screens table in `README.md`.
- [ ] Freeform notes: create, edit, and archive (soft delete) a text note, optionally tagged with a free-text ticker. Plain CRUD, RLS-scoped, no model call involved.
- [ ] Sector/industry is fetched per held ticker via a new `assetProfile`-module lookup in `lib/market-data.ts` (same `quoteSummary` mechanism `getFundamentals`/`getHoldingSnapshot` already use) and passed to the model as structured fact.
- [ ] An on-demand "Read My Pattern" action runs one model call grounded as described in Architecture, writes an append-only row to `portfolio_pattern_reads`, and renders with the latest read expanded and prior reads collapsed below it — same list idiom as `HoldingReviewsPanel`.
- [ ] The read explicitly separates structural fact (a ticker is held, its fetched sector/industry, a thesis said X) from the model's own read on what *pattern* those facts form — worded the way `HOLDING_REVIEW_SYSTEM_PROMPT` already separates fact from read.
- [ ] The read states plainly when a holding doesn't fit any identified pattern (`not_explained`), rather than forcing every holding into a cluster.
- [ ] The model call is logged to `llm_usage` under a new `portfolio_pattern_read` feature value and respects the existing budget check.

### Nice-to-Have (P1)

- [ ] Rebuilding an exit plan that already has real values — always allowed, gated by an explicit "this will overwrite your current levels" confirmation. Entries and exits already logged are historical records and are never touched by a rebuild; only `trade_plans`' levels change.
- [ ] The exit-plan proposal shows a `grounded_in`-style trail (which facts it actually used), matching `HoldingRead`'s existing pattern, so the trader can sanity-check the numbers at a glance.
- [ ] The pattern read surfaces short "you might also look at…" prompts alongside each signal, which the trader can accept with one click to create a pre-filled Scratchpad note — never created automatically.
- [ ] A "Start a thesis from this" link on a Scratchpad note, reusing the existing `/thesis/new?ticker=…` param already used by `OpportunityCard`.
- [ ] Filter/search the Scratchpad note list by tagged ticker.

### Future Considerations (P2)

- [ ] One-click promotion of a Scratchpad note directly into a `draft` thesis, auto-populating `input_text`, once the overlap between the two concepts is better understood in practice.
- [ ] Extend the exit-plan builder to any position with a thin or absent trade plan, not just imported ones.

## Success Metrics

**Leading**
- % of imported holdings with a stated rationale that get a built exit plan within 7 days of the rationale being saved.
- % of exit-plan proposals saved with zero edits vs. at least one edit (readable straight off `edited_fields`) — a signal on whether the proposed numbers are trusted as-is.
- Scratchpad notes created per active user per month.
- % of users with 3+ holdings who run at least one pattern read within their first month of eligibility.

**Lagging**
- Trend in the share of imported positions still carrying an all-null trade plan — should decline over time as this ships.
- Whether a pattern-read signal shows up again later — a new note or a new thesis touching a ticker/sector the read named — as a soft indicator the read is generating real ideas rather than being read once and ignored.

## Open Questions

- **[engineering]** When Yahoo's `assetProfile` module has no `sector`/`industry` for a symbol (small-caps, some ADRs, non-equity instruments), does the pattern read fall back to the model's own classification for just that one holding, or does that ticker simply land in `not_explained` as unclassified?
- **[design]** Now that the ladder and the build prompt render together rather than one replacing the other, what's the exact layout — prompt above the ladder, beside it, or as an inline banner over the still-`PENDING` rows?
- **[design]** Exact wording of the exit-plan disclaimer, and whether it needs a one-time acknowledgment (like a checkbox) or is sufficient as static text next to the proposal.

## Timeline Considerations

- No hard external deadline.
- The two parts are independently shippable and naturally sequence as two phases, the same way the three capabilities in `docs/prd-portfolio-import.md` were phased: **Part 1 (Exit Plan Builder)** touches no new tables and reuses existing routes and components almost entirely — the smaller, faster piece. **Part 2 (Scratchpad)** is a new surface (two new tables, a new route, a new nav entry) and is naturally Phase 2.
- Part 1 has a soft dependency worth naming: it is far more useful once a meaningful number of imported holdings already carry a stated rationale, since the builder refuses to run without one. If few imported holdings have a rationale yet, consider prompting for rationale completion alongside — or just ahead of — shipping Part 1.
