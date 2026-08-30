# PRD: Investment Council

**Status:** Draft for review
**Author:** Drafted with Claude, from a conversation with Harsh
**Last updated:** 2026-08-30
**Related code:** `components/thesis/memorandum-view.tsx`, `lib/llm/openrouter.ts`, `lib/jarvis-memorandum.ts`, `components/layout/nav-items.ts`

**Revision note (2026-08-30):** Council size changed from "up to 3 members" to a roster of up to 7 members, with a minimum of 3 selected required to run a consult. This affects the roster cap in Settings, the picker's min/max, the model-call cost formula (now N+1 instead of a fixed 4), and several acceptance criteria and open questions below.

---

## Problem Statement

Every Jarvis memorandum today is a single model's take, produced by one comparative call and shown with total confidence — one winner, one verdict, one trade plan. There is no built-in mechanism to pressure-test that take against a different investing philosophy before a trader commits capital. A value investor's read on a thesis, a credit-cycle skeptic's read, and a global-macro read can diverge sharply on the same facts, and right now the app only ever produces one voice.

Traders who already think in terms of "what would a disciplined value investor say about this" or "how would a macro trader poke holes in this" currently have to do that comparison themselves, outside the app, from memory. The cost of not solving this: theses get backed on the strength of a single model call with no second opinion, in a product whose entire premise (per its own README) is that a hunch needs stress-testing before it becomes a position.

## Goals

1. **Give every memorandum an on-demand second (third, fourth...) opinion** from a panel of 3 to 7 distinct, configurable investing personas, without leaving the thesis screen.
2. **Surface disagreement, not just consensus** — a trader should be able to see where the personas diverge, not just read a blended summary that hides it.
3. **Keep the feature strictly additive** — running a Council never blocks, delays, or replaces the existing thesis → memorandum flow; it is optional and triggered explicitly.
4. **Fit the app's existing engineering discipline** — one OpenRouter model (`lib/llm/openrouter.ts`), Zod-validated structured output, per-user Postgres RLS — rather than introducing a second AI stack or a new data-isolation model.
5. **Make Council output durable** — a report, once generated, persists with the thesis and doesn't require re-spending model calls just to look at it again.

## Non-Goals (v1)

- **No retrieval pipeline over real source material.** Per the decision below, personas are grounded in the model's own trained knowledge of these investors' publicly known philosophies — not a document store of ingested blogs, letters, or books. Revisit if v1 personas feel generic or stale (see Future Considerations).
- **No multi-round adversarial debate.** v1 is independent takes + one synthesis pass, not a back-and-forth where members rebut each other. A real debate loop is a distinct, more expensive feature (see Future Considerations).
- **No streaming/live reveal of the debate as it happens.** v1 shows a single loading state, then the finished report — like the existing memorandum run. Progressive reveal is a P1 polish item, not required to ship.
- **No export or sharing of a Council report** (PDF, email, link) — out of scope until the core loop is validated.
- **No global/admin-curated roster.** Every user manages their own roster from Settings; there is no shared or cross-account persona library in v1.

## Decisions Already Made

These came out of clarifying questions before drafting, and shape everything below:

| Question | Decision |
|---|---|
| How is each persona's style grounded? | The model's own trained knowledge — the system prompt names the persona and describes their philosophy; no user-supplied source documents, no RAG. |
| How much real "debate" happens? | None — three independent reviews run in parallel, then one synthesis call combines them. ~4 model calls per consult. |
| Where does output live? | A 5th tab on the existing memorandum (`components/thesis/memorandum-view.tsx`), persisted in Postgres alongside the memorandum. |
| How is the council chosen? | Settings manages the *roster* (up to 7 members total); which members to consult is chosen in a picker at the moment the trader clicks "Consult" — a minimum of 3 selected is required to run, up to the full roster. |

## User Stories

