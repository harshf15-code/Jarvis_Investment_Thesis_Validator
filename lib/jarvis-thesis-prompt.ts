import { MARKETS } from "@/lib/markets";
import type { MarketCode } from "@/lib/types";

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

CRITICAL — when mode is "thesis_only", the JSON's "ticker" field MUST be null. The trader named
no stock, so there is no stock to name. Any names you have in mind belong in
"stock_suggestions". Putting one in "ticker" makes the system treat it as the trader's own
conviction and anchor the entire downstream analysis to it.

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

/* ------------------------------------------------------------------------- *
 * Candidate shortlist
 *
 * `JARVIS_THESIS_SYSTEM_PROMPT` STEP 3 only asks for a list of tickers with a
 * one-line rationale each, which left a thesis dead-ending on names the app had
 * never analysed. This widens that into a real shortlist; the head-to-head
 * itself is `lib/jarvis-memorandum.ts`, which prices every name and ranks them.
 * ------------------------------------------------------------------------- */

export const JARVIS_CANDIDATE_SHORTLIST_SYSTEM_PROMPT = `You are Jarvis. You will be given a macro/sector thesis that names no specific stock, together with ONE market to answer within.

Name 3-5 publicly listed stocks that most directly express this thesis. Prefer liquid,
large- or mid-cap names a retail trader can actually buy.

HARD CONSTRAINT — the market you are given is the entire universe. Every name must be
primarily listed on one of that market's exchanges. Do NOT name a company listed elsewhere,
however well it fits the thesis: a name the system cannot price is worse than useless,
because it cannot be compared, entered, or exited. If the best pure-play businesses for this
thesis are listed outside the market, say so in "why_shortlisted" for the closest listed
alternative and name that alternative instead — a domestic supplier, customer, licensee or
diversified parent with real exposure. Never reach outside the market to fill a slot.

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

export function buildCandidateShortlistUserContext(
  thesis: {
    input_text: string;
    market_view: string | null;
    mispricing: string | null;
    catalyst: string | null;
    time_horizon: string | null;
  },
  market: MarketCode,
  /**
   * Tickers a previous attempt returned that could not be resolved on this
   * market's exchanges. Naming them back is what makes the retry productive
   * rather than a re-roll of the same answer.
   */
  rejected?: string[],
): string {
  const meta = MARKETS[market];
  const lines = [
    `Market: ${meta.label} — listings on ${meta.exchanges.join(" or ")}, priced in ${meta.currency}.`,
    "",
    `Original idea: ${thesis.input_text}`,
    "",
    `Market View: ${thesis.market_view ?? "—"}`,
    `Mispricing: ${thesis.mispricing ?? "—"}`,
    `Catalyst: ${thesis.catalyst ?? "—"}`,
    `Time Horizon: ${thesis.time_horizon ?? "—"}`,
    "",
  ];

  if (rejected?.length) {
    lines.push(
      `A previous attempt returned these, and NONE could be priced on ${meta.exchanges.join("/")}: ${rejected.join(", ")}.`,
      "They are not listed in this market. Do not repeat them or any other foreign listing.",
      `Name only ${meta.label}-listed companies with genuine exposure to this thesis.`,
      "",
    );
  }

  lines.push(`Shortlist the ${meta.label}-listed stocks that express this thesis.`);
  return lines.join("\n");
}
