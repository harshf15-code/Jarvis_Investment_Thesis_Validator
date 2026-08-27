# Jarvis Decision Cockpit — User Stories v2.0
### For Claude Code Implementation
**Stitch Visual Reference:** Project ID `5066478431085256622` · 11 screens  
**Target:** Redesign existing localhost web app UI + add new features  
**Date:** August 2026

---

## 1. PRODUCT CONTEXT & CONSTRAINTS

### What exists
A web app already runs on `localhost`. The backend logic works. **The task is:**
1. Redesign the UI to match the Stitch screens (visual reference only — not pixel-perfect)
2. Add new features described in this document
3. Keep all existing backend routes and data structures intact unless explicitly noted

### What does NOT exist in this app
- **No broker integration.** The word "Execute" means "I bought this, log it." The user enters their own average price.
- **No real-time price streaming.** Prices are fetched on page load or manual refresh.
- **No multi-user support.** Single-user, local, personal tool.

### Design language (from prior artefacts — enforce across all screens)
- **Background:** `#080808` (near-black)
- **Primary font:** DM Mono (body/data) + Syne (headings/labels)
- **Accent colour:** `#E8B339` (amber-gold) for CTAs, active states, labels
- **Status colours:** `#f87171` red (stop/danger) · `#4ade80` green (gain/confirm) · `#60a5fa` blue (watch/info)
- **Currency format:** ₹ prefix + Indian formatting (`2,84,836` not `284836`)
- **No white background screens.** No card shadows on white. Dark terminal feel throughout.

---

## 2. THESIS INPUT — HOW IT MUST WORK (Critical)

The thesis input is the heart of the app. It must behave exactly like chatting with Jarvis on Claude. **Three valid input modes — all must be accepted, none are errors:**

| Mode | Example Input | What Jarvis Does |
|---|---|---|
| **Stock only** | `BAJAJ-AUTO` or `Bajaj Auto` | Fetches context, generates full Jarvis thesis for the stock |
| **Thesis only** | `I think Indian IT is bottoming due to AI tailwinds` | Structures thesis, then suggests 2–3 stocks that fit |
| **Stock + Thesis** | `Bajaj Auto — EV buyback at 26x looks cheap vs TVS at 56x` | Validates, stress-tests, and structures the thesis |

**Rules:**
- Single free-text input field. No dropdowns. No "select a sector" before you type.
- The AI (Claude API) infers the mode from the input and handles it.
- If Mode 2 (thesis only) → after generating the structured thesis, the system shows a stock suggestion panel: "Jarvis sees 2–3 names that fit this thesis. Select one to build a trade plan." The user can dismiss this and keep the thesis ticker-free.
- A thesis without a stock is valid and can be saved. It shows up in the feed as a **Macro Thesis** (not in Active Positions).

---

## 3. DATA MODEL (key entities — implement as-is)

