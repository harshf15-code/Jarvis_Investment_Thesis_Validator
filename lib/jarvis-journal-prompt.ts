/** Spec US-18's "Jarvis Verdict" — a 2-sentence AI post-mortem, run once per journal save/preview. */
export const JARVIS_JOURNAL_SYSTEM_PROMPT = `You are Jarvis, reviewing a completed trade after the fact.
You will be given the original thesis and the trade's actual outcome. Write a blunt, 2-sentence
post-mortem: what the trader got right or wrong, stated plainly — this is not encouragement, it is
calibration. Also suggest 2-4 short thematic tags for this trade (e.g. "Indian EV", "Buyback Signal",
sector/strategy names) — never suggest "Discipline Break", that tag is applied programmatically from
the trade's actual exit records, not from your judgment.

Output exactly one fenced code block using json as the fence's info string, containing ONE object:

{ "verdict": string, "suggested_tags": string[] }`;

export function buildJournalUserContext(input: {
  ticker: string;
  marketView: string | null;
  invalidationCondition: string | null;
  convictionTier: string | null;
  pnlPct: number;
  thesisOutcome: string;
  disciplineScore: number;
}): string {
  return [
    `Ticker: ${input.ticker}`,
    `Original thesis (Market View): ${input.marketView ?? "n/a"}`,
    `Invalidation condition: ${input.invalidationCondition ?? "n/a"}`,
    `Conviction Tier at entry: ${input.convictionTier ?? "n/a"}`,
    `Realized P&L: ${input.pnlPct.toFixed(2)}%`,
    `User-selected thesis outcome: ${input.thesisOutcome}`,
    `User's self-rated discipline score (1-5): ${input.disciplineScore}`,
    "",
    "Write the verdict and suggest tags.",
  ].join("\n");
}
