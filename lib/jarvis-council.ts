import { z } from "zod";

import { extractTrailingJsonBlock } from "@/lib/jarvis-thesis-parser";
import { SHOWN_FUNDAMENTALS, VerdictEnum, type Memorandum } from "@/lib/jarvis-memorandum";
import { MARKETS } from "@/lib/markets";
import type { CouncilMember, MarketCode, ThesisCandidate } from "@/lib/types";

/**
 * The Investment Council: N independent persona reviews of an ALREADY-WRITTEN
 * memorandum, plus one synthesis pass over them.
 *
 * Every memorandum is a single model call shown with total confidence. The
 * Council exists to break that — and specifically to make DISAGREEMENT visible,
 * which is why each member re-judges the whole candidate field rather than
 * merely critiquing the pick. "The macro read wants the liquid name, not the
 * cheap one" is information; three paragraphs of hedging is not.
 *
 * Two rules shape the schemas, both inherited from `lib/jarvis-memorandum.ts`:
 *
 * 1. Almost every field is nullable with `.catch`. A thin answer should cost
 *    that field, not the member's whole card.
 * 2. A member's card NEVER renders blank. If the call or the parse fails, the
 *    card carries the specific error instead — see `CouncilMemberOpinionSchema`.
 */

const str = z.string().nullable().catch(null);

/** One persona's read on the field. */
export const CouncilOpinionSchema = z.object({
  verdict: VerdictEnum.catch("WATCH"),
  /**
   * The name THIS member would own, which may differ from Jarvis's pick, or be
   * null for "none of this field".
   *
   * Guaranteed by `normalizeCouncilReport` to be a ticker that is actually in
   * the priced grid — see the note there.
   */
  preferred_ticker: str,
  /** One line. The stance, before the reasoning. */
  headline: str,
  reasoning: str,
  biggest_risk: str,
});

export type CouncilOpinion = z.infer<typeof CouncilOpinionSchema>;

/**
 * One roster member's slot in the report — which always exists, even when the
 * call for it failed.
 *
 * `opinion` and `error` are exclusive: exactly one is non-null. A member whose
 * call failed gets a card saying so, because this app's rule is that a missing
 * answer is stated, never silently rendered as an empty section.
 */
export const CouncilMemberOpinionSchema = z.object({
  member_id: z.string(),
  member_name: z.string(),
  source: z.enum(["builtin", "custom"]).catch("custom"),
  opinion: CouncilOpinionSchema.nullable(),
  error: str,
});

export type CouncilMemberOpinion = z.infer<typeof CouncilMemberOpinionSchema>;

export const CouncilSynthesisSchema = z.object({
  combined_verdict: VerdictEnum.catch("WATCH"),
  summary: str,
  where_they_agree: z.array(z.string()).catch([]),
  where_they_diverge: z.array(z.string()).catch([]),
});

export type CouncilSynthesis = z.infer<typeof CouncilSynthesisSchema>;

/** The contract for `thesis_council_reports.document`. */
export const CouncilReportSchema = z.object({
  /** Jarvis's own pick at the time of the consult, so dissent stays legible. */
  jarvis_pick: z.string(),
  opinions: z.array(CouncilMemberOpinionSchema).min(1),
  /** Null when fewer than two members answered — see the route. */
  synthesis: CouncilSynthesisSchema.nullable(),
  generated_at: z.string(),
});

export type CouncilReport = z.infer<typeof CouncilReportSchema>;

/* ------------------------------------------------------------------------- *
 * Invariants
 * ------------------------------------------------------------------------- */

/**
 * Drops any `preferred_ticker` that is not in the priced candidate grid.
 *
 * This is the same defect migration 0016 was written to kill, arriving through
 * a new door. A persona asked to name the stock it would own will happily name
 * one that is not on the list — and a ticker rendered under a verdict badge
 * reads as a recommendation whether or not anybody priced it. Under the old
 * failure a robotics thesis concluded a barcode company; here it would be a
 * name with no price, no exchange, and no way to enter or exit.
 *
 * The reasoning survives — the member's argument is still worth reading, it
 * just no longer carries a buy-shaped ticker the system never validated.
 * Enforced after the parse rather than asked for in the prompt, because a
 * prompt is a request and this is an invariant.
 */
