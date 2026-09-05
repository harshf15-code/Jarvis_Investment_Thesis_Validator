import { z } from "zod";

import { extractTrailingJsonBlock } from "@/lib/jarvis-thesis-parser";
import { COUNCIL_DISCLAIMER } from "@/lib/jarvis-council";
import type { AssetClass } from "@/lib/types";

/**
 * The Investment Council consulted on the WHOLE BOOK.
 *
 * Same roster, same personas, same disclaimer as the thesis-level Council —
 * and a different question. A memorandum asks "should I own this one"; this
 * asks "does this collection of things make sense together", which is the
 * thing an actual advisor would look at first.
 *
 * Two rules inherited from `lib/jarvis-council.ts`, both load-bearing:
 *
 * 1. Nearly every field is nullable with `.catch`. A thin answer costs that
 *    field, not the member's whole card.
 * 2. A member's card NEVER renders blank. If the call or the parse fails, the
 *    card carries the specific error instead.
 */

export { COUNCIL_DISCLAIMER };

const str = z.string().nullable().catch(null);

export const HoldingCallEnum = z.enum(["TRIM", "ADD", "HOLD"]);
export type HoldingCall = z.infer<typeof HoldingCallEnum>;

/**
 * One member's view on one position.
 *
 * A member gives a call ONLY on holdings they have a real view on, so this
 * array is a subset of the book by design — see the system prompt. A full
 * member × holding matrix would be a wall of low-conviction HOLDs: output
 * nobody reads, tokens nobody wanted, and a grid in which the two calls that
 * actually mattered are invisible.
 */
export const HoldingCallSchema = z.object({
  ticker: z.string(),
  call: HoldingCallEnum.catch("HOLD"),
  reason: str,
});

export const PortfolioStructuralReadSchema = z.object({
  concentration: str,
  diversification: str,
  sizing: str,
  cash: str,
});

export const PortfolioOpinionSchema = z.object({
  /** One line. The stance, before the reasoning. */
  headline: str,
  structural_read: PortfolioStructuralReadSchema,
  holding_calls: z.array(HoldingCallSchema).catch([]),
  /** The ONE thing about this book's construction they would fix first. */
  biggest_risk: str,
});

export type PortfolioOpinion = z.infer<typeof PortfolioOpinionSchema>;

/** One roster member's slot in the report — which always exists. */
export const PortfolioMemberOpinionSchema = z.object({
  member_id: z.string(),
  member_name: z.string(),
  source: z.enum(["builtin", "custom"]).catch("custom"),
  opinion: PortfolioOpinionSchema.nullable(),
  error: str,
});

export type PortfolioMemberOpinion = z.infer<typeof PortfolioMemberOpinionSchema>;

export const PortfolioSynthesisSchema = z.object({
  summary: str,
  where_they_agree: z.array(z.string()).catch([]),
  where_they_diverge: z.array(z.string()).catch([]),
  /** Tickers the panel converged on trimming or adding, as a headline. */
  loudest_calls: z.array(z.string()).catch([]),
});

export type PortfolioSynthesis = z.infer<typeof PortfolioSynthesisSchema>;

/** The contract for `portfolio_council_reports.document`. */
export const PortfolioCouncilReportSchema = z.object({
  opinions: z.array(PortfolioMemberOpinionSchema).min(1),
  /** Null when there is no combined read — `synthesis_skipped` says why. */
  synthesis: PortfolioSynthesisSchema.nullable(),
  /**
   * Why the combined read is missing. `too_few` means fewer than two members
   * answered and asking would have been spend without information; `failed`
   * means the call or its parse did not come back. Two different facts, and
   * reporting the first when the second happened contradicts the tally shown
   * beside it. Nullable with `.catch` so a report written before this field
   * existed still renders.
   */
  synthesis_skipped: z.enum(["too_few", "failed"]).nullable().catch(null),
  generated_at: z.string(),
});

export type PortfolioCouncilReport = z.infer<typeof PortfolioCouncilReportSchema>;

/* ------------------------------------------------------------------------- *
 * The book
 * ------------------------------------------------------------------------- */

export type CouncilHolding = {
  ticker: string;
  companyName: string | null;
  currency: string;
  /** Equity or coin. Drives the exposure block, and is why a coin arrives with
   *  no fundamentals rather than with an empty-looking set of them. */
  assetClass: AssetClass;
  quantity: number;
  averagePrice: number;
  /** Freshly fetched. Null when the listing would not price at consult time. */
  currentPrice: number | null;
  fundamentals: Record<string, string | number>;
  /** The trader's own words, when they recorded any. */
  rationale: string | null;
  hasTradePlan: boolean;
  imported: boolean;
};

