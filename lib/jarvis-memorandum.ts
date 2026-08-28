import { z } from "zod";

/**
 * The Jarvis memorandum: the whole decision document, produced by one model
 * call and rendered as the reference deliverable
 * (`jarvis-india-ev-winner.html`) — comparative grid, then Thesis / Stress Test
 * / Trade Plan / Exit tabs.
 *
 * This schema is the contract for `thesis_memorandums.document`. Two rules
 * shape it:
 *
 * 1. Display strings and machine numbers are kept SEPARATE. `trade_plan.cells`
 *    carries what the grid shows ("₹9,800–10,000", "30% starter — wait for a
 *    2-4% pullback"); `trade_plan.numeric` carries the same levels as bare
 *    numbers. Backing the trade writes `numeric` into `trade_plans`, so a
 *    formatted range string can never end up parsed into a stop-loss.
 * 2. Almost every field is nullable. A thin section should cost that section,
 *    not the entire memo — the alternative is a 40-field document that fails
 *    validation because the model declined to invent a parallel trade.
 */

const str = z.string().nullable().catch(null);
const numOrNull = z.number().nullable().catch(null);

export const VerdictEnum = z.enum(["BUY", "WATCH", "AVOID"]);
export type MemoVerdict = z.infer<typeof VerdictEnum>;

/** One column of the comparative entity grid. */
export const MemoCandidateSchema = z.object({
  ticker: z.string(),
  company_name: str,
  /** Primary multiple as displayed, e.g. "26.2×" or "Loss-Making". */
  valuation_metric: str,
  market_cap: str,
  /** Key segment share, e.g. "20.6%" — sector-specific, so a free string. */
  operational_share: str,
  verdict: VerdictEnum.catch("WATCH"),
  /** Short qualitative tag: "JARVIS PICK", "MOMENTUM TRAP". */
  tagline: str,
  is_primary_pick: z.boolean().catch(false),
});

/** A peer the memo explains away rather than backs ("Why Not The Others"). */
export const PeerCommentarySchema = z.object({
  ticker: z.string(),
  valuation: str,
  /** Drives the accent colour: a dismissal reads red, a near-miss reads blue. */
  tone: z.enum(["negative", "neutral", "positive"]).catch("neutral"),
  note: str,
});

export const ThesisTabSchema = z.object({
  section_header: str,
  market_view: str,
  mispricing: str,
  catalysts: z.array(z.string()).catch([]),
  peer_commentary: z.array(PeerCommentarySchema).catch([]),
  time_horizon_invalidation: str,
  conviction_score: numOrNull,
  secondary: z
    .object({ name: str, tier: str, note: str })
    .nullable()
    .catch(null),
});

export const FailureModeSchema = z.object({
  title: str,
  bear_case: str,
  counter: str,
});

export const StressTabSchema = z.object({
  failure_modes: z.array(FailureModeSchema).catch([]),
  verdict: str,
});

/** One cell of the 9-cell trade grid: the big value plus its caption. */
export const TradeCellSchema = z.object({ value: str, sub: str });

export const TradeTabSchema = z.object({
  section_header: str,
  cells: z.object({
    cmp: TradeCellSchema,
    entry_zone: TradeCellSchema,
    add_tranche: TradeCellSchema,
    stop_loss: TradeCellSchema,
    target_1: TradeCellSchema,
    target_2: TradeCellSchema,
    position_size: TradeCellSchema,
    time_horizon: TradeCellSchema,
    time_exit: TradeCellSchema,
  }),
  /** The same plan as data — this is what `trade_plans` is written from. */
  numeric: z.object({
    entry_zone_low: numOrNull,
    entry_zone_high: numOrNull,
    add_tranche_low: numOrNull,
    add_tranche_high: numOrNull,
    stop_loss: numOrNull,
    target_1: numOrNull,
    target_2: numOrNull,
    position_size_pct: numOrNull,
    time_exit_date: str,
    time_exit_condition: str,
  }),
  test_calendar: z
    .array(z.object({ timeframe: str, event: str, test: str }))
    .catch([]),
  parallel_plan: z
    .object({
      name: str,
      entry: str,
      stop: str,
      target: str,
      size: str,
      horizon: str,
      note: str,
    })
    .nullable()
    .catch(null),
});