```
Thesis {
  id: uuid
  created_at: datetime
  input_text: string           // raw user input, exactly as typed
  mode: 'stock_only' | 'thesis_only' | 'stock_plus_thesis'
  ticker: string | null        // null if Mode 2 with no stock selected
  market_view: string
  mispricing: string
  catalyst: string
  time_horizon: string
  invalidation_condition: string
  conviction_tier: 'I' | 'II' | 'III' | 'IV'
  conviction_score: number     // 0–100
  status: 'draft' | 'active' | 'closed' | 'macro'
}

TradePlan {
  id: uuid
  thesis_id: uuid (FK)
  entry_zone_low: number
  entry_zone_high: number
  add_tranche_low: number
  add_tranche_high: number
  stop_loss: number
  target_1: number
  target_2: number
  position_size_pct: number    // % of portfolio for this trade
  max_portfolio_pct: number    // max if adding T2
  time_exit_date: date
  time_exit_condition: string  // e.g. "Chetak share < 15%"
  risk_reward: number          // auto-calculated
  created_at: datetime
}

Position {
  id: uuid
  thesis_id: uuid (FK)
  trade_plan_id: uuid (FK)
  ticker: string
  entries: Entry[]             // multiple buy entries, weighted avg auto-calculated
  current_price: number        // fetched on page load
  status: 'active' | 'partial_exit' | 'closed'
  exits: Exit[]
  created_at: datetime
}

Entry {
  id: uuid
  position_id: uuid (FK)
  date: date
  quantity: number
  price: number               // user-entered average buy price for this tranche
  tranche: 'T1' | 'T2' | 'add'
  notes: string | null
}

Exit {
  id: uuid
  position_id: uuid (FK)
  date: date
  quantity: number
  price: number
  type: 'trim_t1' | 'trim_t2' | 'stop_hit' | 'time_exit' | 'manual'
  reason: string
  override: boolean           // true if user overrode a Jarvis rule
  override_reason: string | null
}

// ─── NEW ─────────────────────────────────────────────────────────────
JarvisRecommendation {
  id: uuid
  thesis_id: uuid (FK)
  trade_plan_id: uuid (FK) | null
  ticker: string
  recommended_at: datetime
  recommended_entry_low: number
  recommended_entry_high: number
  recommended_stop: number
  recommended_target_1: number
  recommended_target_2: number
  conviction_tier: 'I' | 'II' | 'III' | 'IV'
  price_at_recommendation: number  // CMP when Jarvis generated the rec
  current_price: number            // fetched on page load
  pct_change: number               // auto-calculated
  status: 'open' | 't1_hit' | 't2_hit' | 'stop_hit' | 'time_expired'
  converted_to_position: boolean
  position_id: uuid | null         // linked if user acted on it
  thesis_summary: string           // 2-sentence summary for display
}

TradeJournalEntry {
  id: uuid
  position_id: uuid (FK)
  ticker: string
  entry_dates: date[]
  exit_dates: date[]
  pnl_rupees: number
  pnl_pct: number
  thesis_outcome: 'confirmed' | 'partially_confirmed' | 'invalidated'
  conviction_tier_used: 'I' | 'II' | 'III' | 'IV'
  entry_quality: number           // 1–5
  sizing_quality: number          // 1–5
  stop_management: number         // 1–5
  exit_quality: number            // 1–5
  discipline_score: number        // 1–5
  what_went_right: string
  what_went_wrong: string
  lessons: string
  jarvis_verdict: string          // AI-generated 2-sentence post-mortem
  created_at: datetime
}
```

---

## 4. SCREEN-BY-SCREEN USER STORIES

---

### SCREEN HUB-1: Velocity Cockpit (Dashboard)
**Stitch Reference:** "Jarvis Velocity Cockpit" — `7adc00ee720c495aafcfac8509638e15`

#### Purpose
Single-screen mission-control view. First thing the user sees on app load. Must give a complete situational picture in under 30 seconds.

#### User Stories

**US-01** — As a Jarvis user, I want to see my full portfolio state (P&L, positions, alerts) on one screen so I can start my trading session with context.

**Acceptance Criteria:**
- [ ] On load, shows: portfolio P&L (today / week / MTD), count of active positions, count of pending Jarvis recommendations not yet acted on, and any alerts
- [ ] P&L numbers are computed from `Position.entries` weighted average vs current price
- [ ] If a position's current price is within 3% of its stop-loss, a RED pill appears in the alert rail
- [ ] If a thesis-test date has passed (today > time_exit_date), an AMBER chip appears: "⏱ Thesis Test Overdue — [TICKER]"
- [ ] Clicking any position card navigates to the Active Positions & Exit screen for that position
- [ ] A "New Thesis" FAB (+) is permanently visible and opens the Thesis Input screen

**US-02** — As a Jarvis user, I want to see a summary of the Jarvis Recommendation Tracker so I can quickly see how Jarvis's unacted-on calls have performed.