export type CurrencyBook = {
  currency: string;
  costBasis: number;
  marketValue: number;
  /** Share of this sub-book's market value by asset class, biggest first.
   *  Empty when nothing in the sub-book would price. */
  exposure: { assetClass: AssetClass; marketValue: number; pct: number }[];
  holdings: (CouncilHolding & {
    /** Share of THIS currency's book by market value, 0-100. */
    weightPct: number | null;
  })[];
};

/**
 * Collapses two open positions in the same listing into one holding.
 *
 * A trader can hold the same ticker through separate theses, and the report's
 * per-holding table already renders one row per ticker. Left un-aggregated the
 * panel is shown INFY twice at 45% each and judges the concentration of
 * neither — the one number a structural read most depends on. Quantities add,
 * the cost basis is re-weighted across both, and the rationale of each is kept
 * so nothing the trader wrote is dropped.
 */
export function aggregateByListing(holdings: CouncilHolding[]): CouncilHolding[] {
  const byKey = new Map<string, CouncilHolding[]>();
  for (const h of holdings) {
    // Currency is part of the key: the same ticker on two markets is two
    // different instruments, which is the whole reason a batch names one.
    //
    // Asset class is part of it for the same reason, and the collision is not
    // hypothetical: a spot-Bitcoin trust can list under the very symbol its
    // coin uses. Without this, one USD book holding both collapses them into a
    // single row whose quantity adds coin units to share counts, whose price is
    // whichever leg priced first, and whose asset class is whichever leg was
    // seen first — a market value, a weight and an exposure figure all wrong at
    // once, with nothing on screen to suggest it.
    const key = `${h.ticker.toUpperCase()}|${h.currency}|${h.assetClass}`;
    byKey.set(key, [...(byKey.get(key) ?? []), h]);
  }

  return [...byKey.values()].map((group) => {
    if (group.length === 1) return group[0];
    const quantity = group.reduce((sum, h) => sum + h.quantity, 0);
    const cost = group.reduce((sum, h) => sum + h.averagePrice * h.quantity, 0);
    const rationales = group.map((h) => h.rationale).filter((r): r is string => !!r);
    return {
      ...group[0],
      quantity,
      averagePrice: quantity > 0 ? cost / quantity : 0,
      // Any priced leg gives the listing a price; they are the same listing.
      currentPrice: group.find((h) => h.currentPrice !== null)?.currentPrice ?? null,
      rationale: rationales.length > 0 ? rationales.join(" / ") : null,
      // Planned if ANY leg is planned; imported only if EVERY leg was.
      hasTradePlan: group.some((h) => h.hasTradePlan),
      imported: group.every((h) => h.imported),
    };
  });
}

/**
 * Splits the book by currency and computes weights WITHIN each currency.
 *
 * A weight is a share of a total, and there is no honest total across INR and
 * USD without an exchange rate — which this app does not hold, and which a
 * stale copy of would misstate silently. So the Council is shown sub-books and
 * told plainly that cross-currency concentration is outside what it can judge.
 * That is a real limit of this design rather than a rounding detail, and the
 * prompt states it rather than letting a persona infer a total that isn't there.
 *
 * A holding that would not price contributes no market value and gets a null
 * weight — it is still listed, because a position nobody can value is a fact
 * about the book worth seeing.
 */
/**
 * What share of one sub-book sits in each asset class.
 *
 * Computed WITHIN a currency for the same reason weights are: there is no
 * honest total across INR and USD without an exchange rate this app does not
 * hold. A cross-currency asset-class percentage would be the one number in the
 * whole prompt that quietly required an FX assumption.
 *
 * Unpriced holdings contribute nothing, exactly as they contribute no weight.
 * The percentages therefore describe the priced part of the book, and the
 * prompt says so rather than letting the panel read them as the whole.
 */