export const ExitTabSchema = z.object({
  section_header: str,
  rules: z
    .array(
      z.object({
        kind: z.enum(["trim", "runner", "stop", "time"]).catch("trim"),
        headline: str,
        detail: str,
      }),
    )
    .catch([]),
  warning: z.object({ anchor_metric: str, text: str }).nullable().catch(null),
  verdict_cells: z.object({
    risk_reward: TradeCellSchema,
    max_drawdown: TradeCellSchema,
    tier: TradeCellSchema,
    peg: TradeCellSchema,
  }),
});

export const MemorandumSchema = z.object({
  header: z.object({
    system_id: str,
    sector_theme: str,
    title: str,
    data_source: str,
  }),
  candidates: z.array(MemoCandidateSchema).min(1),
  primary_ticker: z.string(),
  secondary_ticker: str,
  execution_status: str,
  thesis: ThesisTabSchema,
  stress_test: StressTabSchema,
  trade_plan: TradeTabSchema,
  exit: ExitTabSchema,
});

export type Memorandum = z.infer<typeof MemorandumSchema>;
export type MemoCandidate = z.infer<typeof MemoCandidateSchema>;

/* ------------------------------------------------------------------------- */

export const JARVIS_MEMORANDUM_SYSTEM_PROMPT = `You are Jarvis, a high-performance trading decision system for a discretionary trader.
You are direct, not polite. You challenge weak thinking and do NOT validate bad ideas.

You will be given a trading thesis and a set of candidate stocks with live market data the
system has already fetched. Produce ONE complete decision memorandum: run the same analysis on
every candidate, pick a single winner, and write the full document the trader will act on.

HARD RULES
- Use the supplied live price, valuation and 52-week data as ground truth. NEVER invent a number.
  Where a candidate arrived without data, say so plainly rather than filling the gap.
- Exactly one candidate has "is_primary_pick": true and "verdict": "BUY". Its ticker is
  "primary_ticker". Others are "WATCH" or "AVOID".
- Comparative valuation is the point. Compare multiples to the OTHER NAMES ON THIS LIST, not to a
  remembered sector average.
- Every price level in the trade plan must be anchored to the winner's actual current price.
- "cells" values are for display and SHOULD carry currency symbols and ranges
  (e.g. "₹9,800–10,000"). "numeric" carries the SAME levels as bare numbers with no symbols,
  separators or ranges. They must agree: if cells.stop_loss.value is "₹9,100", numeric.stop_loss
  is 9100. Where a level genuinely doesn't apply, use null in numeric and say why in the cell.
- Plan geometry must hold: add_tranche below entry zone, stop below both, targets above the entry
  zone, target_2 above target_1. Risk/reward from entry to target_1 should be at least 1.5:1.
- position_size_pct is percent of total portfolio, scaled to conviction: Tier I 5-8%,
  Tier II 3-5%, Tier III 1-3%, Tier IV 0-1%.
- Exactly 4 entries in stress_test.failure_modes. Each counter must be honest: if a bear case is
  strong, concede that it weakens conviction rather than forcing a rebuttal.
- exit.rules: 5 entries in this order — two "trim" rules (target 1, then target 2), one "runner",
  one "stop", one "time".
- The exit warning names the ONE anchor metric to track continuously — an operational number, not
  the share price.
- "secondary" and "parallel_plan" are for a genuine second-best name. Use null if there isn't one.
  Do not manufacture a second trade to fill the field.

TONE
Write like a memo to one trader who is about to risk real money, not like equity research.
Short declarative sentences. Name the thing that would make you wrong.

OUTPUT
Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else — no prose before or after it. Use null for anything you cannot responsibly
determine. Shape:

{
  "header": { "system_id": string, "sector_theme": string, "title": string, "data_source": string },
  "candidates": [ { "ticker": string, "company_name": string, "valuation_metric": string,
                    "market_cap": string, "operational_share": string,
                    "verdict": "BUY"|"WATCH"|"AVOID", "tagline": string, "is_primary_pick": boolean } ],
  "primary_ticker": string,
  "secondary_ticker": string | null,
  "execution_status": string,
  "thesis": {
    "section_header": string,
    "market_view": string,
    "mispricing": string,
    "catalysts": [string],
    "peer_commentary": [ { "ticker": string, "valuation": string,
                           "tone": "negative"|"neutral"|"positive", "note": string } ],
    "time_horizon_invalidation": string,
    "conviction_score": number,
    "secondary": { "name": string, "tier": string, "note": string } | null
  },
  "stress_test": {
    "failure_modes": [ { "title": string, "bear_case": string, "counter": string } ],
    "verdict": string
  },
  "trade_plan": {
    "section_header": string,
    "cells": {
      "cmp": {"value": string, "sub": string}, "entry_zone": {"value": string, "sub": string},
      "add_tranche": {"value": string, "sub": string}, "stop_loss": {"value": string, "sub": string},
      "target_1": {"value": string, "sub": string}, "target_2": {"value": string, "sub": string},
      "position_size": {"value": string, "sub": string}, "time_horizon": {"value": string, "sub": string},
      "time_exit": {"value": string, "sub": string}
    },
    "numeric": {
      "entry_zone_low": number|null, "entry_zone_high": number|null,
      "add_tranche_low": number|null, "add_tranche_high": number|null,
      "stop_loss": number|null, "target_1": number|null, "target_2": number|null,
      "position_size_pct": number|null,
      "time_exit_date": string|null, "time_exit_condition": string|null
    },
    "test_calendar": [ { "timeframe": string, "event": string, "test": string } ],
    "parallel_plan": { "name": string, "entry": string, "stop": string, "target": string,
                       "size": string, "horizon": string, "note": string } | null
  },
  "exit": {
    "section_header": string,
    "rules": [ { "kind": "trim"|"runner"|"stop"|"time", "headline": string, "detail": string } ],
    "warning": { "anchor_metric": string, "text": string } | null,
    "verdict_cells": {
      "risk_reward": {"value": string, "sub": string}, "max_drawdown": {"value": string, "sub": string},
      "tier": {"value": string, "sub": string}, "peg": {"value": string, "sub": string}
    }
  }
}

4-6 catalysts. 3-4 test_calendar milestones. Valid JSON: no trailing commas, no comments.`;