**Acceptance Criteria:**
- [ ] A widget shows: total recommendations (all time), count where T1 was hit before stop (wins), count where stop was hit first (losses), and win rate %
- [ ] The widget links to the full Recommendation Tracker screen
- [ ] Only recommendations NOT converted to actual positions are included in this tally (to avoid double-counting)

---

### SCREEN HUB-2: Active Positions & Exit Discipline
**Stitch Reference:** "Active Positions & Exit Discipline" — `51b369b649c24c3bb4682cfb7f8a553f`

#### Purpose
Position manager. Shows all active positions with their real P&L vs the trade plan. Enforces exit discipline.

#### User Stories

**US-03** — As a Jarvis user, I want to see all my active positions ranked by urgency (nearest stop first) so I can focus on the most critical names first.

**Acceptance Criteria:**
- [ ] Default sort: distance to stop (ascending — nearest stop first)
- [ ] Each row shows: Ticker, Avg Entry Price, CMP, Return %, Distance to Stop (₹ and %), T1 hit status, T2 hit status, Conviction Tier badge, Thesis Health (RAG dot), Days to time-exit
- [ ] A 52-week range mini-bar is visible per row (same amber-dot style as previous artefacts)
- [ ] Rows are sortable by: Return % / Distance to Stop / Thesis Date

**US-04** — As a Jarvis user, I want trim and exit prompts to appear automatically at my pre-set levels so the rules enforce themselves without relying on my memory.

**Acceptance Criteria:**
- [ ] When CMP ≥ T1: a non-blocking AMBER toast appears: "T1 Hit — Trim 40%? [Confirm] [Dismiss]". Confirming opens the Log Partial Exit modal.
- [ ] When CMP ≤ Stop: a blocking RED banner appears at the top of the screen: "Stop Hit — [TICKER] at ₹X. Exit required. [Exit Now] [Override — I'm breaking the rules]"
- [ ] Override path: requires typing a reason of minimum 40 characters before it accepts. The override is logged in the journal with a `discipline_break: true` flag.
- [ ] When today > time_exit_date: an AMBER prompt appears with the time-exit condition text from the trade plan

**US-05** — As a Jarvis user, I want to add a second tranche buy to an existing position by entering my new average price so the system recalculates my blended average entry.

**Acceptance Criteria:**
- [ ] "Add Entry" button on each position row opens a modal: Date, Quantity, Price Paid, Tranche label (T1/T2/Add)
- [ ] On save, system recalculates weighted average entry across all entries: `sum(qty × price) / sum(qty)`
- [ ] The position card immediately updates with new avg entry and new P&L

---

### SCREEN HUB-3: Stress Test & Trade Plan
**Stitch Reference:** "Stress Test & Trade Plan" — `4572ef325ed24101a81b546bf168cbb0`

#### Purpose
Research workspace. Side-by-side view of thesis stress test and trade plan. Can be accessed for any active thesis, including those without positions.

#### User Stories

**US-06** — As a Jarvis user, I want to view the full Jarvis analysis (stress test + trade plan) for any thesis in a structured two-panel layout so I can review assumptions without re-running the AI.

**Acceptance Criteria:**
- [ ] Left panel: Thesis block (6 fields) + 4 bear cases with counters
- [ ] Right panel: 9-cell trade plan grid (CMP / Entry Zone / Add Tranche / Stop / T1 / T2 / Size / Horizon / Time Exit)
- [ ] Risk/Reward and Max Drawdown recalculate instantly when Stop or Target is edited
- [ ] Conviction score bar is visible (0–100 gradient fill)
- [ ] "Re-run AI Analysis" button with last-run timestamp

**US-07** — As a Jarvis user, I want to edit any field of the trade plan and have my edits saved immediately so I can refine the plan without re-entering it from scratch.