- As a trader, I want to click **"Consult Investment Council"** next to the memorandum title, so I can get outside perspectives on this specific thesis without leaving the page.
- As a trader, I want to pick members from my roster at consult time — at least 3, up to my full roster of up to 7 — so I can match the council to the thesis (e.g., a value read for a cheap-and-hated stock, a macro read for a rates thesis, or a wider panel when I want more range).
- As a trader, I want to build out a roster of up to 7 members, so I have enough range of perspectives on hand to pick a meaningful subset for any given thesis rather than being stuck with the same 3 every time.
- As a trader, I want each member's opinion shown as its own card — verdict, reasoning, the risk they'd flag — so I can see where they agree and where they don't, rather than one blended paragraph.
- As a trader, I want a single **combined council recommendation** at the top of the tab, so I get an actionable summary without reading all three in full every time.
- As a trader, I want to define a **custom council member** (name + a short description of their philosophy) from Settings, so I'm not limited to the built-in three.
- As a trader, I want my roster (built-in members plus any custom ones I've added) managed in one place in Settings, so adding or editing a member doesn't require touching an in-progress thesis.
- As a trader, I want the Council tab to **persist** once generated, so revisiting the thesis later doesn't force a re-run (and a re-charge to the model API).
- As a trader, I want to **re-run** the Council explicitly (e.g., after the underlying memorandum changes), so I'm not stuck with a stale report and not surprised by a silent auto-rerun either.
- As a new user, I want the three well-known personas pre-populated in my roster, so I can try the feature with zero setup.
- As a trader, I want it unmistakable that a persona's opinion is an AI simulation, not that person's real view, so I don't misread a stylistic imitation as an endorsement.

## Requirements

### Must-Have (P0)

**1. Settings page and nav entry**
- New route (e.g. `/settings`), new entry in `components/layout/nav-items.ts` (gear icon), shown in both the icon rail and mobile nav bar — the app currently has no Settings surface at all.
- Contains an "Investment Council" section: a roster list showing the 3 built-in personas (Warren Buffett, Howard Marks, Stanley Druckenmiller) and any custom members the user has added, **capped at 7 members total** (built-in + custom combined).
- Acceptance criteria:
  - [ ] Settings appears in the nav for every authenticated user and is reachable in one click from anywhere in the app.
  - [ ] Built-in personas are present by default for every account with zero configuration.
  - [ ] A user can add a custom member by supplying a name and a short (2–4 sentence) description of their investing philosophy/style — this description is what grounds the system prompt, since an arbitrary name alone gives the model nothing to imitate.
  - [ ] With the 3 built-ins present, a user can add up to 4 custom members before hitting the 7-member cap; the "Add member" action is disabled (with an explanation) once the roster is full.
  - [ ] A user can edit or delete a custom member. Built-in members cannot be deleted (open question below covers whether they can be hidden to free up a roster slot).

**2. "Consult Investment Council" entry point**
- A button placed next to the memorandum's title (`memo.header.title` in `memorandum-view.tsx`), enabled once a memorandum exists for the current market.
- Clicking it opens a lightweight picker over the current roster, letting the trader choose members for this run — **a minimum of 3, up to the full roster (max 7)** — then confirms and triggers the consult.
- Acceptance criteria:
  - [ ] Button is not shown (or is disabled with a tooltip) before a memorandum has been generated.
  - [ ] Picker enforces a minimum of 3 selections and a maximum equal to however many members exist in the roster (up to 7); the confirm action stays disabled below the minimum and shows how many more are needed.
  - [ ] If the roster has fewer than 3 members total, the picker explains that at least 3 are needed to run a consult and links to Settings to add more, rather than silently blocking with no explanation.
  - [ ] Confirms the selection count to the trader before running (e.g., "Consulting 5 members…").
  - [ ] Starting a consult shows a loading state consistent with the app's existing tone (cf. "Jarvis is comparing the field…") — something like "The Council is deliberating…".

**3. Backend: council consult pipeline**
- New route handler, e.g. `POST /api/theses/[id]/council?market=...`, mirroring the shape of `app/api/theses/[id]/memorandum/route.ts`.
- Reuses the memorandum and comparative-grid data **already fetched and stored** for this thesis/market — no new live market-data calls per persona. Each persona sees the same thesis document, candidate grid, and current verdict.
- For each selected member (3 to 7 of them), one independent model call (via the existing `jarvisModel` / `OPENROUTER_MODEL_ID` from `lib/llm/openrouter.ts` — no new provider, no new API key) with a system prompt built from that persona's name + description, asking for a structured opinion.
- One further model call synthesizes the combined recommendation from all the structured opinions that came back: a combined verdict, and explicit notes on where the members agreed or diverged.
- All model output is Zod-validated against a new schema, following the existing pattern in `lib/jarvis-memorandum.ts` (nullable fields with `.catch(null)`, trailing fenced-JSON extraction, thin sections degrade individually rather than failing the whole report).
- Acceptance criteria:
  - [ ] A consult costs **N + 1** model calls, where N is the number of selected members (3–7) — a 3-member consult costs 4 calls, a 7-member consult costs 8. Cost and latency scale with N; the independent calls run in parallel so wall-clock time stays roughly flat, but token/API spend does not (relevant since this app already bills LLM calls to the trader's own `OPENROUTER_API_KEY` per the README).
  - [ ] If one member's call fails or fails validation, that member's card shows a visible, specific error (mirroring the app's "never silently null" rule) while the other members' opinions and the synthesis (computed from whichever opinions succeeded) still render — this matters more at N=7 than N=3, since the odds of at least one failure rise with panel size.
  - [ ] No new external API, model provider, or secret is introduced.

**4. Persistence**
- New table(s) (e.g. `thesis_council_reports`, or an opinions table plus a report table) keyed by `thesis_id` + `market` + `user_id`.
- Follows the exact RLS pattern used everywhere else in this schema: `user_id` defaulting to `auth.uid()`, an index on `user_id`, and an `owner_all` policy scoped to `auth.uid() = user_id` (see `supabase/migrations/0013_user_accounts.sql` for the template every other table uses).
- Acceptance criteria:
  - [ ] A Council report survives a page refresh and a new login session without re-running.
  - [ ] Re-running the Council for the same thesis/market replaces the prior report atomically (same "one validated JSONB blob, replaced whole" discipline as `thesis_memorandums.document`), rather than appending duplicates.

**5. Council tab in the memorandum UI**
- A 5th tab alongside Thesis / Stress Test / Trade Plan / Exit in `memorandum-view.tsx`, shown only once a report exists (or showing an empty "not yet consulted" state with the same consult button, for discoverability).
- Layout: the combined verdict at the top, followed by one card per member (name, verdict badge — reusing the existing `VerdictEnum`/badge styling from `conviction-badge.tsx` and the comparative grid for visual consistency — reasoning, and the single biggest risk that member flags).
- Acceptance criteria:
  - [ ] Tab only appears/activates once at least one Council report exists for the current market.
  - [ ] Visual language (typography, verdict colors, spacing) matches the other four tabs rather than introducing a new style.
  - [ ] Layout holds up for anywhere from 3 to 7 member cards without breaking — e.g. a responsive/wrapping grid or scrollable list, not a fixed 3-column layout that assumes the old cap.

**6. Mandatory disclaimer**
- Every surface where a persona's name and opinion appear (the tab, the picker, the Settings roster) carries a visible line making clear this is an AI simulation: e.g. *"AI-simulated persona based on publicly known investing philosophy — not the real person's opinion, and not affiliated with or endorsed by them."*
- Acceptance criteria:
  - [ ] The disclaimer is visible without requiring a hover, click, or scroll to reveal it — consistent with the app's existing decision-support disclaimer on `/` and in the README, not just buried in a tooltip.

### Nice-to-Have (P1)

- Progressive/streaming reveal of each member's opinion as it completes, instead of one combined spinner.
- A small visual distinguisher per persona (icon, initial, or accent color) so the three cards are scannable at a glance.
- Surfacing which market's data the Council saw, for multi-market theses (mirroring the existing market strip in the memorandum view).
- Remembering the last-used roster selection as the picker's default for the next consult (still requires confirmation — not a silent default).

### Future Considerations (P2)

- **Grounding personas in real source material** (a persona's actual essays, letters, interviews) via retrieval — deliberately deferred in this version; the schema for a persona (name + description) should not preclude adding an optional `knowledge_sources` field later without a breaking migration.
- **Multi-round debate** where members see and rebut each other's initial takes before a final synthesis.
- **Exporting or sharing** a Council report (PDF, email digest, link).
- Letting a custom persona be defined from an uploaded document rather than a hand-written description.

## Success Metrics

**Leading indicators** (evaluate at 2 and 4 weeks post-launch):
- **Consult adoption**: % of memoranda that get at least one Council consult within 7 days of the memorandum being generated. Target: 25% at 30 days (no prior baseline — first feature of this kind).
- **Consult completion rate**: of consults started, % that render a full report without a pipeline failure. Target: ≥95%, given the pipeline (4 to 8 calls depending on panel size) has more failure surface than the existing single memorandum call — and that surface grows with larger panels, so this is worth tracking by panel size, not just in aggregate.
- **Picker abandonment**: % of times the picker is opened but no consult is confirmed. High abandonment would suggest the roster/picker UX needs work.

**Lagging indicators** (evaluate at 8–12 weeks):
- **Repeat usage**: % of users who run a Council consult on more than one thesis in a month (signals the feature earns a second use, not just curiosity).
- **Correlation with conviction**: whether theses with a Council report are more or less likely to be backed as a trade (`trade_plans`) than theses without one — directional signal only, not causal.

**Open dependency**: this codebase has no analytics tool wired in today (no Amplitude/Mixpanel instrumentation found in the repo). Instrumenting the above will need its own scoping — see Open Questions.

## Open Questions

- **[legal]** Simulating investment opinions in the voice of named, living public figures (Stanley Druckenmiller is alive and active; Howard Marks is alive and publishes frequently) carries real reputational and potential right-of-publicity risk — more so once sign-up is open to anyone, per the README. Should the shipped defaults use the real names, or fictionalized archetypes ("The Value Investor," "The Credit-Cycle Skeptic," "The Global Macro Trader") with the real name as an optional, user-chosen relabeling? **This should be resolved before the built-in roster ships**, not treated as a launch-day detail.
- **[product]** Is a name + short written description enough to define a custom member, or should the trader also be able to paste a couple of example quotes inline (still no retrieval — just more text in the same system prompt) to steer tone further?
- **[product]** Now that the roster caps at 7 total, can a built-in member be hidden or removed to free up a slot for a custom one, or are all three built-ins permanently reserved (capping custom members at 4)?
- **[product]** Should the picker warn about cost/latency before confirming a large panel (e.g., 6–7 members, up to 8 model calls) versus a minimum 3-member consult, since spend scales with panel size and is billed to the trader's own OpenRouter key?
- **[engineering]** `memorandum-view.tsx` currently renders its four tabs from a fixed local `TABS` array with a hardcoded switch. Adding a 5th, conditionally-available tab needs a small refactor to support a tab that doesn't exist until a report is generated — should be scoped before implementation starts.
- **[engineering]** Should starting a Council consult be blocked while the underlying memorandum itself is mid-run (re-generating), to avoid the Council critiquing a memo that's about to change under it?
- **[data]** Confirm whether instrumenting the success metrics above is in scope for this release, or explicitly deferred (no analytics tool is currently connected to this project).

## Timeline Considerations

- No hard external deadline.
- Suggested phasing:
  - **Phase 1 (this PRD's P0 scope):** Settings + roster CRUD, consult picker, the 4-call backend pipeline, persisted Council tab, mandatory disclaimer.
  - **Phase 2 (P1):** UX polish — streaming reveal, per-persona visual identity, multi-market awareness, remembered roster selection.
  - **Phase 3 (P2):** Real source-grounded personas, multi-round debate, export/sharing — each substantial enough to warrant its own PRD rather than folding into this one.
- **Blocking dependency:** the [legal] open question on using real public figures' names should be settled before Phase 1's default roster ships, since it changes what's in `Settings > Investment Council` on day one.
