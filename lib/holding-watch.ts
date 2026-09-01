import { z } from "zod";

import { extractTrailingJsonBlock } from "@/lib/jarvis-thesis-parser";
import type { HoldingReviewTrigger } from "@/lib/types";

/**
 * The per-holding watch: what counts as a development worth a model call, and
 * the shape of the read that comes back.
 *
 * Pure — no I/O, no dates read from the clock, no Supabase. The parts of this
 * feature that can silently be wrong are "did anything actually change" and
 * "did an earnings date pass", and both are worth testing without a network.
 *
 * WHAT THIS IS GROUNDED IN, and what it is not. The original ask was for
 * Jarvis to watch for new earnings reports and management commentary. This app
 * has no news feed, no transcripts and no live search — only Yahoo's calendar
 * and fundamentals, plus the model's own trained knowledge, which the Council
 * already deliberately refuses to lean on for anything current. So the watch
 * fires on structural facts: an earnings date approaching, an earnings date
 * having passed, a fundamental having moved. It never asserts what was SAID.
 * That is a real narrowing, and the prompt states it to the model rather than
 * hoping the model infers it.
 */

/** Days out at which an upcoming earnings date becomes worth mentioning. */
export const EARNINGS_WINDOW_DAYS = 14;

/**
 * How far a watched fundamental must move to be worth a model call.
 *
 * One threshold for every metric rather than one each. A per-metric table
 * sounds more precise but there is no evidence behind any of the numbers that
 * would go in it, and the PRD lists tuning these as its own open question —
 * so this ships one honest default rather than six invented ones.
 */
export const FUNDAMENTALS_DELTA_PCT = 15;

/** A holding is re-checked weekly. See the migration for why not daily. */
export const WATCH_INTERVAL_DAYS = 7;

/**
 * Holdings drained per invocation of the watch route.
 *
 * The cron fires far more often than weekly and each run takes a slice, so the
 * work stays inside one function timeout however large the book grows.
 * `WATCH_INTERVAL_DAYS` is the cadence a HOLDING is checked at; this is the
 * batch size, and they are deliberately different numbers.
 */
export const WATCH_BATCH = 25;

/**
 * The fundamentals that earn a trigger, and what to call them in a prompt.
 *
 * A strict subset of `FUNDAMENTALS_FIELDS` in `lib/market-data.ts`. Market cap
 * and the 52-week range move with the price every single day and would fire
 * every week for every holding; `currentPrice` is the price itself. Those are
 * context for the read, not reasons to run one.
 */
export const WATCHED_FUNDAMENTALS: Record<string, string> = {
  trailingPE: "Trailing P/E",
  forwardPE: "Forward P/E",
  profitMargins: "Profit margin",
  operatingMargins: "Operating margin",
  grossMargins: "Gross margin",
  revenueGrowth: "Revenue growth",
  debtToEquity: "Debt to equity",
  returnOnEquity: "Return on equity",
};

export type FundamentalChange = {
  key: string;
  label: string;
  previous: number;
  current: number;
  /** Signed, relative to |previous|. `null` when the sign flipped. */
  percentChange: number | null;
};

export type WatchState = {
  fundamentals: Record<string, unknown>;
  nextEarningsDate: string | null;
  lastEarningsSeen: string | null;
};

export type WatchObservation = {
  fundamentals: Record<string, string | number>;
  /** `YYYY-MM-DD`, ascending. */
  earningsDates: string[];
  earningsDateIsEstimate: boolean;
};

export type TriggerResult = {
  triggers: HoldingReviewTrigger[];
  changes: FundamentalChange[];
  /** The upcoming earnings date, if any, once the past ones are dropped. */
  upcomingEarnings: string | null;
  /** The date we were tracking that has since gone by, if it just did. */
  passedEarnings: string | null;
  /** What `holding_watch_state` should hold after this check. */
  nextState: WatchState;
};

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is past. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Whether anything happened to this holding since the last check.
 *
 * `today` is passed in rather than read from the clock, because a function
 * that decides "has this date passed" and also decides what "now" means cannot
 * be tested for the boundary that matters.
 */