**Acceptance Criteria:**
- [ ] All trade plan cells are editable inline (not read-only)
- [ ] On blur of any field, auto-save triggers (no explicit Save button required)
- [ ] Edited fields show a subtle amber underline to indicate they differ from AI's original suggestion
- [ ] A "Reset to AI suggestion" link appears on hover of any edited field

---

### SCREEN HUB-4: Jarvis Intelligence Feed
**Stitch Reference:** "Jarvis Intelligence Feed" — `765c3e8eb5834781aaf9b37d79423851`

#### Purpose
Curated feed of thesis-relevant signals. Not a news aggregator — only items that affect held positions or watchlisted theses.

#### User Stories

**US-08** — As a Jarvis user, I want a prioritised feed that surfaces thesis-breaking or thesis-confirming signals for my open positions before general market news.

**Acceptance Criteria:**
- [ ] Feed items sorted: RED (stop/thesis-break) → AMBER (thesis test due / partial confirm) → BLUE (general signal) → GREY (background)
- [ ] Each card shows: priority colour pill, ticker tag, theme tag, one-line headline, timestamp, and "Link to Thesis" button
- [ ] "Link to Thesis" opens a slide-out drawer showing the relevant thesis section with this signal highlighted as supporting or contrary evidence
- [ ] "Today's Agenda" sidebar: upcoming thesis-test dates for the next 14 days, ordered chronologically
- [ ] Feed items can be archived (moves to "Reviewed" tab with timestamp)

---

### SCREEN 1: Idea → Structured Thesis
**Stitch Reference:** "1. Idea -> Structured Thesis" — `969c3fc7354f4cf992afe229e5892561`

#### Purpose
The entry point for ALL new theses. Must feel like typing to Jarvis. No forms. No mandatory fields. Just a text box.

#### User Stories

**US-09** — As a Jarvis user, I want to type a raw thought — about a stock, a macro view, or both — and receive a structured Jarvis thesis within 30 seconds, without filling in any form fields.

**Acceptance Criteria:**
- [ ] Single large text input is the first and dominant element on the page. Placeholder: `Tell Jarvis your thesis. Stock name, market view, or both — however you'd say it.`
- [ ] On submit, system calls Claude API with the Jarvis prompting framework and returns the 6-field thesis
- [ ] The 6 fields render in individual editable cards: Market View / Mispricing / Catalyst / Time Horizon / Invalidation / Conviction Tier
- [ ] Conviction Tier badge is prominent: Tier I (gold) / Tier II (amber) / Tier III (blue) / Tier IV (grey)
- [ ] The input mode is auto-detected:
  - Stock only → thesis generated, ticker auto-populated
  - Thesis only → thesis generated, ticker field shows "No stock — Macro Thesis"
  - Stock + thesis → thesis validated and structured
- [ ] If Mode 2 (thesis only): below the structured thesis, a panel appears: "Jarvis sees these names as potential expressions of this thesis:" with 2–3 stock suggestions (each clickable → pre-populates ticker and re-runs as Mode 3)
- [ ] "Save as Draft" button: saves with `status: 'draft'`, visible in cockpit but not in Active Positions
- [ ] "Approve → Build Trade Plan" button: saves and navigates to Screen 2–3

**US-10** — As a Jarvis user, I want to be warned if a thesis already exists for a stock I'm entering so I don't create duplicates.

**Acceptance Criteria:**
- [ ] When the ticker field is populated (manually or auto-detected), the system checks for existing theses for that ticker
- [ ] If found: a banner appears: "Existing thesis found for [TICKER] (status: Active, Jun 2026). [View existing] [Create new anyway]"
- [ ] This is a warning, not a block. User can proceed.

---

### SCREEN 2–3: Validation & Plan
**Stitch Reference:** "2-3. Validation & Plan" — `d2c0507c7a804ae7bc7b87df4ce378d3`

#### Purpose
Two-step wizard after thesis is approved. Step 2 = stress test review. Step 3 = trade plan construction. One screen, two states.