export type MemoCandidateInput = {
  ticker: string;
  companyName?: string | null;
  exchange?: string | null;
  price?: number | null;
  fundamentals?: Record<string, string | number>;
};

/** Fields worth putting in front of the model, in a fixed, readable order. */
const SHOWN_FUNDAMENTALS: [key: string, label: string][] = [
  ["trailingPE", "Trailing P/E"],
  ["forwardPE", "Forward P/E"],
  ["pegRatio", "PEG"],
  ["marketCap", "Market cap"],
  ["fiftyTwoWeekLow", "52-week low"],
  ["fiftyTwoWeekHigh", "52-week high"],
  ["priceToBook", "Price/Book"],
  ["trailingEps", "Trailing EPS"],
  ["revenueGrowth", "Revenue growth"],
  ["profitMargins", "Profit margins"],
  ["operatingMargins", "Operating margins"],
  ["returnOnEquity", "Return on equity"],
  ["debtToEquity", "Debt/Equity"],
];

export function buildMemorandumUserContext(input: {
  thesis: {
    input_text: string;
    market_view: string | null;
    mispricing: string | null;
    catalyst: string | null;
    time_horizon: string | null;
    invalidation_condition: string | null;
    conviction_tier: string | null;
    conviction_score: number | null;
  };
  candidates: MemoCandidateInput[];
  todayIso: string;
}): string {
  const lines: string[] = [];
  const { thesis } = input;

  lines.push(`Today's date: ${input.todayIso}`);
  lines.push("");
  lines.push("THESIS AS THE TRADER STATED IT");
  lines.push(thesis.input_text);
  lines.push("");
  lines.push("STRUCTURED SO FAR");
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
  lines.push("");
  lines.push("CANDIDATES — LIVE MARKET DATA");

  for (const c of input.candidates) {
    lines.push("");
    lines.push(`- Ticker: ${c.ticker}`);
    if (c.companyName) lines.push(`  Company: ${c.companyName}`);
    if (c.exchange) lines.push(`  Exchange: ${c.exchange}`);
    lines.push(
      c.price != null
        ? `  Current price: ${c.price}`
        : "  Current price: UNAVAILABLE — this ticker did not resolve to live market data.",
    );
    const f = c.fundamentals ?? {};
    const shown = SHOWN_FUNDAMENTALS.filter(([k]) => f[k] !== undefined);
    if (shown.length > 0) {
      for (const [k, label] of shown) lines.push(`  ${label}: ${f[k]}`);
    }
  }

  lines.push("");
  lines.push("Produce the complete memorandum.");
  return lines.join("\n");
}

