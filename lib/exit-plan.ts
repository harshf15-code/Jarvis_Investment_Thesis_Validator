import { z } from "zod";

import { buildFundamentalsBlock, buildHoldingFactsBlock } from "@/lib/holding-watch";
import { extractTrailingJsonBlock } from "@/lib/jarvis-thesis-parser";

/**
 * The exit plan Jarvis proposes for a holding the trader already owns.
 *
 * WHY THIS IS NOT THE MEMORANDUM'S TRADE PLAN. A memorandum plans a trade the
 * trader has not made yet, so its geometry is anchored on an entry zone: the
 * stop sits below where you intend to buy, the targets above it. Here the
 * shares are already bought. There is no entry zone, only a price paid in the
 * past and a price on the screen now, and every level has to be judged against
 * the latter. `sanitizeTradePlanGeometry` (`lib/jarvis-thesis-parser.ts`) reads
 * `entry_zone_*` / `add_tranche_*` to build its floor and ceiling; with both
 * null — which they always are for an imported holding — those are null too and
 * EVERY relational check it makes is silently skipped, leaving only a
 * positivity filter. Reusing it here would look like validation and do almost
 * nothing, which is worse than no validation at all.
 */

const str = z.string().nullable().catch(null);
const numOrNull = z.number().nullable().catch(null);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The `trade_plans` columns this feature writes. Named once so the route, the
 *  diff against `ai_suggested` and the panel cannot disagree about the set. */
export const EXIT_PLAN_FIELDS = [
  "stop_loss",
  "target_1",
  "target_2",
  "time_exit_date",
  "time_exit_condition",
] as const;

export type ExitPlanField = (typeof EXIT_PLAN_FIELDS)[number];

/** Just the numbers — what gets written, what gets diffed, what gets edited. */
export type ExitPlanLevels = {
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  time_exit_date: string | null;
  time_exit_condition: string | null;
};

/**
 * Same discipline as `HoldingReadSchema`: every soft field nullable with
 * `.catch`, so a thin answer costs that field rather than the whole proposal.
 * A missing `target_2` is a plan with one target; a rejected document is no
 * plan at all and a model call already paid for.
 */
export const ExitPlanProposalSchema = z.object({
  stop_loss: numOrNull,
  target_1: numOrNull,
  target_2: numOrNull,
  time_exit_date: str,
  time_exit_condition: str,
  /** One short line per level. The trader is being asked to approve numbers
   *  built on a thin basis; a number with no stated reason is not reviewable,
   *  it is just a number. */
  reasoning: z
    .object({
      stop_loss: str,
      target_1: str,
      target_2: str,
      time_exit: str,
    })
    .catch({ stop_loss: null, target_1: null, target_2: null, time_exit: null }),
  /** The facts the levels rest on, as the model understood them — the same
   *  role `grounded_in` plays on a holding read. */
  grounded_in: z.array(z.string()).catch([]),
});

export type ExitPlanProposal = z.infer<typeof ExitPlanProposalSchema>;

export type ExitPlanParse =
  | { ok: true; data: ExitPlanProposal }
  | { ok: false; error: string };

