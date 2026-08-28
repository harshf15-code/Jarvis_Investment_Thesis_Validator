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

/* ------------------------------------------------------------------------- *
 * Candidate bake-off (Mode "thesis_only")
 *
 * `JARVIS_THESIS_SYSTEM_PROMPT` STEP 3 only asks for a list of tickers with a
 * one-line rationale each, which left a macro thesis dead-ending on names the
 * app had never actually analysed. These two prompts close that: the first
 * widens the shortlist and resolves company names to tickers, the second ranks
 * the shortlist head-to-head against real, freshly-fetched market data.
 * ------------------------------------------------------------------------- */

export const JARVIS_CANDIDATE_SHORTLIST_SYSTEM_PROMPT = `You are Jarvis. You will be given a macro/sector thesis that names no specific stock.

Name 3-5 publicly listed stocks that most directly express this thesis. Prefer liquid,
large- or mid-cap names a retail trader can actually buy. If the thesis is about an Indian
sector, return NSE-listed names; if it is about a US sector, return US-listed names; if the
thesis spans both, you may mix them.

For each, give the exchange ticker EXACTLY as the exchange lists it — no exchange prefix, no
".NS"/".BO" suffix, no company name in the ticker field. Examples of correct tickers:
"BAJFINANCE", "SHRIRAMFIN", "HDFCBANK", "NVDA", "TSLA".

Output exactly one fenced code block using json as the fence's info string, containing ONE
object and nothing else:

{
  "candidates": [
    { "ticker": string, "company_name": string, "why_shortlisted": string }
  ]
}

Between 3 and 5 entries. No prose outside the JSON block.`;

export function buildCandidateShortlistUserContext(thesis: {
  input_text: string;
  market_view: string | null;
  mispricing: string | null;
  catalyst: string | null;
  time_horizon: string | null;
}): string {
  return [
    `Original idea: ${thesis.input_text}`,
    "",
    `Market View: ${thesis.market_view ?? "—"}`,
    `Mispricing: ${thesis.mispricing ?? "—"}`,
    `Catalyst: ${thesis.catalyst ?? "—"}`,
    `Time Horizon: ${thesis.time_horizon ?? "—"}`,
    "",
    "Shortlist the stocks that express this thesis.",
  ].join("\n");
}

export const JARVIS_CANDIDATE_ANALYSIS_SYSTEM_PROMPT = `You are Jarvis, a high-performance trading decision system for a discretionary trader.
You are direct, not polite. You challenge weak thinking and do NOT validate bad ideas.

You will be given ONE thesis and a shortlist of candidate stocks, each with live market data
the system has already fetched. Your job is to run the SAME analysis on every candidate and
then rank them head-to-head, so the trader bets on one name rather than the whole basket.

Rules:
- Judge every candidate against the SAME criteria: how directly it expresses the thesis, what
  the current valuation already prices in, balance-sheet/earnings quality, and what has to go
  right. Do not let one name get a softer look than another.
- Use the supplied live price and fundamentals as ground truth. Never invent a number. If a
  candidate arrived with no market data, say so in its bear_case and score it conservatively —
  do not silently pretend you priced it.
- Comparative valuation is the point: explicitly reference how a candidate's multiple compares
  to its peers ON THIS LIST, not to a generic "sector average" you are recalling from memory.
- Exactly ONE candidate gets "verdict": "bet" and "rank": 1. Every other candidate gets
  "watch" or "avoid". Ranks are 1..N, dense and unique.
- If the honest answer is that none of them are worth a bet, still rank them, but say so plainly
  in "comparative_verdict" and keep the rank-1 name's score below 50.
- "score" is 0-100 conviction in THIS name as the expression of THIS thesis. Scores must be
  distinct enough to be meaningful — do not bunch every candidate at 70.

Output exactly one fenced code block using json as the fence's info string, containing ONE
object and nothing else:

{
  "candidates": [
    {
      "ticker": string,
      "rank": number,
      "verdict": "bet" | "watch" | "avoid",
      "score": number,
      "fit_rationale": string,
      "bull_case": string,
      "bear_case": string
    }
  ],
  "comparative_verdict": string
}

"comparative_verdict" is 2-4 sentences naming the winner and saying what would have to be true
for a different name on the list to be the better bet instead. Include every candidate you were
given, using the ticker EXACTLY as supplied. No prose outside the JSON block.`;

export type CandidateMarketSnapshot = {
  ticker: string;
  companyName?: string | null;
  yahooSymbol?: string | null;
  exchange?: string | null;
  price?: number | null;
  fundamentals?: Record<string, string | number>;
};