export function normalizeCouncilReport(
  report: CouncilReport,
  validTickers: readonly string[],
): CouncilReport {
  const allowed = new Set(validTickers.map((t) => t.trim().toUpperCase()));
  return {
    ...report,
    opinions: report.opinions.map((m) => {
      if (!m.opinion) return m;
      const t = m.opinion.preferred_ticker?.trim().toUpperCase() ?? null;
      const kept = t && allowed.has(t) ? t : null;
      return { ...m, opinion: { ...m.opinion, preferred_ticker: kept } };
    }),
  };
}

export type CouncilTally = {
  /** Members whose call came back at all. */
  answered: number;
  failed: number;
  buy: number;
  watch: number;
  avoid: number;
  /**
   * Members who did NOT land on Jarvis's pick — either they named a different
   * name, or none at all.
   */
  dissenting: number;
};

/**
 * The headline numbers, computed from the opinions rather than asked of the
 * model. It is arithmetic over cards the trader can see, and a model-supplied
 * count that disagreed with them would be worse than no count at all.
 */
export function councilTally(report: CouncilReport): CouncilTally {
  const pick = report.jarvis_pick.trim().toUpperCase();
  const tally: CouncilTally = {
    answered: 0,
    failed: 0,
    buy: 0,
    watch: 0,
    avoid: 0,
    dissenting: 0,
  };
  for (const m of report.opinions) {
    if (!m.opinion) {
      tally.failed += 1;
      continue;
    }
    tally.answered += 1;
    if (m.opinion.verdict === "BUY") tally.buy += 1;
    else if (m.opinion.verdict === "AVOID") tally.avoid += 1;
    else tally.watch += 1;
    if ((m.opinion.preferred_ticker?.trim().toUpperCase() ?? null) !== pick) {
      tally.dissenting += 1;
    }
  }
  return tally;
}

/* ------------------------------------------------------------------------- *
 * Prompts
 * ------------------------------------------------------------------------- */

/**
 * Built per member from their `philosophy`, which is the only thing grounding
 * the persona — there is no retrieval, no source documents. That is a v1
 * decision, and it is why `philosophy` has a length floor in the schema.
 */
export function buildCouncilOpinionSystemPrompt(member: {
  name: string;
  philosophy: string;
}): string {
  return `You are role-playing ${member.name} reviewing another analyst's investment memorandum.

THE PHILOSOPHY YOU ARGUE FROM
${member.philosophy}

You are a simulation, and the trader reading you knows it. That is freeing, not limiting: do not
hedge to protect a reputation, and do not soften a judgement to be agreeable. Argue the position
this philosophy actually implies, including "I would not own any of these."

WHAT YOU ARE DOING
You are given a thesis, a memorandum another system wrote, and every candidate it priced. Judge
the WHOLE FIELD, not just the pick. If a different name on the list fits your philosophy better,
say so and name it. If none of them do, say that instead.

HARD RULES
- "preferred_ticker" MUST be one of the tickers supplied to you, or null. NEVER name a company
  that is not on the list — an unpriced name cannot be bought, sized or exited, so proposing one
  is worse than proposing nothing.
- Use the supplied prices and fundamentals as ground truth. NEVER invent a number.
- Disagreement is the point. If you genuinely agree with the memorandum, say so plainly and say
  what would change your mind — do not manufacture a dissent to seem rigorous.
- "biggest_risk" is the ONE thing you would watch that would prove this wrong. One risk, named
  concretely, not a list of generic caveats.

TONE
Short declarative sentences, in the register the philosophy above implies. You are talking to one
trader about to risk real money.

OUTPUT
Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else — no prose before or after it. Use null for anything you cannot responsibly
determine. Shape:

{
  "verdict": "BUY" | "WATCH" | "AVOID",
  "preferred_ticker": string | null,
  "headline": string,
  "reasoning": string,
  "biggest_risk": string
}

"headline" is one sentence. "reasoning" is 3-5 sentences. Valid JSON: no trailing commas.`;
}

