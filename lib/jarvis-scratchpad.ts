import { z } from "zod";

import { ownershipFraming, type BookOwnership } from "@/lib/jarvis-portfolio-council";
import { extractTrailingJsonBlock } from "@/lib/jarvis-thesis-parser";
import type { AssetClass, ThesisSource } from "@/lib/types";

/**
 * Jarvis's read on what a whole book says about the trader's own taste.
 *
 * The portfolio Council asks "does this collection make sense together". This
 * asks something narrower and stranger: what pattern is the trader following,
 * whether or not they have ever said it out loud. Across a real book — a
 * defence name, a lender, a bottler — there is usually a legible preference,
 * and nothing in the app has ever said it back.
 *
 * Two rules carried over from `lib/jarvis-portfolio-council.ts`:
 *
 * 1. Nearly every field is nullable with `.catch`. A thin answer costs that
 *    field, not the whole read.
 * 2. What the model claims is checked against what the trader actually holds
 *    before any of it renders. A pattern is only interesting if it is a pattern
 *    in the real book.
 */

/**
 * Two holdings are a line, not a pattern.
 *
 * One definition, because the route decides whether to run the read and the
 * panel decides whether to offer it. Those two disagreeing would mean a button
 * that 400s.
 */
export const MIN_PATTERN_HOLDINGS = 3;

const str = z.string().nullable().catch(null);

/** One cluster the read believes it has found, and the holdings in it. */
export const PatternSignalSchema = z.object({
  theme: z.string(),
  tickers: z.array(z.string()).catch([]),
  note: str,
  /**
   * P1: "you might also look at…". A prompt, never an instruction — the trader
   * turns it into a note with one click or ignores it.
   */
  also_look_at: str,
});
export type PatternSignal = z.infer<typeof PatternSignalSchema>;

export const PatternReadSchema = z.object({
  headline: str,
  signals: z.array(PatternSignalSchema).catch([]),
  /**
   * The model's own account of what it could not place. Rendered BELOW the
   * computed list from `unplacedTickers`, never instead of it — see that
   * function for why the prose alone is not trusted.
   */
  not_explained: str,
  grounded_in: z.array(z.string()).catch([]),
  generated_at: z.string(),
});
export type PatternRead = z.infer<typeof PatternReadSchema>;

/** What the read is given about one holding. Facts only — no model output. */
export type PatternHolding = {
  ticker: string;
  companyName: string | null;
  source: ThesisSource;
  /** Equity or coin. A coin has no sector, and saying so beats an empty one. */
  assetClass: AssetClass;
  /** As Yahoo classifies it, or null where Yahoo has no profile at all. */
  sector: string | null;
  industry: string | null;
  rationale: string | null;
  marketView: string | null;
  mispricing: string | null;
  catalyst: string | null;
  convictionTier: string | null;
};

export type PatternParse<T> = { ok: true; data: T } | { ok: false; error: string };