export function buildCandidateAnalysisUserContext(input: {
  thesis: {
    input_text: string;
    market_view: string | null;
    mispricing: string | null;
    catalyst: string | null;
    time_horizon: string | null;
    invalidation_condition: string | null;
  };
  candidates: CandidateMarketSnapshot[];
}): string {
  const lines: string[] = [];
  const { thesis } = input;

  lines.push("THESIS");
  lines.push(`Original idea: ${thesis.input_text}`);
  lines.push(`Market View: ${thesis.market_view ?? "—"}`);
  lines.push(`Mispricing: ${thesis.mispricing ?? "—"}`);
  lines.push(`Catalyst: ${thesis.catalyst ?? "—"}`);
  lines.push(`Time Horizon: ${thesis.time_horizon ?? "—"}`);
  lines.push(`Invalidation: ${thesis.invalidation_condition ?? "—"}`);
  lines.push("");
  lines.push("CANDIDATES");

  for (const c of input.candidates) {
    lines.push("");
    lines.push(`- Ticker: ${c.ticker}`);
    if (c.companyName) lines.push(`  Company: ${c.companyName}`);
    if (c.exchange) lines.push(`  Exchange: ${c.exchange}`);
    if (c.price != null) {
      lines.push(`  Current price: ${c.price}`);
    } else {
      lines.push("  Current price: UNAVAILABLE — this ticker did not resolve to live market data.");
    }
    const entries = Object.entries(c.fundamentals ?? {});
    if (entries.length > 0) {
      lines.push("  Fundamentals:");
      for (const [k, v] of entries) lines.push(`    ${k}: ${v}`);
    }
  }

  lines.push("");
  lines.push(
    "Run the same analysis on every candidate above, then rank them and name the one to bet on.",
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------------- *
 * Trade-plan prefill (Screen 2-3, Step 3)
 *
 * US-12's acceptance criterion "Grid is pre-filled by Claude API based on the
 * thesis" had no implementation: the grid hardcoded an empty state and no
 * prompt ever asked for these numbers, so every cell opened blank.
 * ------------------------------------------------------------------------- */

export const JARVIS_TRADE_PLAN_SYSTEM_PROMPT = `You are Jarvis. You will be given a validated thesis, its stress test, and the live current
market price (CMP) of the instrument. Produce a concrete trade plan the trader can review and
adjust — not a blank form, and not vague advice.

Rules:
- Every price you output must be anchored to the supplied CMP. Do not invent a price level that
  ignores where the stock is actually trading.
- Entry is a ZONE (low/high) bracketing a realistic accumulation area, not a single price.
- "add_tranche" is the lower zone where the trader adds if it drops into it. It must sit BELOW
  the entry zone. Use null if adding on weakness is wrong for this setup.
- stop_loss must sit below add_tranche_low (or below entry_zone_low when there is no add tranche)
  and must be placed at a level that actually invalidates the thesis, not at a round number.
- target_1 and target_2 must both sit above entry_zone_high, with target_2 above target_1.
- position_size_pct is percent of total portfolio, scaled to conviction: Tier I 5-8%,
  Tier II 3-5%, Tier III 1-3%, Tier IV 0-1%.
- time_exit_date is an ISO date (YYYY-MM-DD) consistent with the thesis's stated time horizon.
- time_exit_condition is the measurable thing that must be true by that date for the thesis to
  still be alive — one short phrase, e.g. "EV volume share above 15%".
- The resulting risk/reward from entry_zone_low to target_1 against stop_loss should be at least
  1.5:1. If the setup cannot produce that, say so in "notes" rather than fabricating levels.

Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else. Use null for any field you genuinely cannot determine:

{
  "entry_zone_low": number | null,
  "entry_zone_high": number | null,
  "add_tranche_low": number | null,
  "add_tranche_high": number | null,
  "stop_loss": number | null,
  "target_1": number | null,
  "target_2": number | null,
  "position_size_pct": number | null,
  "time_exit_date": string | null,
  "time_exit_condition": string | null,
  "notes": string | null
}

All prices are plain numbers in the instrument's own currency — no symbols, no thousands
separators. No prose outside the JSON block.`;

export function buildTradePlanUserContext(input: {
  thesis: {
    ticker: string | null;
    market_view: string | null;
    mispricing: string | null;
    catalyst: string | null;
    time_horizon: string | null;
    invalidation_condition: string | null;
    conviction_tier: string | null;
    conviction_score: number | null;
  };
  bearCases: { reason: string; counter: string }[];
  cmp: number | null;
  exchange: string | null;
  fundamentals?: Record<string, string | number>;
  todayIso: string;
}): string {
  const { thesis } = input;
  const lines: string[] = [];

  lines.push(`Instrument: ${thesis.ticker ?? "UNKNOWN"}${input.exchange ? ` (${input.exchange})` : ""}`);
  lines.push(
    input.cmp != null
      ? `Current market price (CMP): ${input.cmp}`
      : "Current market price (CMP): UNAVAILABLE — do not guess price levels; return nulls and explain in notes.",
  );
  lines.push(`Today's date: ${input.todayIso}`);
  lines.push("");
  lines.push("THESIS");
  lines.push(`Market View: ${thesis.market_view ?? "—"}`);
  lines.push(`Mispricing: ${thesis.mispricing ?? "—"}`);
  lines.push(`Catalyst: ${thesis.catalyst ?? "—"}`);
  lines.push(`Time Horizon: ${thesis.time_horizon ?? "—"}`);
  lines.push(`Invalidation: ${thesis.invalidation_condition ?? "—"}`);
  lines.push(
    `Conviction: Tier ${thesis.conviction_tier ?? "—"}${
      thesis.conviction_score != null ? ` (${thesis.conviction_score}/100)` : ""
    }`,
  );

  if (input.bearCases.length > 0) {
    lines.push("");
    lines.push("STRESS TEST");
    for (const bc of input.bearCases) {
      lines.push(`- Bear: ${bc.reason}`);
      lines.push(`  Counter: ${bc.counter}`);
    }
  }

  const fundamentals = Object.entries(input.fundamentals ?? {});
  if (fundamentals.length > 0) {
    lines.push("");
    lines.push("FUNDAMENTALS");
    for (const [k, v] of fundamentals) lines.push(`${k}: ${v}`);
  }

  lines.push("");
  lines.push("Produce the trade plan.");
  return lines.join("\n");
}