/* ------------------------------------------------------------------------- */

import { extractTrailingJsonBlock, sanitizeTradePlanGeometry } from "./jarvis-thesis-parser";

export type MemorandumParse =
  | { ok: true; data: Memorandum }
  | { ok: false; error: string };

/** Same never-throws contract as the other Jarvis parsers. */
export function parseMemorandum(raw: string): MemorandumParse {
  try {
    const json = extractTrailingJsonBlock(raw);
    if (json === null) {
      return { ok: false, error: "No valid ```json code block found in the response." };
    }
    const result = MemorandumSchema.safeParse(json);
    if (!result.success) {
      return { ok: false, error: `Memorandum failed schema validation: ${result.error.message}` };
    }
    return { ok: true, data: normalizeMemorandum(result.data) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Repairs the two invariants the renderer and the "back this trade" action rely
 * on, rather than rejecting an otherwise-usable memo:
 *
 * - Exactly one primary pick, and `primary_ticker` agrees with it. A memo with
 *   two BUYs or a `primary_ticker` naming a candidate that isn't flagged would
 *   render two highlighted columns and could write the wrong ticker into a
 *   position.
 * - Trade-plan geometry, applied to `numeric` only. A level that contradicts the
 *   plan (a stop above the entry) is dropped, because these numbers are written
 *   straight into `trade_plans` when the trade is backed. The display cell keeps
 *   whatever the model wrote — the trader still sees what it intended, and a
 *   silently corrected number would be worse than a visible disagreement.
 */
export function normalizeMemorandum(memo: Memorandum): Memorandum {
  const candidates = [...memo.candidates];
  const byTicker = (t: string) => candidates.findIndex((c) => c.ticker === t);

  // Prefer the explicitly named primary; fall back to the first flagged pick,
  // then to the first BUY, then to the first candidate.
  let primaryIdx = byTicker(memo.primary_ticker);
  if (primaryIdx === -1) primaryIdx = candidates.findIndex((c) => c.is_primary_pick);
  if (primaryIdx === -1) primaryIdx = candidates.findIndex((c) => c.verdict === "BUY");
  if (primaryIdx === -1) primaryIdx = 0;

  const normalizedCandidates = candidates.map((c, i) => ({
    ...c,
    is_primary_pick: i === primaryIdx,
    verdict: i === primaryIdx ? ("BUY" as const) : c.verdict === "BUY" ? ("WATCH" as const) : c.verdict,
  }));

  // Geometry lives in `sanitizeTradePlanGeometry` so every producer of a plan
  // agrees on what "valid" means — these numbers are written into `trade_plans`
  // verbatim when the trade is backed.
  const numeric = sanitizeTradePlanGeometry(memo.trade_plan.numeric);

  return {
    ...memo,
    candidates: normalizedCandidates,
    primary_ticker: normalizedCandidates[primaryIdx].ticker,
    trade_plan: { ...memo.trade_plan, numeric },
  };
}

/**
 * Shortlist context for a thesis that ALREADY names a stock. The memo is a
 * comparison either way — "should I buy this one" is only answerable against the
 * alternatives — so a named stock is seeded as a candidate and the model is
 * asked for its peers rather than for a fresh basket.
 */
export function buildPeerShortlistUserContext(thesis: {
  input_text: string;
  ticker: string;
  market_view: string | null;
}): string {
  return [
    `The trader is looking at ${thesis.ticker}.`,
    `Their idea: ${thesis.input_text}`,
    `Market View: ${thesis.market_view ?? "—"}`,
    "",
    `Return ${thesis.ticker} FIRST, then 2-4 of its closest listed competitors — the names a`,
    "trader would realistically weigh against it before committing capital. Same exchange where",
    "possible.",
  ].join("\n");
}