export function parsePatternRead(raw: string): PatternParse<PatternRead> {
  try {
    const json = extractTrailingJsonBlock(raw);
    if (json === null) {
      return { ok: false, error: "No valid ```json code block found in the pattern read." };
    }
    const result = PatternReadSchema.safeParse(json);
    if (!result.success) {
      return {
        ok: false,
        error: `Pattern read failed schema validation: ${result.error.message}`,
      };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const upper = (t: string) => t.trim().toUpperCase();

/** The prompt defines a signal as a cluster. One holding is not a cluster. */
const MIN_SIGNAL_TICKERS = 2;

/**
 * Drop every claim the book does not support.
 *
 * `eligibleTickers` is NOT simply "everything held" — it is the narrower set a
 * signal is ALLOWED to name. A holding the data source could not classify is
 * held but not eligible: the prompt tells the model to leave it out, and this
 * is what makes that true whether or not the model complied. Without it the
 * deterministic handling of ETFs and other unclassified assets would rest
 * entirely on the model obeying an instruction, which is the one thing this
 * module exists not to rely on.
 *
 * Pass every held ticker to `unplacedTickers` afterwards, not this set. The two
 * answer different questions: what a signal may claim, and what the trader
 * actually owns.
 *
 * A signal naming a ticker outside that set is not a thin answer, it is a wrong
 * one — the entire value of this read is that it describes THIS book rather
 * than a plausible book.
 *
 * A signal left with fewer than two holdings is dropped. The prompt defines a
 * signal as a cluster of two or more, and enforcing it matters: without this a
 * model can dress every individual holding up as its own "pattern", which both
 * presents a single position as a portfolio-level finding and quietly marks it
 * explained. A holding whose only signal is dropped here lands in the unplaced
 * set, which is the honest answer.
 *
 * Tickers are also normalised here so the UI can match a signal to a position
 * without re-trimming and re-casing at every render.
 */
export function normalizePatternRead(
  read: PatternRead,
  eligibleTickers: readonly string[],
): PatternRead {
  const eligible = new Set(eligibleTickers.map(upper));
  const signals = read.signals
    .map((s) => ({
      ...s,
      tickers: Array.from(new Set(s.tickers.map(upper))).filter((t) => eligible.has(t)),
    }))
    .filter((s) => s.tickers.length >= MIN_SIGNAL_TICKERS);
  return { ...read, signals };
}

/**
 * Held tickers that no signal named — computed, never asked of the model.
 *
 * The requirement is that the read says plainly when a holding fits no pattern.
 * Asking the model to list those and trusting the answer is the one thing this
 * codebase consistently refuses to do: `portfolioCouncilTally` computes its
 * headline numbers from the cards rather than asking for them, for exactly this
 * reason. A model that has just told a tidy story is the last thing that should
 * be asked which holdings spoil it.
 *
 * This is also what makes an unclassifiable holding honest with no special
 * casing. Yahoo has no `assetProfile` sector for an ETF, the prompt forbids
 * guessing one, so nothing places it — and it falls out here.
 *
 * Run AFTER `normalizePatternRead`, so a ticker "explained" by a signal that
 * was itself dropped counts as unplaced.
 */
export function unplacedTickers(read: PatternRead, heldTickers: readonly string[]): string[] {
  const placed = new Set(read.signals.flatMap((s) => s.tickers.map(upper)));
  return heldTickers.map(upper).filter((t) => !placed.has(t));
}

/* ------------------------------------------------------------------------- *
 * Prompt
 * ------------------------------------------------------------------------- */

export const PATTERN_READ_SYSTEM_PROMPT = `You are Jarvis, describing an investor's taste back to them from the book they actually hold.

WHAT THIS IS
Not advice, not a valuation, not a call on any holding. One question: what pattern, if any, runs
through what this person has chosen to own? They may never have said it out loud. Saying it plainly
is the whole job.

FACT VERSUS READ — THE LINE THAT MATTERS MOST HERE
Everything under a holding below is FACT: it is held, its sector is what the exchange data says, and
a thesis field is what the investor themselves wrote. That a group of them forms a PATTERN is your
read. Never present your read as though it were one of the supplied facts, and never invent a fact
to support a pattern.

SECTOR IS SUPPLIED, NOT REMEMBERED
Where a holding shows "Sector: not classified", the data source has no classification for it — it
may be a fund, an ETF or a thinly covered name. DO NOT supply one from your own knowledge. Leave
that holding out of every signal and account for it in "not_explained". A guessed sector is
indistinguishable from a fetched one once it is on the screen, and that is precisely the failure
this instruction exists to prevent.

WHAT A SIGNAL IS
A cluster of TWO OR MORE holdings that belong together for a reason you can name — a sector, a
market structure (monopoly, duopoly, regulated toll), a policy tailwind, a shape of thesis, a
temperament. Only name a signal you can point at holdings for. Two names in the same sector is a
sector, not necessarily a pattern; say which you think it is.

HONESTY BEATS TIDINESS
A book that shows no pattern is a real answer. Say so. A holding that fits nothing belongs in
"not_explained" with a word about why, not squeezed into the nearest cluster. You are being read by
someone who owns these things and will know immediately if you have forced the story.

ONLY THE TICKERS YOU ARE GIVEN
Every ticker in every signal must come from the list supplied. A ticker not in that list is dropped
before the investor ever sees it.

"also_look_at" IS A PROMPT, NOT A RECOMMENDATION
One short line per signal: a question worth sitting with, or a kind of thing worth a look given the
pattern. Never a buy call, never a price. Null if you have nothing worth saying.

TONE
Short declarative sentences. You are describing someone to themselves, so be precise rather than
flattering.

OUTPUT
Output exactly one fenced code block using json as the fence's info string, containing ONE object
and nothing else — no prose before or after it. Use null for anything you cannot responsibly
determine. Shape:

{
  "headline": string,
  "signals": [ { "theme": string, "tickers": [string], "note": string, "also_look_at": string } ],
  "not_explained": string,
  "grounded_in": [string],
  "generated_at": string
}

"headline" is one sentence naming the pattern, or saying plainly that there isn't one. Each "note"
is 1-3 sentences. "grounded_in" lists the specific facts you actually leaned on. "generated_at" is
the ISO date you are told is today. Valid JSON: no trailing commas.`;

export function buildPatternReadUserContext(input: {
  holdings: PatternHolding[];
  objective: string | null;
  notes: string[];
  today: string;
  /** The book being read. Null only where ownership is genuinely unknown. */
  book?: BookOwnership | null;
}): string {
  const lines: string[] = [];

  lines.push(`TODAY IS ${input.today}`);
  lines.push("");
  // Shared with the portfolio Council rather than restated, so the two can
  // never end up describing the same book to two different standards.
  lines.push(ownershipFraming(input.book ?? null));
  lines.push("");
  lines.push("WHAT THE INVESTOR SAYS THIS PORTFOLIO IS FOR");
  lines.push(
    input.objective?.trim()
      ? input.objective.trim()
      : "They have not stated an objective. Read the pattern from the holdings alone, and say what stating one would let you see.",
  );

  lines.push("");
  lines.push(
    `THE BOOK — ${input.holdings.length} holding${input.holdings.length === 1 ? "" : "s"}. All of this is fact.`,
  );

  // A COUNT, never a percentage. This read has no prices and no quantities —
  // it is about what they own, not how much. A weight here would have to be
  // invented, and an invented number in a prompt is indistinguishable from a
  // measured one by the time it reaches the output.
  const coins = input.holdings.filter((h) => h.assetClass === "crypto").length;
  const equities = input.holdings.length - coins;
  if (coins > 0) {
    lines.push(
      `${coins} of these ${coins === 1 ? "is a cryptocurrency" : "are cryptocurrencies"}, and ${equities} ${equities === 1 ? "is an equity" : "are equities"}. ` +
        // Only when there is actually a mix. Told "0 are equities" and then
        // that they hold coins "alongside shares", the model has been handed a
        // contradiction inside a block the prompt labels as fact — and the
        // reading it invents to resolve one is worse than the sentence is
        // worth.
        (equities > 0
          ? "Choosing to hold coins alongside shares is itself part of the taste you are reading. "
          : "This book is entirely crypto. That is itself the strongest thing the mix tells you. ") +
        "These are counts of holdings, not shares of the money — you have not been told what any of it is worth.",
    );
  }

  for (const h of input.holdings) {
    lines.push("");
    lines.push(`- ${h.ticker}${h.companyName ? ` (${h.companyName})` : ""}`);
    lines.push(
      h.assetClass === "crypto"
        ? "  Asset class: cryptocurrency. It has no sector, and none is missing — do not supply one, and do not read its absence as a gap in the data."
        : h.sector
          ? `  Sector: ${h.sector}${h.industry ? ` — ${h.industry}` : ""}`
          : "  Sector: not classified by the data source. Do not supply one.",
    );
    lines.push(
      h.source === "imported"
        ? "  Came from a broker import, not from a thesis run here."
        : "  Came from a thesis run here.",
    );
    if (h.rationale) lines.push(`  Why they say they own it: ${h.rationale}`);
    if (h.marketView) lines.push(`  Their market view: ${h.marketView}`);
    if (h.mispricing) lines.push(`  The mispricing they claimed: ${h.mispricing}`);
    if (h.catalyst) lines.push(`  The catalyst they named: ${h.catalyst}`);
    if (h.convictionTier) lines.push(`  Conviction tier: ${h.convictionTier}`);
  }

  lines.push("");
  if (input.notes.length > 0) {
    lines.push("THEIR OWN SCRATCHPAD NOTES — ideas they are already chewing on, newest first.");
    lines.push(
      "These are half-formed by design. Use them to see where their attention is going; do not treat a note as a position or as a decision they have made.",
    );
    for (const note of input.notes) lines.push(`- ${note}`);
    lines.push("");
  }

  lines.push(
    `Valid tickers for "signals": ${input.holdings.map((h) => h.ticker).join(", ")}.`,
  );
  lines.push("Tell them what you see in what they own.");
  return lines.join("\n");
}
