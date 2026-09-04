import { z } from "zod";

/**
 * Parses raw Jarvis output for `JARVIS_THESIS_SYSTEM_PROMPT`
 * (`lib/jarvis-thesis-prompt.ts`) into 5 narrative sections plus the
 * trailing structured JSON. Same "never throws" contract as the deleted v1
 * `lib/jarvis-parser.ts` — every failure mode degrades to `extraction.ok:
 * false` with the raw text preserved, since Task 9's caller always needs to
 * persist `raw` regardless of whether extraction succeeded.
 */

export const ThesisExtractSchema = z.object({
  mode: z.enum(["stock_only", "thesis_only", "stock_plus_thesis"]),
  /**
   * A short name for the idea (0028).
   *
   * `.catch(null)` and NOT required, which is the whole care in this field. The
   * I7 note below records what a strict field cost last time: one value the
   * model omitted failed the entire object and discarded an otherwise-usable
   * thesis. A title is the least load-bearing thing in this schema — the
   * fallback chain in `lib/thesis-title.ts` handles its absence completely —
   * so it must never be the reason an analysis is lost. Missing, too long, or
   * the wrong type all degrade to null.
   */
  title: z.string().trim().min(1).max(80).nullable().catch(null),
  ticker: z.string().nullable(),
  // I7 fix: `JARVIS_THESIS_SYSTEM_PROMPT` explicitly tells the model to use
  // null for any field it cannot responsibly determine, for every field —
  // these five narrative fields must accept that null the same as `ticker`
  // does, or a genuinely thin thesis fails schema validation entirely and
  // discards an otherwise-usable response.
  market_view: z.string().nullable(),
  mispricing: z.string().nullable(),
  catalyst: z.string().nullable(),
  time_horizon: z.string().nullable(),
  invalidation_condition: z.string().nullable(),
  conviction_tier: z.enum(["I", "II", "III", "IV"]),
  conviction_score: z.number().min(0).max(100),
  stock_suggestions: z.array(
    z.object({ ticker: z.string(), rationale: z.string() }),
  ),
});

export type ThesisExtract = z.infer<typeof ThesisExtractSchema>;

const JSON_FENCE_REGEX = /```json\s*([\s\S]*?)```/g;