export function detectTriggers(input: {
  state: WatchState;
  observed: WatchObservation;
  today: string;
}): TriggerResult {
  const { state, observed, today } = input;
  const triggers: HoldingReviewTrigger[] = [];

  const upcoming = observed.earningsDates.find((d) => daysBetween(today, d) >= 0) ?? null;

  // 1. Approaching. Fires ONCE per earnings date: `lastEarningsSeen` records
  //    the date already spoken about, so a date that entered the window three
  //    weeks ago does not fire again every week as it gets nearer.
  const approaching =
    upcoming !== null &&
    daysBetween(today, upcoming) <= EARNINGS_WINDOW_DAYS &&
    state.lastEarningsSeen !== upcoming;

  // 2. Passed. The date we were tracking is now behind us.
  //
  //    It fires exactly once because `nextEarningsDate` then advances to
  //    whatever is upcoming — which is often null, since Yahoo publishes the
  //    following quarter's date some days later. Without that advance this
  //    would re-fire every week for the same long-gone quarter.
  const passed =
    state.nextEarningsDate !== null && daysBetween(today, state.nextEarningsDate) < 0
      ? state.nextEarningsDate
      : null;

  if (approaching || passed !== null) triggers.push("earnings_calendar");

  const changes = diffFundamentals(state.fundamentals, observed.fundamentals);
  if (changes.length > 0) triggers.push("fundamentals_delta");

  return {
    triggers,
    changes,
    upcomingEarnings: upcoming,
    passedEarnings: passed,
    nextState: {
      // MERGED over the previous baseline, not replaced by it.
      //
      // Yahoo drops a module or an individual field from time to time, and the
      // last known value stays true when it does. Replacing wholesale would
      // erase that baseline, so when the metric reappeared there would be
      // nothing to compare it against and a real move would pass unnoticed —
      // the watch would go quietest exactly when the data got flaky.
      fundamentals: { ...state.fundamentals, ...observed.fundamentals },
      // A tracked date is retired only once it has actually PASSED or been
      // replaced by a later one. If Yahoo simply stops reporting a future
      // date, keeping it is what lets the "it has been and gone" trigger still
      // fire when that day arrives.
      nextEarningsDate: upcoming ?? (passed !== null ? null : state.nextEarningsDate),
      // Only claim to have spoken about a date once we actually have.
      lastEarningsSeen: approaching ? upcoming : state.lastEarningsSeen,
    },
  };
}

/**
 * Watched metrics that moved beyond the threshold.
 *
 * A metric absent from either side is skipped rather than treated as a move to
 * or from zero: Yahoo omits fields per instrument type, and "this ADR does not
 * report operating margin" is not news about the business.
 */