function exposureByAssetClass(
  list: CouncilHolding[],
  valueOf: (h: CouncilHolding) => number | null,
  marketValue: number,
): { assetClass: AssetClass; marketValue: number; pct: number }[] {
  if (marketValue <= 0) return [];
  const totals = new Map<AssetClass, number>();
  for (const h of list) {
    const value = valueOf(h);
    if (value === null) continue;
    totals.set(h.assetClass, (totals.get(h.assetClass) ?? 0) + value);
  }
  return [...totals.entries()]
    .map(([assetClass, value]) => ({
      assetClass,
      marketValue: value,
      pct: (value / marketValue) * 100,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);
}

export function splitByCurrency(holdings: CouncilHolding[]): CurrencyBook[] {
  const books = new Map<string, CouncilHolding[]>();
  for (const holding of holdings) {
    const list = books.get(holding.currency) ?? [];
    list.push(holding);
    books.set(holding.currency, list);
  }

  return [...books.entries()]
    .map(([currency, list]) => {
      const valueOf = (h: CouncilHolding) =>
        h.currentPrice === null ? null : h.currentPrice * h.quantity;
      const marketValue = list.reduce((sum, h) => sum + (valueOf(h) ?? 0), 0);
      const costBasis = list.reduce((sum, h) => sum + h.averagePrice * h.quantity, 0);
      return {
        currency,
        costBasis,
        marketValue,
        exposure: exposureByAssetClass(list, valueOf, marketValue),
        holdings: list
          .map((h) => {
            const value = valueOf(h);
            return {
              ...h,
              weightPct: value === null || marketValue <= 0 ? null : (value / marketValue) * 100,
            };
          })
          .sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1)),
      };
    })
    .sort((a, b) => b.costBasis - a.costBasis);
}

/* ------------------------------------------------------------------------- *
 * Invariants
 * ------------------------------------------------------------------------- */

/**
 * Drops any `holding_call` naming a ticker the trader does not actually hold.
 *
 * The same invariant as `normalizeCouncilReport`, for the same reason: a
 * ticker rendered under a TRIM badge reads as an instruction whether or not
 * anyone owns it, and "trim your NVDA" to someone with no NVDA is worse than
 * silence. Enforced after the parse rather than asked for in the prompt,
 * because a prompt is a request and this is an invariant.
 *
 * The structural read survives untouched — the member's argument about the
 * book's shape is still worth reading.
 */
export function normalizePortfolioCouncilReport(
  report: PortfolioCouncilReport,
  heldTickers: readonly string[],
): PortfolioCouncilReport {
  const held = new Set(heldTickers.map((t) => t.trim().toUpperCase()));
  const normalized: PortfolioCouncilReport = {
    ...report,
    opinions: report.opinions.map((m) => {
      if (!m.opinion) return m;
      const kept = m.opinion.holding_calls.filter((c) =>
        held.has(c.ticker.trim().toUpperCase()),
      );
      // Normalised so the UI can match a call to a position by ticker without
      // re-trimming and re-casing at every render.
      const calls = kept.map((c) => ({ ...c, ticker: c.ticker.trim().toUpperCase() }));
      return { ...m, opinion: { ...m.opinion, holding_calls: calls } };
    }),
  };

  // `loudest_calls` is model output about other model output, and the UI
  // renders it under "More than one member said the same thing". Left as
  // written it could name a ticker nobody holds — normalisation having just
  // stripped that very call from the cards — or promote a lone opinion into a
  // panel view. Recomputed from the normalised cards so the claim and the
  // evidence beneath it cannot disagree.
  if (normalized.synthesis) {
    normalized.synthesis = {
      ...normalized.synthesis,
      loudest_calls: consensusCalls(normalized),
    };
  }
  return normalized;
}

/**
 * Tickers where MORE THAN ONE member landed on the same TRIM or ADD.
 *
 * HOLD is excluded: it recommends no action, so "three members agree to do
 * nothing" is not a headline. A single member's call is an opinion, not a
 * panel view — which is exactly what the label above this list claims.
 */