#### User Stories

**US-11** — As a Jarvis user, I want to review the AI-generated stress test (4 bear cases + counters) before building a trade plan so I can challenge my own conviction before committing.

**Acceptance Criteria:**
- [ ] Step 2 layout: 2-column. Left column = Bear Cases (red-bordered cards). Right column = Counters (green-bordered cards). Each pair is horizontally aligned.
- [ ] Bear cases are generated by Claude API using the Jarvis stress-test prompt
- [ ] User can edit any bear case counter-argument inline. Edited counters show AMBER "Modified" badge.
- [ ] Conviction score bar (0–100) updates as user modifies counter-arguments
- [ ] "Step 2 of 3" progress indicator visible at top
- [ ] "Stress Test Approved → Build Trade Plan" advances to Step 3

**US-12** — As a Jarvis user, I want to build a trade plan in a structured 9-cell grid pre-filled by Jarvis so I only need to review and adjust rather than fill in from scratch.

**Acceptance Criteria:**
- [ ] Step 3 layout: the 9-cell grid (3 rows × 3 columns) — CMP (read-only, fetched) / Entry Zone / Add Tranche / Stop Loss / Target 1 / Target 2 / Position Size / Time Horizon / Time Exit
- [ ] Grid is pre-filled by Claude API based on the thesis
- [ ] Stop Loss field is **required** — "Lock Plan" button is disabled until stop is set
- [ ] Changing Stop or Target immediately recalculates: Risk/Reward ratio, Max Drawdown %, Cash at Risk given Position Size
- [ ] Time Exit field: date picker + condition text field (e.g., "Chetak share < 15%")
- [ ] "Lock & Save Plan" saves `TradePlan` + creates `JarvisRecommendation` record automatically (see below)
- [ ] Saving the plan auto-creates a `JarvisRecommendation` entry with `price_at_recommendation = current CMP` and `converted_to_position = false`

---

### SCREEN 4: Manual Execution Trigger
**Stitch Reference:** "4. Manual Execution Trigger" — `d2215147eac4400590998ee9f8904cea`

#### Purpose
Where the user logs their actual purchase. No broker API. The user has already bought with their broker; they're entering the price they paid.

#### User Stories

**US-13** — As a Jarvis user, I want to log that I bought a stock by entering my actual average purchase price so the system can track my real P&L from my real entry.

**Acceptance Criteria:**
- [ ] The screen shows: the trade plan summary (Entry Zone / Stop / T1 / T2 / Conviction Tier) for reference
- [ ] Input fields: Date of purchase, Quantity purchased, Average price paid (₹), Tranche (First buy / Second buy / Adding to position)
- [ ] If Average Price Paid is outside the Entry Zone, an AMBER warning appears: "You entered at ₹X — outside your planned zone of ₹Y–Z. Your actual risk/reward is [recalculated]. Proceeding."
  - This is a warning only, not a block.
- [ ] "Log My Buy" button: saves an `Entry` record and sets `Position.status = 'active'`
- [ ] On save: the `JarvisRecommendation.converted_to_position` is set to `true` and `position_id` is linked
- [ ] After save: user is navigated to Exit & Monitoring (Screen 5–6) for that position

**US-14** — As a Jarvis user, I want a pre-execution checklist that reminds me of the Jarvis rules before I log my buy.

**Acceptance Criteria:**
- [ ] Checklist (all checkboxes): Is entry in or near the zone? Is my stop set? Is my position size within the planned %? Is this thesis still valid (not invalidated)?
- [ ] Checklist items are visual reminders only — they do not block execution
- [ ] "Log My Buy" button is always enabled (user is an adult, not a child)

---

### SCREEN 5–6: Exit & Monitoring
**Stitch Reference:** "5-6. Exit & Monitoring" — `088515fc126540efbf7f3c7f71947d5e`

