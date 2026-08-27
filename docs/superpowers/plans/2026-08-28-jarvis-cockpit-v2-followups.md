# Jarvis Decision Cockpit v2 — Deferred Follow-Ups

Findings from the final whole-branch review (Opus, 22 commits / 64 files / ~5,600 lines)
and from rulings made during the Tasks 20–30 execution run. **No Critical issues were
found.** The branch was merged with these outstanding, deliberately.

Ordered by what actually bites first.

---

## 1. `/thesis/[id]` trade-plan grid can't be tab-edited, and a failed save looks saved

**File:** `app/(app)/thesis/[id]/page.tsx:128-159`

`patchTradePlan()` calls `refresh()` after every field blur, which re-runs the mount
effect: `setLoading(true)` replaces the whole screen with `<SkeletonLoader lines={8}/>`
and re-issues `POST /api/prices/refresh` (a live Yahoo round-trip plus a DB write).

Three consequences, worst first:

- **A failed save is invisible.** No `res.ok` check, no `catch`. The PATCH schema is
  `.strict()`, so a 400 or a network blip yields an unhandled rejection — and because
  `updated_at` never changes, the input's remount key `${key}-${tradePlan.updated_at}`
  stays the same, so the field keeps displaying the unsaved value *as if it saved*.
  This is the same optimistic-update-looks-saved bug that was ruled a must-fix during
  Task 23, now sitting on `stop_loss` and the trim targets. `handleResetField` (line 154)
  shares the unguarded path.
- **Keyboard editing is broken.** Blur field A → the screen unmounts → the field you just
  tabbed into no longer exists. A nine-cell numeric grid is exactly the thing you edit
  by keyboard.
- **Nine Yahoo fetches + nine `stocks` writes** to fill in nine fields.

**Fix:** replace `refresh()` with `setTradePlan(body.tradePlan)` from the PATCH response
(the route already returns the updated row), and add the `res.ok` + rollback treatment
that `components/positions/thesis-metrics-panel.tsx:44-62` already implements correctly.
That removes the skeleton flash, the focus loss, and the redundant price call at once.

**Note:** this is also the branch's clearest inconsistency — three different autosave
strategies for the same "save on blur" problem, one per component author:
refetch-everything (here), optimistic-with-rollback (`thesis-metrics-panel.tsx:44`), and
explicit-commit-with-local-state (`stress-test-panel.tsx:59`). The middle one is right.

---

## 2. Screen 8 (Discovery) has no producer for 8 of its 11 fields

**File:** `components/discovery/add-watchlist-modal.tsx:21`

The modal submits only `{ ticker, market, watching_only: true }`, and it is the *only*
producer of `opportunities` rows. `POST /api/opportunities` already accepts `sector`,
`conviction_tier`, `thesis_summary`, `pe`, `sector_median_pe`, `fifty_two_week_low`,
`fifty_two_week_high` — nothing ever sends them. So on `/discovery`, permanently:

- `opportunity-card.tsx:44` renders `PE — vs sector —`, sector `—`, no thesis summary,
  no `ConvictionBadge`, and the "Near 52W High ⚠" chip can never appear.
- The "All Tiers" filter (`discovery/page.tsx:53`) is a no-op — every tier is null.
- "Sort: PE" (`discovery/page.tsx:56`) is a no-op, and with every `pe` null the
  comparator evaluates `Infinity - Infinity = NaN` for every pair.

US-20's sort/filter acceptance criteria can't be demonstrated as-is.

**Fix:** add the six optional fields to the modal, mirroring what
`components/feed/add-signal-modal.tsx` already does for signals. The API and types need
no change. Also switch the PE comparator off `NaN`-producing `Infinity` subtraction.

---

## 3. Exit dates can be recorded one day early (IST, late night)

**Files:** `components/positions/log-trim-modal.tsx:17`,
`components/positions/stop-exit-modal.tsx:17`, `app/api/cockpit/route.ts:100`,
`app/api/signals/route.ts:44-45`

All four use `new Date().toISOString().slice(0, 10)`, which is UTC. Between 00:00 and
05:30 IST that is *yesterday* — so a late-night trim or stop log defaults to the wrong
trade date in the journal, the cockpit's overdue chips are a day off, and the agenda's
14-day window is shifted.

NSE hours (09:15–15:30 IST = 03:45–10:00 UTC) sit safely inside the same UTC day, so
this only bites outside market hours — which is exactly when you'd be logging fills.

**Fix:** `lib/format.ts` already exports `exchangeTimeZone()`. Same fix for all four.

---

## 4. `api/cockpit` and `api/positions` duplicate ~50 lines

**Files:** `app/api/cockpit/route.ts:35-72`, `app/api/positions/route.ts:20-50`

The id collection, four parallel `.in()` joins, three `Map` builds, and `PositionRow`
assembly are near-verbatim between them. Nothing is wrong today because they agree — but
`PositionsTable` consumes rows from both, so any future change to that shape must be made
twice or the two screens silently diverge.