/**
 * The shared briefing every member reads — the same thesis, the same grid, the
 * same memorandum. No live market calls happen per persona: this is built
 * entirely from what the memorandum run already fetched and persisted, so a
 * seven-member consult costs seven model calls and zero quote lookups.
 */
export function buildCouncilOpinionUserContext(input: {
  thesisText: string;
  market: MarketCode;
  memo: Memorandum;
  candidates: ThesisCandidate[];
}): string {
  const { memo, candidates, market } = input;
  const meta = MARKETS[market];
  const lines: string[] = [];

  lines.push(`Market: ${meta.label} — priced in ${meta.currency}.`);
  lines.push("");
  lines.push("THESIS AS THE TRADER STATED IT");
  lines.push(input.thesisText);
  lines.push("");
  lines.push("THE CANDIDATE FIELD — every name that was priced");
  for (const c of candidates) {
    lines.push("");
    lines.push(`- Ticker: ${c.ticker}${c.company_name ? ` (${c.company_name})` : ""}`);
    lines.push(
      c.cmp != null ? `  Current price: ${c.cmp}` : "  Current price: UNAVAILABLE",
    );
    if (c.valuation_metric) lines.push(`  Valuation: ${c.valuation_metric}`);
    if (c.market_cap) lines.push(`  Market cap: ${c.market_cap}`);
    if (c.operational_share) lines.push(`  Operational share: ${c.operational_share}`);
    if (c.range_low != null && c.range_high != null) {
      lines.push(`  52-week range: ${c.range_low} – ${c.range_high}`);
    }
    const f = (c.fundamentals ?? {}) as Record<string, string | number>;
    for (const [k, label] of SHOWN_FUNDAMENTALS) {
      if (f[k] !== undefined) lines.push(`  ${label}: ${f[k]}`);
    }
  }

  lines.push("");
  lines.push("THE MEMORANDUM YOU ARE REVIEWING");
  lines.push(`Title: ${memo.header.title ?? "—"}`);
  lines.push(`Its pick: ${memo.primary_ticker}`);
  lines.push(`Market view: ${memo.thesis.market_view ?? "—"}`);
  lines.push(`Mispricing: ${memo.thesis.mispricing ?? "—"}`);
  if (memo.thesis.catalysts.length) {
    lines.push(`Catalysts: ${memo.thesis.catalysts.join("; ")}`);
  }
  lines.push(`Time horizon / invalidation: ${memo.thesis.time_horizon_invalidation ?? "—"}`);
  if (memo.thesis.conviction_score != null) {
    lines.push(`Its conviction: ${memo.thesis.conviction_score}/100`);
  }
  if (memo.stress_test.failure_modes.length) {
    lines.push("");
    lines.push("Failure modes it already considered:");
    for (const fm of memo.stress_test.failure_modes) {
      lines.push(`- ${fm.title ?? "—"}: ${fm.bear_case ?? "—"} (its counter: ${fm.counter ?? "—"})`);
    }
  }
  const n = memo.trade_plan.numeric;
  lines.push("");
  lines.push(
    `Its trade plan: entry ${n.entry_zone_low ?? "—"}–${n.entry_zone_high ?? "—"}, ` +
      `stop ${n.stop_loss ?? "—"}, targets ${n.target_1 ?? "—"} / ${n.target_2 ?? "—"}, ` +
      `size ${n.position_size_pct ?? "—"}% of portfolio.`,
  );

  lines.push("");
  lines.push(
    `Valid tickers for "preferred_ticker": ${candidates.map((c) => c.ticker).join(", ")} (or null).`,
  );
  lines.push("Give your opinion.");
  return lines.join("\n");
}

