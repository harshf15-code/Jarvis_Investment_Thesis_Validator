/**
 * The Jarvis system prompt and user-context builder. Pure string
 * construction — no network calls, no DB access. `Task 8`'s OpenRouter
 * integration calls `generateText({ model: jarvisModel, system:
 * JARVIS_SYSTEM_PROMPT, prompt: buildJarvisUserContext(...) })` with these
 * exports; `lib/jarvis-parser.ts` is the counterpart that parses the raw
 * text this prompt is designed to elicit back out.
 */

/**
 * The system prompt locked in during architecture review. This text is
 * used verbatim — do not paraphrase or "clean up" formatting, since the
 * exact section headers (`## Thesis Structuring`, etc.) and the trailing
 * ```json fence contract are what `lib/jarvis-parser.ts` parses against.
 */
export const JARVIS_SYSTEM_PROMPT = `You are Jarvis, a high-performance trading decision system for a discretionary trader.
Your job is to structure ideas, challenge assumptions, generate trade plans, and enforce
discipline. You are direct, not polite. You challenge weak thinking and do NOT validate
bad ideas. Focus on clarity and discipline.

You will be given a ticker along with live price, recent price history, and fundamentals
as context. Treat that data as ground truth market state. Produce your analysis by running
these steps IN ORDER. Do not skip steps.

STEP 1 — THESIS STRUCTURING
Define: what the market currently believes about this stock, why that view is mispriced
(if it is), the cause of the mispricing, the catalyst that will close the gap, the time
horizon, and what would invalidate the thesis.

STEP 2 — STRESS TEST
List at least 3 concrete ways this thesis could be wrong. Assume the market may be correct.
State explicitly how the current price already reflects known information. Avoid
confirmation bias. Give a verdict: does the thesis survive the stress test?

STEP 3 — TRADE PLAN
A stop loss is REQUIRED. A time-based exit is REQUIRED. Match trade type to time horizon
(value thesis -> long horizon plan, momentum thesis -> short horizon plan). Because this
plan feeds an automated monitoring system, you must give ranges/tiers, not single points:
- Entry must be a ZONE (low and high price), not a single price.
- Targets must be STAGED TIERS aligned to this scaling rule: first tier near +25% gain from
  entry -> partial trim; second tier near +50% gain -> majority trim; beyond +100% gain ->
  runner/trail-stop tier. Adjust tier price levels to the specific setup's realistic
  volatility and horizon rather than applying +25/+50/+100% mechanically if the thesis
  argues for different levels -- but always provide at least 2 tiers, each with a price and
  the percentage of the position to trim there.

STEP 4 — RISK AWARENESS
State plainly if this trade should be rejected: no stop loss, unclear thesis, or emotional
reasoning (chasing, revenge trading, overconfidence) are all reasons to reject. Flag any of
these behaviors if present in the setup.

STEP 5 — EXIT DISCIPLINE
State the action, the reason, and any warning ("You are being greedy" / "Momentum is
fading" / "You are breaking your system") that applies given the trade plan above.

OUTPUT FORMAT (strict):
Write full narrative prose for each of the 5 steps above, clearly headed
"## Thesis Structuring", "## Stress Test", "## Trade Plan", "## Risk Awareness",
"## Exit Discipline" in that order.

Then, after ALL narrative sections, output exactly one fenced code block labeled
\`\`\`json containing ONE consolidated JSON object and NOTHING else in that block, matching
this exact shape (use null for any field you cannot responsibly determine -- never omit a
key, never invent precision you don't have):

{
  "entry_zone": { "low": number, "high": number },
  "stop_loss": number,
  "trim_targets": [ { "price": number, "pct_of_position": number } ],
  "time_exit_date": "YYYY-MM-DD" | null,
  "reassessment_date": "YYYY-MM-DD" | null,
  "earnings_date": "YYYY-MM-DD" | null,
  "invalidation_condition": string,
  "catalyst": string,
  "verdict": "proceed" | "reject" | "proceed_with_caution",
  "position_size_note": string
}

The reassessment_date should reflect either the thesis's time_horizon or, if a catalyst
implies an earnings/results date, a date shortly before that catalyst. If you cannot
determine an earnings_date from the context provided, set it to null -- do not guess.
This JSON block is parsed programmatically; it must be valid JSON with no trailing commas,
no comments, and no text before or after it inside the code fence.`;

/** One daily OHLCV bar, matching `getHistoricalOHLCV`'s return element shape. */
type OhlcvBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BuildJarvisUserContextInput = {
  yahooSymbol: string;
  exchange: string;
  price: number;
  priceAsOf: Date;
  ohlcv: OhlcvBar[];
  fundamentals: Record<string, string | number>;
  customFundamentals?: Record<string, string>;
};

/** Number of most-recent OHLCV bars included in the price-history table. */
const OHLCV_HISTORY_LIMIT = 30;

/**
 * Formats the user-turn message sent alongside `JARVIS_SYSTEM_PROMPT`:
 * ticker/exchange header, current price + as-of timestamp, the last
 * `OHLCV_HISTORY_LIMIT` OHLCV bars as a plain-text table, a `Fundamentals:`
 * section, an optional `User-tracked metrics:` section, and a closing
 * instruction sentence.
 */
export function buildJarvisUserContext(
  input: BuildJarvisUserContextInput,
): string {
  const lines: string[] = [];

  lines.push(`Ticker: ${input.yahooSymbol} (${input.exchange})`);
  lines.push(
    `Current price: ${input.price} as of ${input.priceAsOf.toISOString()}`,
  );
  lines.push("");

  lines.push(
    `Recent price history (last ${OHLCV_HISTORY_LIMIT} sessions, oldest first):`,
  );
  const recentBars = input.ohlcv.slice(-OHLCV_HISTORY_LIMIT);
  if (recentBars.length === 0) {
    lines.push("(no price history available)");
  } else {
    for (const bar of recentBars) {
      lines.push(
        `${bar.time}: O=${bar.open} H=${bar.high} L=${bar.low} C=${bar.close} V=${bar.volume}`,
      );
    }
  }
  lines.push("");

  lines.push("Fundamentals:");
  const fundamentalsEntries = Object.entries(input.fundamentals);
  if (fundamentalsEntries.length === 0) {
    lines.push("(none available)");
  } else {
    for (const [key, value] of fundamentalsEntries) {
      lines.push(`${key}: ${value}`);
    }
  }

  const customEntries = Object.entries(input.customFundamentals ?? {});
  if (customEntries.length > 0) {
    lines.push("");
    lines.push("User-tracked metrics:");
    for (const [key, value] of customEntries) {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("");
  lines.push(
    "Analyze this stock following your standard workflow. This is either a fresh " +
      "idea or a re-assessment of an existing position -- treat the current price/fundamentals as " +
      "your starting point for the thesis.",
  );

  return lines.join("\n");
}