#### Purpose
Live view of one position. Thesis metrics + P&L + exit ladder. The single most important screen for maintaining discipline.

#### User Stories

**US-15** — As a Jarvis user, I want to see my position's P&L alongside its thesis health metrics (not just price) so I exit for the right reasons.

**Acceptance Criteria:**
- [ ] Left panel: position card — Ticker, Avg Entry, CMP, Return (₹ + %), Distance to Stop, Distance to T1, Distance to T2
- [ ] Right panel: 5-row exit ladder — T1 Trim (40%) / T2 Trim (40%) / Runner Hold (20%) / Stop Exit / Time Exit — each with status pill (PENDING / HIT / DONE)
- [ ] Below exit ladder: thesis metrics section — shows 3–4 key measurable thesis conditions from the trade plan (e.g., "Chetak Market Share: needs ≥18%") with editable current values
- [ ] Jarvis Warning box (amber-bordered): the exit warning text from the trade plan displayed permanently, not hidden

**US-16** — As a Jarvis user, I want to log a partial exit (trim) by entering the price I actually sold at so the system updates my remaining position and P&L.

**Acceptance Criteria:**
- [ ] "Log Trim" button on each exit ladder row (T1, T2): opens modal — Date, Quantity Sold, Price Sold At, Type (T1/T2/Manual)
- [ ] On save: creates an `Exit` record; recalculates remaining position; marks exit ladder row as HIT ✓
- [ ] Remaining position P&L updates immediately using new quantity and same weighted avg entry
- [ ] If this is the final exit (quantity goes to 0): user is prompted to write a Trade Journal entry

**US-17** — As a Jarvis user, I want to log a stop-loss exit with an optional override reason so every discipline break is recorded.

**Acceptance Criteria:**
- [ ] "Exit — Stop Hit" button: opens modal — Date, Quantity (pre-filled to full remaining), Price Sold At, Override reason (optional)
- [ ] If override reason is provided: `Exit.override = true`, `Exit.override_reason` saved, a `discipline_break` tag is added to the Journal entry
- [ ] After any full exit: user is prompted to write a Journal entry (can dismiss but dismissed is flagged)

---

### SCREEN 7: Trade Journal & Review
**Stitch Reference:** "7. Trade Journal & Review" — `ff37799904c947e39a71fe8d907127b5`

#### Purpose
Post-trade review. Captures the decision quality, not just the P&L. Feeds pattern recognition over time.

#### User Stories

**US-18** — As a Jarvis user, I want a post-trade review template that is pre-filled with the trade data so I only need to write the qualitative parts.

**Acceptance Criteria:**
- [ ] Auto-filled from position data: Ticker, Entry dates, Exit dates, Total P&L (₹ and %), Conviction Tier used, Thesis outcome (Confirmed / Partially Confirmed / Invalidated — user selects)
- [ ] 5 editable text sections: What went right / What went wrong / Was the stop correct / What would I do differently / Key lesson
- [ ] 5 star-rating widgets (1–5): Entry Quality / Sizing / Stop Management / Exit Timing / Overall Discipline
- [ ] "Jarvis Verdict" section: AI-generated 2-sentence post-mortem based on the trade data. Displayed read-only with an "Edit" option.
- [ ] Tags: auto-suggested from thesis content (e.g., "Indian EV", "Buyback Signal", "Discipline Break")
- [ ] "Save Review" saves `TradeJournalEntry`; position status becomes `closed`

**US-19** — As a Jarvis user, I want to browse and search past journal entries so I can learn from patterns across my trade history.

**Acceptance Criteria:**
- [ ] Journal archive: list view with columns — Ticker, P&L %, Thesis Outcome, Discipline Score, Date
- [ ] Filterable by: Ticker / Date range / Thesis Outcome / Discipline Score / Tags
- [ ] Clicking a row expands to full journal entry
- [ ] Aggregate stats at the top: total trades reviewed, avg discipline score, win rate, most common lesson tag