export const JARVIS_COUNCIL_SYNTHESIS_SYSTEM_PROMPT = `You are Jarvis, summarising an investment council for the trader who convened it.

You are given several independent opinions on the same memorandum, each from a reviewer arguing a
different investing philosophy. Produce ONE combined read.

HARD RULES
- SURFACE THE DISAGREEMENT. A summary that blends dissent into a neutral paragraph destroys the
  entire value of having asked several people. Where they split, name who took which side and on
  what grounds.
- If they genuinely converged, say so plainly — do not manufacture a split.
- Every claim must come from the opinions given to you. Do not introduce a new argument, a new
  risk or a new ticker of your own.
- "combined_verdict" reflects where the weight of the panel actually lands, not an average. Three
  reviewers at WATCH for three unrelated reasons is not the same as three at BUY.

TONE
Direct, compressed. The trader reads this first and the individual cards second.

OUTPUT
Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else. Shape:

{
  "combined_verdict": "BUY" | "WATCH" | "AVOID",
  "summary": string,
  "where_they_agree": [string],
  "where_they_diverge": [string]
}

"summary" is 2-4 sentences. 1-3 entries in each array, each one sentence naming the reviewers
involved. Valid JSON: no trailing commas.`;

export function buildCouncilSynthesisUserContext(input: {
  jarvisPick: string;
  opinions: { name: string; opinion: CouncilOpinion }[];
}): string {
  const lines: string[] = [];
  lines.push(`The memorandum's own pick was ${input.jarvisPick}.`);
  lines.push("");
  lines.push("THE OPINIONS");
  for (const { name, opinion } of input.opinions) {
    lines.push("");
    lines.push(`- ${name} — ${opinion.verdict}`);
    lines.push(`  Would own: ${opinion.preferred_ticker ?? "none of this field"}`);
    if (opinion.headline) lines.push(`  Headline: ${opinion.headline}`);
    if (opinion.reasoning) lines.push(`  Reasoning: ${opinion.reasoning}`);
    if (opinion.biggest_risk) lines.push(`  Biggest risk: ${opinion.biggest_risk}`);
  }
  lines.push("");
  lines.push("Produce the combined council read.");
  return lines.join("\n");
}

/* ------------------------------------------------------------------------- *
 * Parsing
 * ------------------------------------------------------------------------- */

export type CouncilParse<T> = { ok: true; data: T } | { ok: false; error: string };

/** Same never-throws contract as every other Jarvis parser. */
function parseFenced<T>(raw: string, schema: z.ZodType<T>, what: string): CouncilParse<T> {
  try {
    const json = extractTrailingJsonBlock(raw);
    if (json === null) {
      return { ok: false, error: `No valid \`\`\`json code block found in the ${what}.` };
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      return { ok: false, error: `${what} failed schema validation: ${result.error.message}` };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function parseCouncilOpinion(raw: string): CouncilParse<CouncilOpinion> {
  return parseFenced(raw, CouncilOpinionSchema, "opinion");
}

export function parseCouncilSynthesis(raw: string): CouncilParse<CouncilSynthesis> {
  return parseFenced(raw, CouncilSynthesisSchema, "synthesis");
}

/* ------------------------------------------------------------------------- *
 * Roster
 * ------------------------------------------------------------------------- */

/** The roster cap, mirrored by a trigger in migration 0017. */
export const COUNCIL_ROSTER_MAX = 7;
/** Below this a consult is not a council, it is a second opinion. */
export const COUNCIL_CONSULT_MIN = 3;

export const CouncilMemberInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
  philosophy: z
    .string()
    .trim()
    .min(40, "Describe the philosophy in 2-4 sentences — a name alone gives the model nothing to imitate")
    .max(600, "Keep the philosophy under 600 characters"),
});

/**
 * Shown on every surface that renders a persona. Deliberately a constant rather
 * than three hand-written strings, so it cannot drift out of sync between the
 * roster, the picker and the report.
 */
export const COUNCIL_DISCLAIMER =
  "AI-simulated persona based on publicly known investing philosophy — not the real person's opinion, and not affiliated with or endorsed by them.";

export type CouncilMemberForPrompt = Pick<CouncilMember, "id" | "name" | "philosophy" | "source">;