/** Same "last matching fence wins" logic as v1 — see `lib/jarvis-parser.ts`'s deleted comment for the full rationale. */
export function extractTrailingJsonBlock(raw: string): unknown | null {
  let matches: RegExpMatchArray[];
  try {
    matches = [...raw.matchAll(JSON_FENCE_REGEX)];
  } catch {
    return null;
  }
  if (matches.length === 0) return null;

  const jsonText = matches[matches.length - 1][1];
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export type ThesisSections = {
  marketView: string;
  mispricing: string;
  catalyst: string;
  timeHorizon: string;
  invalidation: string;
};

const SECTION_HEADERS: { key: keyof ThesisSections; header: string }[] = [
  { key: "marketView", header: "## Market View" },
  { key: "mispricing", header: "## Mispricing" },
  { key: "catalyst", header: "## Catalyst" },
  { key: "timeHorizon", header: "## Time Horizon" },
  { key: "invalidation", header: "## Invalidation" },
];

const EMPTY_SECTIONS: ThesisSections = {
  marketView: "",
  mispricing: "",
  catalyst: "",
  timeHorizon: "",
  invalidation: "",
};

function splitThesisSections(raw: string): ThesisSections {
  const sections: ThesisSections = { ...EMPTY_SECTIONS };
  const found: { key: keyof ThesisSections; start: number; end: number }[] = [];
  let searchFrom = 0;

  for (const { key, header } of SECTION_HEADERS) {
    const idx = raw.indexOf(header, searchFrom);
    if (idx === -1) continue;
    found.push({ key, start: idx, end: idx + header.length });
    searchFrom = idx + header.length;
  }

  for (let i = 0; i < found.length; i++) {
    const current = found[i];
    const next = found[i + 1];
    const sliceEnd = next ? next.start : raw.length;
    sections[current.key] = raw.slice(current.end, sliceEnd).trim();
  }

  return sections;
}

export type ThesisExtraction =
  | { ok: true; data: ThesisExtract }
  | { ok: false; rawJson: unknown | null; error: string };

export type ParsedThesisResponse = {
  sections: ThesisSections;
  extraction: ThesisExtraction;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Repairs the one structural contradiction this schema cannot express: a
 * `thesis_only` extraction that also names a ticker.
 *
 * This is not a style nit. A robotics/actuator thesis once came back as
 * `mode: "thesis_only"` with `ticker: "ZBRA"` — a name found nowhere in the
 * trader's text. `theses.ticker` is what the memorandum route branches on to
 * decide between "compare this stock against its peers" and "build a basket
 * from the thesis", and the peer path seeds that ticker first and never drops
 * it. So an invented name silently became the premise of the whole analysis
 * and won a comparison its real rivals were never entered into.
 *
 * A macro thesis names no stock by definition; suggestions belong in
 * `stock_suggestions`, which is not load-bearing. Enforced here rather than
 * asked for in the prompt, because a prompt is a request and this is an
 * invariant.
 */
function normalizeExtract(data: ThesisExtract): ThesisExtract {
  if (data.mode === "thesis_only" && data.ticker !== null) {
    return { ...data, ticker: null };
  }
  return data;
}

export function parseThesisResponse(raw: string): ParsedThesisResponse {
  try {
    const sections = splitThesisSections(raw);
    const rawJson = extractTrailingJsonBlock(raw);

    if (rawJson === null) {
      return {
        sections,
        extraction: { ok: false, rawJson: null, error: "No valid ```json code block found in the response." },
      };
    }

    const result = ThesisExtractSchema.safeParse(rawJson);
    if (!result.success) {
      return {
        sections,
        extraction: { ok: false, rawJson, error: `JSON block failed schema validation: ${result.error.message}` },
      };
    }

    return { sections, extraction: { ok: true, data: normalizeExtract(result.data) } };
  } catch (err) {
    return {
      sections: { ...EMPTY_SECTIONS },
      extraction: {
        ok: false,
        rawJson: null,
        error: `Unexpected error while parsing thesis response: ${errorMessage(err)}`,
      },
    };
  }
}

/* ------------------------------------------------------------------------- *
 * Candidate shortlist parsing
 * ------------------------------------------------------------------------- */

export const CandidateShortlistSchema = z.object({
  candidates: z
    .array(
      z.object({
        ticker: z.string().min(1),
        company_name: z.string().nullable().optional(),
        why_shortlisted: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

export type CandidateShortlist = z.infer<typeof CandidateShortlistSchema>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Shared shape for both bake-off calls. Same never-throws contract as
 * `parseThesisResponse` — the caller persists what it can and surfaces the
 * error rather than 500-ing on a malformed model turn.
 */
function parseFencedJson<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  try {
    const rawJson = extractTrailingJsonBlock(raw);
    if (rawJson === null) {
      return { ok: false, error: "No valid ```json code block found in the response." };
    }
    const result = schema.safeParse(rawJson);
    if (!result.success) {
      return { ok: false, error: `JSON block failed schema validation: ${result.error.message}` };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function parseCandidateShortlist(raw: string): ParseResult<CandidateShortlist> {
  return parseFencedJson(raw, CandidateShortlistSchema);
}

/* ------------------------------------------------------------------------- *
 * Trade-plan geometry
 * ------------------------------------------------------------------------- */

/**
 * The price levels every trade plan shares, whatever produced them.
 */
export type TradePlanLevels = {
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  add_tranche_low: number | null;
  add_tranche_high: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  position_size_pct: number | null;
  time_exit_date: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Drops values that are valid JSON but not usable as a trade plan.
 *
 * These numbers are written straight into `trade_plans` when a trade is backed,
 * so a level that contradicts the plan's own geometry — a stop above the entry,
 * a target below it — is worse than a blank: it invites locking in a plan nobody
 * checked. Shared by every producer of a plan so they cannot disagree about what
 * "valid" means.
 */
export function sanitizeTradePlanGeometry<T extends TradePlanLevels>(levels: T): T {
  const out: T = { ...levels };

  const positive = (v: number | null) => (v != null && Number.isFinite(v) && v > 0 ? v : null);
  out.entry_zone_low = positive(out.entry_zone_low);
  out.entry_zone_high = positive(out.entry_zone_high);
  out.add_tranche_low = positive(out.add_tranche_low);
  out.add_tranche_high = positive(out.add_tranche_high);
  out.stop_loss = positive(out.stop_loss);
  out.target_1 = positive(out.target_1);
  out.target_2 = positive(out.target_2);

  // Swap a reversed zone rather than discarding both bounds — the levels are
  // still the ones the model chose, only the labels came out backwards.
  if (
    out.entry_zone_low != null &&
    out.entry_zone_high != null &&
    out.entry_zone_low > out.entry_zone_high
  ) {
    [out.entry_zone_low, out.entry_zone_high] = [out.entry_zone_high, out.entry_zone_low];
  }
  if (
    out.add_tranche_low != null &&
    out.add_tranche_high != null &&
    out.add_tranche_low > out.add_tranche_high
  ) {
    [out.add_tranche_low, out.add_tranche_high] = [out.add_tranche_high, out.add_tranche_low];
  }

  const floor = out.add_tranche_low ?? out.entry_zone_low;
  if (out.stop_loss != null && floor != null && out.stop_loss >= floor) out.stop_loss = null;

  const ceiling = out.entry_zone_high ?? out.entry_zone_low;
  if (out.target_1 != null && ceiling != null && out.target_1 <= ceiling) out.target_1 = null;
  if (out.target_2 != null && ceiling != null && out.target_2 <= ceiling) out.target_2 = null;
  if (out.target_1 != null && out.target_2 != null && out.target_2 <= out.target_1) {
    out.target_2 = null;
  }

  if (
    out.position_size_pct != null &&
    (!Number.isFinite(out.position_size_pct) ||
      out.position_size_pct <= 0 ||
      out.position_size_pct > 100)
  ) {
    out.position_size_pct = null;
  }

  if (out.time_exit_date != null) {
    const d = out.time_exit_date.trim();
    out.time_exit_date = ISO_DATE.test(d) && !Number.isNaN(Date.parse(d)) ? d : null;
  }

  return out;
}