export function consensusCalls(report: PortfolioCouncilReport): string[] {
  const votes = new Map<string, number>();
  for (const m of report.opinions) {
    if (!m.opinion) continue;
    for (const call of m.opinion.holding_calls) {
      if (call.call === "HOLD") continue;
      const key = `${call.ticker} ${call.call}`;
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
  }
  return [...votes.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

export type PortfolioTally = {
  answered: number;
  failed: number;
  /** Members who gave at least one call on a holding. */
  withCalls: number;
  trim: number;
  add: number;
  hold: number;
};

/**
 * The headline numbers, computed from the cards rather than asked of the
 * model. Arithmetic over things the trader can see; a model-supplied count
 * that disagreed with them would be worse than no count.
 */
export function portfolioCouncilTally(report: PortfolioCouncilReport): PortfolioTally {
  const tally: PortfolioTally = { answered: 0, failed: 0, withCalls: 0, trim: 0, add: 0, hold: 0 };
  for (const m of report.opinions) {
    if (!m.opinion) {
      tally.failed += 1;
      continue;
    }
    tally.answered += 1;
    if (m.opinion.holding_calls.length > 0) tally.withCalls += 1;
    for (const call of m.opinion.holding_calls) {
      if (call.call === "TRIM") tally.trim += 1;
      else if (call.call === "ADD") tally.add += 1;
      else tally.hold += 1;
    }
  }
  return tally;
}

/** Every call made about one ticker, across the panel. Drives the per-holding table. */
export function callsByTicker(
  report: PortfolioCouncilReport,
): Map<string, { member: string; call: HoldingCall; reason: string | null }[]> {
  const map = new Map<string, { member: string; call: HoldingCall; reason: string | null }[]>();
  for (const m of report.opinions) {
    if (!m.opinion) continue;
    for (const c of m.opinion.holding_calls) {
      const list = map.get(c.ticker) ?? [];
      list.push({ member: m.member_name, call: c.call, reason: c.reason });
      map.set(c.ticker, list);
    }
  }
  return map;
}

/* ------------------------------------------------------------------------- *
 * Parsing
 * ------------------------------------------------------------------------- */

export type PortfolioParse<T> = { ok: true; data: T } | { ok: false; error: string };

function parseFenced<T>(raw: string, schema: z.ZodType<T>, what: string): PortfolioParse<T> {
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

export function parsePortfolioOpinion(raw: string): PortfolioParse<PortfolioOpinion> {
  return parseFenced(raw, PortfolioOpinionSchema, "opinion");
}

export function parsePortfolioSynthesis(raw: string): PortfolioParse<PortfolioSynthesis> {
  return parseFenced(raw, PortfolioSynthesisSchema, "synthesis");
}

/* ------------------------------------------------------------------------- *
 * Prompts
 * ------------------------------------------------------------------------- */

/** Built per member from their `philosophy`, exactly as the thesis Council does. */
export function buildPortfolioOpinionSystemPrompt(member: {
  name: string;
  philosophy: string;
}): string {
  return `You are role-playing ${member.name} reviewing a private investor's entire portfolio.

THE PHILOSOPHY YOU ARGUE FROM
${member.philosophy}

You are a simulation, and the trader reading you knows it. That is freeing, not limiting: do not
hedge to protect a reputation, and do not soften a judgement to be agreeable. Say what this
philosophy actually implies about how this book is built, including "I would not hold most of this."

WHAT YOU ARE DOING
You are judging CONSTRUCTION, not stock-picking. Is this too concentrated, or so diversified it
cannot outperform? Is anything sized in a way that does not match its quality or its risk? Does the
shape of this book match what the investor says they are trying to do?

Then, and only where you genuinely have one, give a per-holding view.

HARD RULES
- Give a "holding_calls" entry ONLY for holdings you have a real view on. Silence on a position is
  a legitimate and useful answer: it reads as "no strong view". Do NOT produce a call for every
  holding to look thorough — a wall of low-conviction HOLDs buries the one or two calls that
  matter, which is the opposite of useful.
- "ticker" in a holding call MUST be one of the tickers supplied to you. NEVER name a company the
  investor does not hold.
- Use the supplied prices, weights and fundamentals as ground truth. NEVER invent a number.
- WEIGHTS ARE WITHIN A CURRENCY, NOT ACROSS THE WHOLE BOOK. Where the investor holds more than one
  currency you are given separate sub-books, because no exchange rate was applied. You therefore
  CANNOT judge concentration across currencies and must not pretend to — say so plainly if it
  limits your read.
- You are given no cash balance. If cash allocation matters to your judgement, say what you would
  need to know rather than assuming a number.
- "biggest_risk" is the ONE thing about this book's construction you would fix first. One thing,
  named concretely.

TONE
Short declarative sentences, in the register the philosophy above implies. You are talking to one
investor about money already at risk.

OUTPUT
Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else — no prose before or after it. Use null for anything you cannot responsibly
determine. Shape:

{
  "headline": string,
  "structural_read": {
    "concentration": string,
    "diversification": string,
    "sizing": string,
    "cash": string
  },
  "holding_calls": [ { "ticker": string, "call": "TRIM" | "ADD" | "HOLD", "reason": string } ],
  "biggest_risk": string
}

"headline" is one sentence. Each "structural_read" field is 1-3 sentences. Each call's "reason" is
one sentence. Valid JSON: no trailing commas.`;
}


/**
 * How a book's ownership changes what a panel is told about it.
 *
 * Shared by the portfolio Council and the Scratchpad pattern read, because the
 * one thing that must not happen is the two disagreeing about whose money they
 * are looking at. This is the second of the three things `ownership` actually
 * does (the others being the badge and the exclusion from the aggregate total)
 * — and it is the one that changes the answer rather than the presentation.
 *
 * Deliberately a briefing and not a disclaimer. A disclaimer protects the app;
 * this changes what "should I trim this" means. Capital held for a named person
 * who did not choose these positions and cannot be asked about them tolerates
 * less than the trader's own money does, and a panel told nothing will assume
 * the opposite by default — because every other book it has ever been shown was
 * the trader's own.
 */
export type BookOwnership = {
  ownership: "owned" | "managed";
  beneficiary_name: string | null;
};

export function ownershipFraming(book: BookOwnership | null): string {
  if (book?.ownership !== "managed") {
    return (
      "WHOSE MONEY THIS IS\n" +
      "The investor's own. They chose these positions and they carry the consequences, so judge " +
      "the construction against their stated objective and their evident appetite — not against " +
      "what would be prudent for someone else."
    );
  }
  const who = book.beneficiary_name?.trim() ? book.beneficiary_name.trim() : "someone else";
  return (
    "WHOSE MONEY THIS IS\n" +
    `NOT the trader's own. This book is managed on behalf of ${who}, who did not pick these ` +
    "positions and is not in the room to be asked about them.\n" +
    "That changes the standard, and you should say so where it bites:\n" +
    `- Concentration that a person might reasonably accept in their own account is harder to ` +
    `justify in ${who}'s.\n` +
    "- A position held on conviction alone, with no stated reason recorded, is a weaker answer " +
    "here than it would be in the trader's own book.\n" +
    "- Where you would say \"this is a matter of appetite\", say instead whose appetite, and " +
    "whether it is the right one to be applying.\n" +
    "Do not soften your read because the money belongs to a third party. Sharpen it."
  );
}

/**
 * The shared briefing every member reads. Built once from data the route has
 * already fetched, so an N-member consult costs N model calls and zero extra
 * market-data lookups.
 */
const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  equity: "equities",
  crypto: "crypto",
};

export function buildPortfolioOpinionUserContext(input: {
  books: CurrencyBook[];
  objective: string | null;
  totalPositions: number;
  /** The book being judged. Null only where ownership is genuinely unknown. */
  book?: BookOwnership | null;
}): string {
  const lines: string[] = [];

  // First, before the objective and before a single holding. A panel that reads
  // the positions before it learns whose they are has already formed a view.
  lines.push(ownershipFraming(input.book ?? null));
  lines.push("");
  lines.push("WHAT THE INVESTOR SAYS THIS PORTFOLIO IS FOR");
  lines.push(
    input.objective?.trim()
      ? input.objective.trim()
      : "They have not stated an objective. Judge the construction on its own terms and say what you would need to know.",
  );
  lines.push("");
  lines.push(`THE BOOK — ${input.totalPositions} open position${input.totalPositions === 1 ? "" : "s"}`);

  if (input.books.length > 1) {
    lines.push("");
    lines.push(
      `This investor holds ${input.books.length} currencies. NO EXCHANGE RATE HAS BEEN APPLIED, so ` +
        `each sub-book below is weighted WITHIN ITSELF and the sub-books cannot be compared or added ` +
        `to each other. Judge each on its own shape, and be explicit about what that stops you saying.`,
    );
  }

  for (const book of input.books) {
    lines.push("");
    lines.push(
      `--- ${book.currency} sub-book — ${book.holdings.length} position${book.holdings.length === 1 ? "" : "s"}, ` +
        `cost basis ${round(book.costBasis)} ${book.currency}, market value ${round(book.marketValue)} ${book.currency} ---`,
    );
    if (book.exposure.length > 0) {
      lines.push(
        `  Asset-class exposure: ${book.exposure
          .map((e) => `${e.pct.toFixed(1)}% ${ASSET_CLASS_LABEL[e.assetClass]}`)
          .join(", ")}. This is a share of what PRICED, not of every position.`,
      );
      if (book.exposure.some((e) => e.assetClass === "crypto")) {
        lines.push(
          "  Crypto here is a holding, not a thesis this app researched: there are no " +
            "fundamentals behind a coin and none are shown for one. Judge it as an " +
            "exposure and a size — how much of this sub-book sits in one volatile " +
            "asset class, and whether that size matches what they say the money is for. " +
            "Do not invent a valuation case for a coin, and do not fault it for lacking one.",
        );
      }
    }

    for (const h of book.holdings) {
      lines.push("");
      lines.push(`- ${h.ticker}${h.companyName ? ` (${h.companyName})` : ""}`);
      if (h.assetClass === "crypto") lines.push("  Asset class: cryptocurrency.");
      lines.push(
        `  Weight in this sub-book: ${h.weightPct === null ? "UNKNOWN — this holding would not price" : `${h.weightPct.toFixed(1)}%`}`,
      );
      lines.push(`  Quantity ${h.quantity} at an average cost of ${round(h.averagePrice)}`);
      lines.push(
        h.currentPrice === null
          ? "  Current price: UNAVAILABLE"
          : `  Current price: ${round(h.currentPrice)} (${pnlLabel(h.averagePrice, h.currentPrice)})`,
      );
      if (!h.hasTradePlan) {
        lines.push("  No stop, no targets and no time exit — this position has never been sized to a plan.");
      }
      if (h.rationale) lines.push(`  Why they say they bought it: ${h.rationale}`);
      const shown = Object.entries(h.fundamentals).slice(0, 8);
      for (const [key, value] of shown) lines.push(`  ${key}: ${value}`);
    }
  }

  lines.push("");
  lines.push(
    `Valid tickers for "holding_calls": ${input.books
      .flatMap((b) => b.holdings.map((h) => h.ticker))
      .join(", ")}.`,
  );
  lines.push("Give your read on how this portfolio is built.");
  return lines.join("\n");
}

function round(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pnlLabel(averagePrice: number, currentPrice: number): string {
  if (averagePrice <= 0) return "no cost basis";
  const pct = ((currentPrice - averagePrice) / averagePrice) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs cost`;
}

export const JARVIS_PORTFOLIO_SYNTHESIS_SYSTEM_PROMPT = `You are Jarvis, summarising an investment council convened on one investor's whole portfolio.

You are given several independent reads of the same book, each from a reviewer arguing a different
investing philosophy. Produce ONE combined read.

HARD RULES
- SURFACE THE DISAGREEMENT. A summary that blends dissent into a neutral paragraph destroys the
  entire value of having asked several people. Where they split, name who took which side and on
  what grounds.
- If they genuinely converged, say so plainly — do not manufacture a split.
- Every claim must come from the reads given to you. Do not introduce a new argument, a new risk or
  a new ticker of your own.
- "loudest_calls" names only tickers where MORE THAN ONE reviewer landed on the same TRIM or ADD.
  A single reviewer's call is not a panel view. Empty is a fine answer.

TONE
Direct, compressed. The investor reads this first and the individual cards second.

OUTPUT
Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else. Shape:

{
  "summary": string,
  "where_they_agree": [string],
  "where_they_diverge": [string],
  "loudest_calls": [string]
}

"summary" is 2-4 sentences. 1-3 entries in each of the first two arrays, each one sentence naming
the reviewers involved. Valid JSON: no trailing commas.`;

export function buildPortfolioSynthesisUserContext(
  opinions: { name: string; opinion: PortfolioOpinion }[],
): string {
  const lines: string[] = ["THE READS", ""];
  for (const { name, opinion } of opinions) {
    lines.push(`- ${name}`);
    if (opinion.headline) lines.push(`  Headline: ${opinion.headline}`);
    const s = opinion.structural_read;
    if (s.concentration) lines.push(`  Concentration: ${s.concentration}`);
    if (s.diversification) lines.push(`  Diversification: ${s.diversification}`);
    if (s.sizing) lines.push(`  Sizing: ${s.sizing}`);
    if (s.cash) lines.push(`  Cash: ${s.cash}`);
    if (opinion.biggest_risk) lines.push(`  Biggest risk: ${opinion.biggest_risk}`);
    if (opinion.holding_calls.length > 0) {
      lines.push(
        `  Calls: ${opinion.holding_calls.map((c) => `${c.ticker} ${c.call}`).join(", ")}`,
      );
    } else {
      lines.push("  Calls: none — no strong view on any individual holding.");
    }
    lines.push("");
  }
  lines.push("Produce the combined council read.");
  return lines.join("\n");
}