/** Same never-throws contract as every other Jarvis parser. */
export function parseExitPlanProposal(raw: string): ExitPlanParse {
  try {
    const json = extractTrailingJsonBlock(raw);
    if (json === null) {
      return { ok: false, error: "No valid ```json code block found in the proposal." };
    }
    const result = ExitPlanProposalSchema.safeParse(json);
    if (!result.success) {
      return { ok: false, error: `Proposal failed schema validation: ${result.error.message}` };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Today in UTC — the same convention the holding watch uses for calendar
 *  dates, which have no user timezone to be local to. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Position-appropriate geometry: a stop below where it trades now, targets
 * above it, the second above the first.
 *
 * Drops a bad level to null rather than rejecting the document. This runs on
 * JARVIS's proposal, where a level that fails is one the trader is better off
 * filling in themselves than being shown and asked to trust — the panel renders
 * a null as an empty, editable field. The trader's OWN numbers go through
 * `validateApprovedLevels` instead, which refuses rather than discards.
 *
 * With no current price only positivity and ordering can be checked; the route
 * refuses to propose at all in that case, so this is a belt-and-braces path.
 */
export function sanitizeExitPlanGeometry<T extends ExitPlanLevels>(
  levels: T,
  currentPrice: number | null,
  today: string = utcToday(),
): T {
  const out: T = { ...levels };

  const positive = (v: number | null) => (v != null && Number.isFinite(v) && v > 0 ? v : null);
  out.stop_loss = positive(out.stop_loss);
  out.target_1 = positive(out.target_1);
  out.target_2 = positive(out.target_2);

  if (currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0) {
    // A stop at or above the current price is not a stop, it is a market sell
    // order that would fire the moment it was written.
    if (out.stop_loss != null && out.stop_loss >= currentPrice) out.stop_loss = null;
    // A target at or below the current price has already been reached, so it
    // would render as HIT the instant it was saved and tell the trader nothing.
    if (out.target_1 != null && out.target_1 <= currentPrice) out.target_1 = null;
    if (out.target_2 != null && out.target_2 <= currentPrice) out.target_2 = null;
  }

  // Ordering last, so a target dropped above does not leave the survivor
  // measured against a level that no longer exists.
  if (out.target_1 != null && out.target_2 != null && out.target_2 <= out.target_1) {
    out.target_2 = null;
  }
  // T2 without T1 reads as "the first trim never happens". Promote it rather
  // than losing a level the model did have a view on.
  if (out.target_1 == null && out.target_2 != null) {
    out.target_1 = out.target_2;
    out.target_2 = null;
  }

  if (out.time_exit_date != null) {
    const d = out.time_exit_date.trim();
    const wellFormed = ISO_DATE.test(d) && !Number.isNaN(Date.parse(d));
    // A time exit already in the past would fire on the very next poll.
    out.time_exit_date = wellFormed && d > today ? d : null;
  }
  if (out.time_exit_date == null) out.time_exit_condition = null;

  return out;
}

export type ExitPlanValidation = { ok: true } | { ok: false; error: string };

/**
 * The same geometry, applied to the TRADER's approved numbers — but refusing
 * instead of discarding.
 *
 * Silently nulling a level someone deliberately typed is the worst of both: the
 * save succeeds, the number is gone, and nothing says why. Jarvis's proposal
 * gets sanitized because there is a human about to review it; the human's own
 * edit gets an error message.
 *
 * WHY THE STOP IS CHECKED AGAINST THE PRICE AND THE TARGETS ARE NOT. The two
 * levels do not mean the same thing, so they do not deserve the same rule.
 *
 * A stop at or above the current price is never intentional. `poll-prices`
 * fires on `price <= stop_loss`, so saving one produces a stop-breach alert on
 * the very next run — a "your thesis is broken, get out" on a position that is
 * perfectly fine. There is no reading of a long position under which someone
 * meant that, so it is refused.
 *
 * A target at or below the current price IS legitimate: "I should have trimmed
 * at 4400 and I am past it — tell me to trim now." The ladder showing HIT and
 * the watch raising a trim alert are both true and both useful. Refusing it
 * would be the tool overruling the trader about their own book.
 *
 * `currentPrice` is optional so the pure ordering rules stay testable and so a
 * holding with no known price can still be given levels.
 */
export function validateApprovedLevels(
  levels: ExitPlanLevels,
  currentPrice?: number | null,
): ExitPlanValidation {
  for (const field of ["stop_loss", "target_1", "target_2"] as const) {
    const v = levels[field];
    if (v == null) continue;
    if (!Number.isFinite(v) || v <= 0) {
      return { ok: false, error: `${LEVEL_LABEL[field]} has to be a number above zero.` };
    }
  }
  const { stop_loss, target_1, target_2 } = levels;
  if (stop_loss != null && target_1 != null && stop_loss >= target_1) {
    return { ok: false, error: "Your stop has to sit below your first target." };
  }
  if (target_1 != null && target_2 != null && target_2 <= target_1) {
    return { ok: false, error: "Your second target has to sit above your first." };
  }
  if (target_1 == null && target_2 != null) {
    return { ok: false, error: "Set a first target before a second one." };
  }
  if (
    currentPrice != null &&
    Number.isFinite(currentPrice) &&
    currentPrice > 0 &&
    stop_loss != null &&
    stop_loss >= currentPrice
  ) {
    return {
      ok: false,
      error: `A stop at ${stop_loss} sits at or above the current price of ${currentPrice}, so it would read as breached the moment you saved it. Put it below where the holding trades now.`,
    };
  }
  if (levels.time_exit_date != null) {
    const d = levels.time_exit_date.trim();
    if (!ISO_DATE.test(d) || Number.isNaN(Date.parse(d))) {
      return { ok: false, error: "That time exit isn't a valid date." };
    }
  }
  return { ok: true };
}

export const LEVEL_LABEL: Record<"stop_loss" | "target_1" | "target_2", string> = {
  stop_loss: "The stop",
  target_1: "Target 1",
  target_2: "Target 2",
};

/**
 * Whether this plan already has something for the ladder and the price watch
 * to track.
 *
 * The panel's predicate for choosing between "build" and "rebuild" copy. The
 * route deliberately does NOT gate on it: a rebuild is always allowed (the
 * trader confirms the overwrite first), so a POST against a plan that already
 * carries levels is a legitimate request rather than one to refuse.
 */
export function hasExitLevels(
  plan: { stop_loss: number | null; target_1: number | null; target_2: number | null } | null,
): boolean {
  if (!plan) return false;
  return plan.stop_loss != null || plan.target_1 != null || plan.target_2 != null;
}

/** Which approved fields differ from what Jarvis proposed — `edited_fields`. */
export function diffExitPlan(proposed: ExitPlanLevels, approved: ExitPlanLevels): string[] {
  return EXIT_PLAN_FIELDS.filter((f) => proposed[f] !== approved[f]);
}

/* ------------------------------------------------------------------------- *
 * Prompt
 * ------------------------------------------------------------------------- */

export const EXIT_PLAN_SYSTEM_PROMPT = `You are Jarvis, proposing an exit plan for one holding a trader ALREADY OWNS.

WHAT THIS IS
They imported this position from a broker CSV, so it has no stop and no targets — every rung of
their exit ladder reads PENDING and nothing can alert them. You are filling that in. They will
review every number you give and can change any of it before anything is saved.

WHAT YOU ARE AND ARE NOT LOOKING AT
You have the position, its current price, its current fundamentals, and the reason the trader
recorded for owning it. You have NO news, NO transcripts, NO analyst notes, NO price history,
NO technical levels and NO search. You have not seen a chart.

HARD RULES
- The shares are already bought. Do NOT propose an entry zone, an add tranche or a position size —
  those decisions are behind them.
- stop_loss must be BELOW the current price. target_1 must be ABOVE it. target_2 must be above
  target_1. A level that cannot satisfy this should be null, not fudged.
- Anchor the stop on what would BREAK THE STATED REASON, not on a round percentage. If the reason
  is a policy tailwind, say what price would mean the market has stopped believing it. If you
  cannot ground the stop in their reason, say so in the reasoning and place it conservatively.
- NEVER invent a number you were not given. If a fundamental is absent, it is absent.
- NEVER cite a support level, a moving average, a 52-week low or a chart pattern. You cannot see
  price history and asserting one would be fabrication.
- A time exit is optional and usually wrong. Propose one only when the stated reason is explicitly
  time-bound (a catalyst by a date, a cycle that is expected to turn); otherwise null.
- Your reasoning per level is ONE short sentence. Say what the number is for, not what it is.

TONE
Short declarative sentences. This trader has real money in this position already.

OUTPUT
Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else — no prose before or after it. Use null for anything you cannot responsibly
determine. Shape:

{
  "stop_loss": number | null,
  "target_1": number | null,
  "target_2": number | null,
  "time_exit_date": "YYYY-MM-DD" | null,
  "time_exit_condition": string | null,
  "reasoning": {
    "stop_loss": string | null,
    "target_1": string | null,
    "target_2": string | null,
    "time_exit": string | null
  },
  "grounded_in": [string]
}

Prices are plain numbers in the holding's own currency — no symbols, no commas, no ranges.
"grounded_in" is 1-4 short strings, each naming one concrete fact you used. Valid JSON: no
trailing commas.`;

export function buildExitPlanUserContext(input: {
  ticker: string;
  companyName: string | null;
  currency: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  /** Never null here — the route refuses to propose without one. */
  rationale: string;
  objective: string | null;
  heldSince: string | null;
  fundamentals: Record<string, string | number>;
  today?: string;
}): string {
  const lines: string[] = [];

  lines.push(
    "Propose an exit plan for this holding. It is already owned; you are setting the levels that will govern when the trader is told to act.",
  );
  lines.push("");
  lines.push(...buildHoldingFactsBlock(input));
  lines.push("");
  lines.push(...buildFundamentalsBlock(input.fundamentals));
  lines.push("");
  lines.push("WHAT YOUR NUMBERS ARE MEASURED AGAINST");
  lines.push(
    `The current price is ${input.currentPrice} ${input.currency}. Your stop must be below it and both targets above it. Today's date is ${input.today ?? utcToday()}.`,
  );
  lines.push("");
  lines.push("Give the plan.");
  return lines.join("\n");
}