---

### SCREEN 8: Opportunity Discovery
**Stitch Reference:** "8. Opportunity Discovery" — `b71fd3e7e1884b2f814e835ed6b53725`

#### Purpose
Source of new ideas. AI-generated or manually added. Anti-FOMO by design — sorted by conviction, not by momentum or popularity.

#### User Stories

**US-20** — As a Jarvis user, I want to browse a list of potential trade ideas filtered by conviction tier, sector, and valuation position so I find undervalued, structurally interesting names rather than momentum stocks.

**Acceptance Criteria:**
- [ ] Card grid: each card shows — Ticker, Sector, Tier badge, 1-line thesis summary, PE vs sector median, 52W range position (% from low)
- [ ] Filter bar: Tier (I / II / III / IV), Sector (dropdown), Market (NSE / BSE / US), 52W Position (Near Low <20% / Mid / Near High >80%)
- [ ] Sort: Conviction Tier (default) / PE / Recency. NO "Trending" or "Popular" sort option.
- [ ] If CMP > 85% of 52W range: "Near 52W High ⚠" chip on the card (amber, non-blocking)
- [ ] If stock is already in Active Positions: "HELD" badge on card; CTA changes to "Review Thesis"
- [ ] If stock has an existing Draft thesis: "DRAFT" badge on card
- [ ] "Explore" CTA: navigates to Screen 1 (Idea → Thesis) with ticker pre-populated

**US-21** — As a Jarvis user, I want to manually add a stock to the opportunity list so I can track names I'm watching without building a full thesis yet.

**Acceptance Criteria:**
- [ ] "Add to Watchlist" button: prompts for ticker only (no thesis required)
- [ ] Watchlist items appear in the Discovery grid with a "WATCHING" badge and lower visual weight than AI-generated ideas

---

### SCREEN NEW: Jarvis Recommendation Tracker
**Stitch Reference:** None — new screen, not in Stitch project. Design to match the dark terminal aesthetic.

#### Purpose
Every time Jarvis generates a BUY recommendation (i.e., a trade plan is saved with Tier I or II), a `JarvisRecommendation` record is created automatically. This screen shows what happened to all of them — whether the user acted or not. This is Jarvis's accountability ledger.

#### User Stories

**US-22** — As a Jarvis user, I want to see every BUY recommendation Jarvis has ever made (acted on or not) with the price at the time and the current price so I can evaluate Jarvis's track record over time.

**Acceptance Criteria:**
- [ ] Table with columns: Date Recommended / Ticker / Tier / Recommended Entry Zone / Price at Rec / Current Price / % Change Since Rec / Status / Acted?
- [ ] "Acted?" column: "Yes" (links to the actual position) or "No" (shows what would have happened)
- [ ] Status auto-updates on page load: if current price ≥ T1 → "T1 Hit ✓" (green); if current price ≤ Stop → "Stop Hit ✗" (red); else → "Open" (amber)
- [ ] % Change Since Rec is calculated from `price_at_recommendation` to `current_price` and shown with green/red colour
- [ ] Rows where the user did NOT act but T1 was hit → shown with a subtle green background and a note: "Jarvis was right — you didn't take this one"
- [ ] Rows where the user did NOT act but stop was hit → shown with grey: "Missed bullet — stop would have hit"

**US-23** — As a Jarvis user, I want to see aggregate win-rate statistics for Jarvis's recommendations so I can calibrate how much to trust each conviction tier.

**Acceptance Criteria:**
- [ ] Stats strip at the top: Total Recs / T1 Hit Before Stop (wins) / Stop Hit Before T1 (losses) / Still Open / Win Rate %
- [ ] Stats broken down by tier: Tier I win rate / Tier II win rate / Tier III win rate
- [ ] Time filter: All Time / Last 6 Months / Last 12 Months
- [ ] "Hypothetical P&L" toggle: if enabled, shows what the cumulative P&L would have been if every recommendation was acted on at `price_at_recommendation` with standard Jarvis sizing