export function diffFundamentals(
  previous: Record<string, unknown>,
  current: Record<string, string | number>,
): FundamentalChange[] {
  const changes: FundamentalChange[] = [];

  for (const [key, label] of Object.entries(WATCHED_FUNDAMENTALS)) {
    const before = asNumber(previous[key]);
    const after = asNumber(current[key]);
    if (before === null || after === null) continue;

    // A sign flip always counts, whatever the percentage says. A margin going
    // from +2% to −1% is a 150% move by the arithmetic and a different company
    // by any other reading; one going from −40% to −20% is a 50% "improvement"
    // that the same arithmetic would report as a fall.
    if (Math.sign(before) !== Math.sign(after) && before !== 0 && after !== 0) {
      changes.push({ key, label, previous: before, current: after, percentChange: null });
      continue;
    }

    // No baseline to be a percentage of. Not a silent skip of a real move —
    // there is genuinely no percentage from zero.
    if (before === 0) continue;

    const percentChange = ((after - before) / Math.abs(before)) * 100;
    if (Math.abs(percentChange) >= FUNDAMENTALS_DELTA_PCT) {
      changes.push({ key, label, previous: before, current: after, percentChange });
    }
  }

  return changes;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/* ------------------------------------------------------------------------- *
 * The review document
 * ------------------------------------------------------------------------- */

const str = z.string().nullable().catch(null);

export const HoldingLeanEnum = z.enum(["STAY", "TRIM", "EXIT", "UNCLEAR"]);
export type HoldingLean = z.infer<typeof HoldingLeanEnum>;

/**
 * The contract for `holding_reviews.document`.
 *
 * Named `HoldingRead`, not `HoldingReview`, because `HoldingReview` is the ROW
 * in `lib/types.ts` — the same split as `Memorandum` (the document) beside
 * `ThesisMemorandum` (the row that stores it).
 *
 * Same discipline as `lib/jarvis-memorandum.ts`: nearly every field is
 * nullable with `.catch`, so a thin answer costs that field rather than the
 * whole review. `UNCLEAR` is a first-class lean for the same reason — a model
 * with nothing to say should say so, not pick STAY to fill the slot.
 */
export const HoldingReadSchema = z.object({
  headline: str,
  /** Null when the trader gave no reason for holding — there is nothing to
   *  judge intact or broken, and inventing a verdict on an unstated thesis is
   *  the one thing this review must not do. */
  still_intact: z.boolean().nullable().catch(null),
  what_changed: str,
  what_to_watch: str,
  lean: HoldingLeanEnum.catch("UNCLEAR"),
  /** The facts the read rests on, as the model understood them. Rendered to
   *  the trader so a claim can be checked against its grounding. */
  grounded_in: z.array(z.string()).catch([]),
});

export type HoldingRead = z.infer<typeof HoldingReadSchema>;

export type HoldingReadParse =
  | { ok: true; data: HoldingRead }
  | { ok: false; error: string };

/** Same never-throws contract as every other Jarvis parser. */
export function parseHoldingRead(raw: string): HoldingReadParse {
  try {
    const json = extractTrailingJsonBlock(raw);
    if (json === null) {
      return { ok: false, error: "No valid ```json code block found in the review." };
    }
    const result = HoldingReadSchema.safeParse(json);
    if (!result.success) {
      return { ok: false, error: `Review failed schema validation: ${result.error.message}` };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------------- *
 * Prompts
 * ------------------------------------------------------------------------- */

export const HOLDING_REVIEW_SYSTEM_PROMPT = `You are Jarvis, re-reading one holding in a trader's portfolio.

WHAT YOU ARE AND ARE NOT LOOKING AT
You have this holding's current price, its current fundamentals, and — where one is known — an
earnings date. You have NO news, NO transcripts, NO analyst notes and NO search. You did not read
an earnings call and you must never write as though you did.

HARD RULES
- Assert as FACT only what is in the data given to you: a date, a number, a change between two
  numbers. Everything else is your own read and must be written as one ("this looks like", "I would
  watch").
- NEVER attribute a statement to management, an analyst or a report. If the reason a number moved
  matters, say that you cannot see the reason from here.
- NEVER invent a number. If a fundamental is absent, it is absent.
- An earnings date marked ESTIMATED is Yahoo's projection, not a scheduled event. Say so.
- If the trader stated why they bought this, judge whether THAT reasoning still holds — not
  whether you would buy it today. If they stated no reason, "still_intact" is null and you say
  plainly that there is no stated thesis to test.
- "Nothing material changed" is a complete and useful answer. Say it plainly rather than
  manufacturing significance from a number that moved a little.

TONE
Short declarative sentences. You are talking to one trader about money they already have at risk.

OUTPUT
Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else — no prose before or after it. Use null for anything you cannot responsibly
determine. Shape:

{
  "headline": string,
  "still_intact": true | false | null,
  "what_changed": string,
  "what_to_watch": string,
  "lean": "STAY" | "TRIM" | "EXIT" | "UNCLEAR",
  "grounded_in": [string]
}

"headline" is one sentence. "what_changed" and "what_to_watch" are 2-4 sentences each.
"grounded_in" is 1-4 short strings, each naming one concrete fact you used (a date, a metric and
its move). Valid JSON: no trailing commas.`;

/**
 * The facts about one holding that every Jarvis call about it shares: what is
 * owned, at what cost, why the trader says they own it, and what the portfolio
 * is for.
 *
 * Extracted so the exit-plan builder (`lib/exit-plan.ts`) grounds its proposed
 * stop in exactly the same statement of the position that the recurring read
 * is judged against. Two copies of this would drift, and then the read and the
 * stop on the same screen would be arguing about different holdings.
 *
 * Returns LINES rather than a string: the callers interleave their own
 * sections between these and a joined string would have to be re-split.
 */
export function buildHoldingFactsBlock(input: {
  ticker: string;
  companyName: string | null;
  currency: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number | null;
  /** The trader's own "why I bought this", if they gave one. */
  rationale: string | null;
  /** The whole-portfolio objective, if set. */
  objective: string | null;
  heldSince: string | null;
}): string[] {
  const lines: string[] = [];

  lines.push("THE HOLDING");
  lines.push(`Ticker: ${input.ticker}${input.companyName ? ` (${input.companyName})` : ""}`);
  lines.push(`Quantity: ${input.quantity}`);
  lines.push(`Average cost: ${input.averagePrice} ${input.currency}`);
  lines.push(
    input.currentPrice != null
      ? `Current price: ${input.currentPrice} ${input.currency}`
      : "Current price: UNAVAILABLE",
  );
  if (input.currentPrice != null && input.averagePrice > 0) {
    const pct = ((input.currentPrice - input.averagePrice) / input.averagePrice) * 100;
    lines.push(`Unrealized: ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
  }
  if (input.heldSince) lines.push(`Held since (trader's estimate): ${input.heldSince}`);

  lines.push("");
  lines.push("WHY THE TRADER SAYS THEY BOUGHT IT");
  lines.push(
    input.rationale?.trim()
      ? input.rationale.trim()
      : "They did not record a reason. There is no stated thesis to test — say so rather than assuming one.",
  );

  if (input.objective?.trim()) {
    lines.push("");
    lines.push("WHAT THEY SAY THE PORTFOLIO IS FOR");
    lines.push(input.objective.trim());
  }

  return lines;
}

/** The current fundamentals, labelled. Shared for the same reason as
 *  `buildHoldingFactsBlock`. */
export function buildFundamentalsBlock(fundamentals: Record<string, string | number>): string[] {
  const lines: string[] = ["FUNDAMENTALS NOW"];
  const entries = Object.entries(fundamentals);
  if (entries.length === 0) {
    lines.push("None available for this listing.");
  } else {
    for (const [key, value] of entries) {
      lines.push(`  ${WATCHED_FUNDAMENTALS[key] ?? key}: ${value}`);
    }
  }
  return lines;
}

export function buildHoldingReviewContext(input: {
  ticker: string;
  companyName: string | null;
  currency: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number | null;
  /** The trader's own "why I bought this", if they gave one. */
  rationale: string | null;
  /** The whole-portfolio objective, if set. */
  objective: string | null;
  heldSince: string | null;
  fundamentals: Record<string, string | number>;
  changes: FundamentalChange[];
  upcomingEarnings: string | null;
  passedEarnings: string | null;
  earningsDateIsEstimate: boolean;
  isInitial: boolean;
}): string {
  const lines: string[] = [];

  lines.push(
    input.isInitial
      ? "This is the FIRST read on a holding the trader imported. There is no previous check to compare against, so there is no change to report — describe where this position stands today."
      : "This is a scheduled re-check of a holding you have read before.",
  );
  lines.push("");
  lines.push(...buildHoldingFactsBlock(input));

  lines.push("");
  lines.push("EARNINGS CALENDAR");
  if (input.passedEarnings) {
    lines.push(`An earnings date of ${input.passedEarnings} has now passed. You do NOT have the results or anything that was said — only that the date is behind us.`);
  }
  if (input.upcomingEarnings) {
    lines.push(
      `Next earnings date: ${input.upcomingEarnings}${input.earningsDateIsEstimate ? " (ESTIMATED by the data provider, not a confirmed date)" : ""}.`,
    );
  }
  if (!input.passedEarnings && !input.upcomingEarnings) {
    lines.push("No earnings date is known for this holding.");
  }

  lines.push("");
  lines.push(...buildFundamentalsBlock(input.fundamentals));

  if (input.changes.length > 0) {
    lines.push("");
    lines.push("WHAT MOVED SINCE THE LAST CHECK");
    for (const c of input.changes) {
      lines.push(
        c.percentChange === null
          ? `  ${c.label}: ${c.previous} -> ${c.current} (changed sign)`
          : `  ${c.label}: ${c.previous} -> ${c.current} (${c.percentChange >= 0 ? "+" : ""}${c.percentChange.toFixed(1)}%)`,
      );
    }
  }

  lines.push("");
  lines.push("Give your read.");
  return lines.join("\n");
}

/**
 * The one-line Feed headline for a review that fired.
 *
 * Built here rather than asked of the model: a Feed row is a claim about what
 * happened, and what happened is something this code knows exactly.
 *
 * It knows LESS than it is tempting to write. A passed calendar date means the
 * date is behind us — NOT that a report was published, and certainly not what
 * it said; this app has no filing or transcript source. And Yahoo's date is
 * sometimes its own projection, which must not be printed as a fixture. Both
 * are stated the way the earlier wording did not: "earnings reported
 * 2026-08-20" asserted a report nobody had seen, in the one place — the Feed
 * and the digest email — where the claim travels furthest from its evidence.
 */
export function signalHeadline(input: {
  ticker: string;
  lean: HoldingLean;
  passedEarnings: string | null;
  upcomingEarnings: string | null;
  earningsDateIsEstimate?: boolean;
  changes: FundamentalChange[];
}): string {
  const reasons: string[] = [];
  const estimated = input.earningsDateIsEstimate ? " (estimated)" : "";
  if (input.passedEarnings) {
    reasons.push(`earnings date ${input.passedEarnings} has passed${estimated}`);
  } else if (input.upcomingEarnings) {
    reasons.push(`earnings date ${input.upcomingEarnings}${estimated}`);
  }
  if (input.changes.length === 1) reasons.push(`${input.changes[0].label.toLowerCase()} moved`);
  else if (input.changes.length > 1) reasons.push(`${input.changes.length} fundamentals moved`);
  const why = reasons.length > 0 ? reasons.join(", ") : "a scheduled re-check";
  return `${input.ticker}: ${why} — Jarvis leans ${input.lean}`;
}

/**
 * Feed priority. `red` is reserved for a lean to get out, because the rail it
 * shares is the one that carries breached stops.
 */
export function signalPriority(lean: HoldingLean): "red" | "amber" | "blue" {
  if (lean === "EXIT") return "red";
  if (lean === "TRIM") return "amber";
  return "blue";
}

/**
 * What an import writes into `theses.input_text` when the trader gave no
 * reason. The column is NOT NULL, so it always says something.
 *
 * This lives here, next to the watch that reads it, because two copies of this
 * string is a silent bug: the import writes it and the review path compares
 * against it, and the day one is reworded the other stops matching. The review
 * would then hand the model "Imported holding — HAL." as a stated thesis and
 * ask it to judge whether that still holds.
 */
export function importRationalePlaceholder(ticker: string): string {
  return `Imported holding — ${ticker}. No stated reason recorded at import.`;
}

/**
 * The trader's own words, or `null` when all that was ever recorded is the
 * placeholder above. Null is the honest value — the review prompt handles
 * "no stated reason" explicitly and says so in its answer, which is a far
 * better outcome than grading a sentence the trader never wrote.
 */
export function statedRationale(inputText: string | null, ticker: string): string | null {
  if (!inputText) return null;
  const trimmed = inputText.trim();
  if (trimmed === "" || trimmed === importRationalePlaceholder(ticker)) return null;
  return inputText;
}