**Fix:** extract `loadPositionRows(supabase, statuses)` into `lib/` while they're still
identical. Both routes have tests to catch regressions.

---

## 5. Three unchecked `fetch` responses

A standardization sweep during Task 29 fixed this pattern across the branch; these three
were missed.

- `app/(app)/thesis/[id]/page.tsx:161` — `handleRerun` doesn't check `res.ok`. The
  stress-test route returns 502 on an OpenRouter failure; the UI just stops the spinner
  and re-renders the same bear cases, indistinguishable from success. The sibling screen
  `thesis/[id]/plan/page.tsx:50-54` checks this *same* endpoint and surfaces the error.
- `app/(app)/feed/page.tsx:51` — `handleArchive`. A failed archive silently reloads and
  the signal stays in Active.
- `components/feed/thesis-preview-drawer.tsx:15` — no `res.ok`, no `.catch`. A 404 leaves
  the drawer spinning forever plus an unhandled rejection.

**Fix:** the four-line shape used everywhere else in the branch:
`const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error ?? "…")`

---

## 6. Smaller items

- **`positions-page-client.tsx:31`** ranks "most urgent" by `rupeesToStop` across a mixed
  INR/USD book, so a ₹50 gap outranks a $2 gap. Sort by `distance.percent` — currency-
  neutral and free.
- **`LastUpdated` missing on `/positions` and `/recommendations`.** Spec Section 5 wants
  it on every screen showing prices; the five screens this branch built all have it.
  `/api/positions` already returns `stock.last_price_at`.
- **`GET /api/theses` returns `select("*")`**, shipping full `raw_llm_response`
  transcripts over the wire just to populate a `<select>` of tickers
  (`add-signal-modal.tsx:11`). Narrow the select.
- **`stress-test-panel.tsx:69`** fires a PATCH on every arrow keypress via `onKeyUp`
  while dragging the conviction slider. Debounce, or commit on blur.
- **font-mono gaps on numeric data:** share counts in `positions/[id]/page.tsx`,
  discipline score + date columns in `journal-archive-table.tsx`, dates in
  `agenda-sidebar.tsx`, timestamp in `signal-card.tsx`.
- **`max_portfolio_pct` and `time_exit_condition` are write-once** — both are in the
  server's `EDITABLE_FIELDS` but no client surface can edit them. Needs a product
  decision (should they be editable?), not a mechanical fix.

---

## Deliberately parked (with reasoning)

These were examined and consciously left alone. Reopen only with the reasoning in view.

- **Unguarded `fetchInternalApi` on four server-component pages** (`journal`, `positions`,
  `recommendations`, `thesis`). A 500 body is still JSON, so `body.entries` is merely
  `undefined` — the failure mode is a misleading empty state, not a crash. It's a genuine
  codebase-wide convention, and fixing one page creates exactly the divergence the rest of
  this list complains about. **All four together, or none.**
- **`app/api/journal/route.ts:120`'s `conviction_tier_used ?? "IV"`.** A transient `theses`
  read failure permanently records the trade as Tier IV, skewing the archive's per-tier
  stats. Inherited from the plan. If ever touched, the fallback should raise an error
  rather than record a plausible-looking wrong tier.
- **Cross-currency portfolio P&L** sums INR and USD into one scalar. The UI labels it
  "(mixed currencies)" and drops the symbol — honest, but not correct. A real fix needs
  per-currency grouping or a stored FX rate.
- **Day/week/MTD P&L** on the Cockpit is scope-reduced to "Total Open P&L". The v2 schema
  stores no time series of portfolio value; a real fix needs a `portfolio_snapshots` table
  on a schedule.
- **Server-side last-write-wins on `thesis_conditions`.** `PATCH /api/trade-plans/:id`
  takes the whole array, so two overlapping saves can lose one row's edit. Single-user app,
  requires two near-simultaneous blurs within one round-trip.
- **No test for `PATCH /api/signals/[id]`** (archive). Coverage gap, not a defect.

---

## Not verified by any automated gate — needs a human at a browser

Everything below was checked by types, lint, unit tests, a live authenticated API smoke
test, and a real write-path test against the schema. What follows genuinely cannot be
discharged without eyes on a screen:

- **Tab through the nine trade-plan fields on `/thesis/[id]`** — this is finding #1, and
  it's the top of the list.
- The amber-underline "edited" treatment on inline-saved fields.
- The amber-pulsing skeleton during AI calls (spec Section 5 Loading States).
- Conviction slider + "Modified" badge behavior on the stress-test panel.
- The blocking red stop-breach banner, and the <40-character override rejection.
- "WATCHING" badge visual weight vs. a full opportunity card.
- The OpenRouter-failure copy: "Jarvis is thinking… Taking longer than usual. [Retry]".
- The full multi-step flow end to end: thesis → stress test → plan lock → entry → trim →
  stop-exit → journal. This needs real LLM calls and real market data; the database is
  currently empty.