**US-24** — As a Jarvis user, I want to convert an unacted recommendation into an actual position directly from the Tracker screen.

**Acceptance Criteria:**
- [ ] "I Bought This" button on each row where `converted_to_position = false`
- [ ] Clicking opens the Manual Execution Trigger modal (Screen 4) pre-loaded with the recommendation's trade plan
- [ ] On save, `JarvisRecommendation.converted_to_position` = true, `position_id` linked

---

## 5. GLOBAL / CROSS-SCREEN REQUIREMENTS

### Navigation
- [ ] Persistent left sidebar on desktop (≥1280px) with icons + labels for: Cockpit / Active Positions / Stress Test & Plan / Intelligence Feed / Journal / Discovery / Recommendation Tracker
- [ ] Active screen highlighted in amber
- [ ] "New Thesis" button always visible in the sidebar (not buried in a menu)

### Thesis Input — Anywhere
- [ ] The "New Thesis" / "+" action must be accessible from every screen without navigating away
- [ ] Recommend: a slide-out drawer from the right that renders Screen 1 inline, so the user doesn't lose their current context

### Price Data
- [ ] Prices are fetched from the existing backend on page load and on explicit "Refresh Prices" action
- [ ] No auto-refresh / polling — user controls when prices update
- [ ] "Last updated: [timestamp]" is visible on all screens that display prices

### Empty States
- [ ] Every list/table has a meaningful empty state: "No active positions. Start with a thesis →" not just a blank page
- [ ] Empty Recommendation Tracker: "No Jarvis recommendations yet. Build a trade plan to start tracking."

### Loading States
- [ ] AI calls (thesis generation, stress test) show a skeleton loader with amber pulsing accent, not a spinner on white
- [ ] Target: < 15 seconds for any Claude API call (thesis generation with streaming preferred)

### Error Handling
- [ ] Claude API timeout: "Jarvis is thinking... Taking longer than usual. [Retry]"
- [ ] Price fetch failure: prices show as "--" with a yellow badge "Price unavailable"
- [ ] User should never see a raw error stack trace

---

## 6. STITCH SCREEN REFERENCE — HOW TO USE THEM

The Stitch screens (Project `5066478431085256622`) are **visual reference**, not pixel-perfect specifications. When handing to Claude Code:

1. Export each screen as a PNG from Stitch
2. Paste the PNG alongside this document
3. Instruct Claude Code: "Match the layout and visual hierarchy. Use the colour system from Section 1 of this document. Adapt component details to match these user stories where they differ from the Stitch design."

**Known gaps between Stitch screens and this spec:**
- Stitch does not have the Jarvis Recommendation Tracker (new — design from scratch)
- Thesis Input in Stitch may show a form — ignore that, implement as free-text per US-09
- Execute Trade in Stitch may show broker fields — replace with manual average price entry per US-13

---

## 7. IMPLEMENTATION PRIORITY (for Claude Code)

| Priority | Feature | Screens |
|---|---|---|
| P0 | Thesis Input (3 modes) | Screen 1 |
| P0 | Active Positions with manual entry | Screen HUB-2, Screen 4 |
| P0 | Jarvis Recommendation Tracker | Screen NEW |
| P1 | Stress Test & Trade Plan | Screen 2–3, HUB-3 |
| P1 | Exit & Monitoring | Screen 5–6 |
| P1 | Cockpit Dashboard | Screen HUB-1 |
| P2 | Trade Journal | Screen 7 |
| P2 | Intelligence Feed | Screen HUB-4 |
| P3 | Opportunity Discovery | Screen 8 |

---

*Document version 2.0 — August 2026*  
*Stitch Project: 5066478431085256622*  
*AI backbone: Claude Sonnet 4.6 (Anthropic API)*
