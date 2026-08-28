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

    return { sections, extraction: { ok: true, data: result.data } };
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

export const BearCaseExtractSchema = z.object({
  bear_cases: z
    .array(z.object({ reason: z.string(), counter: z.string() }))
    .length(4),
});

export type StressTestExtraction =
  | { ok: true; data: { bear_cases: { reason: string; counter: string; modified: boolean }[] } }
  | { ok: false; error: string };

/** Same never-throws contract as `parseThesisResponse`. */
export function parseStressTestResponse(raw: string): StressTestExtraction {
  try {
    const rawJson = extractTrailingJsonBlock(raw);
    if (rawJson === null) {
      return { ok: false, error: "No valid ```json code block found." };
    }
    const result = BearCaseExtractSchema.safeParse(rawJson);
    if (!result.success) {
      return { ok: false, error: `Schema validation failed: ${result.error.message}` };
    }
    return {
      ok: true,
      data: { bear_cases: result.data.bear_cases.map((bc) => ({ ...bc, modified: false })) },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------------- *
 * Candidate bake-off parsing
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

export const CandidateAnalysisSchema = z.object({
  candidates: z
    .array(
      z.object({
        ticker: z.string().min(1),
        rank: z.number().int().min(1),
        verdict: z.enum(["bet", "watch", "avoid"]),
        score: z.number().min(0).max(100),
        fit_rationale: z.string().nullable(),
        bull_case: z.string().nullable(),
        bear_case: z.string().nullable(),
      }),
    )
    .min(1),
  comparative_verdict: z.string().nullable(),
});

export type CandidateAnalysis = z.infer<typeof CandidateAnalysisSchema>;

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

export function parseCandidateAnalysis(raw: string): ParseResult<CandidateAnalysis> {
  return parseFencedJson(raw, CandidateAnalysisSchema);
}

/**
 * The prompt asks for dense, unique ranks with exactly one "bet" at rank 1, but
 * a model will occasionally hand back ties, gaps, or two winners. Rather than
 * reject an otherwise-good analysis, re-derive the ordering from `score`
 * (highest first) and keep only the top name as the bet.
 *
 * Ordering is by score alone; the model's own `rank` is used only to break
 * ties, so a self-consistent response comes back through unchanged.
 */
export function normalizeCandidateRanks(
  candidates: CandidateAnalysis["candidates"],
): CandidateAnalysis["candidates"] {
  return [...candidates]
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .map((c, i) => ({
      ...c,
      rank: i + 1,
      // Demote a duplicate winner, but never promote: if the model judged the
      // top-scoring name only worth watching, that verdict stands.
      verdict: i === 0 ? c.verdict : c.verdict === "bet" ? "watch" : c.verdict,
    }));
}

/* ------------------------------------------------------------------------- *
 * Trade-plan prefill parsing (US-12)
 * ------------------------------------------------------------------------- */

const nullableNumber = z.number().nullable().catch(null);

export const TradePlanDraftSchema = z.object({
  entry_zone_low: nullableNumber,
  entry_zone_high: nullableNumber,
  add_tranche_low: nullableNumber,
  add_tranche_high: nullableNumber,
  stop_loss: nullableNumber,
  target_1: nullableNumber,
  target_2: nullableNumber,
  position_size_pct: nullableNumber,
  // Kept as a loose string here and validated by `sanitizeTradePlanDraft` —
  // a model that returns "2026-13-01" should cost us the one field, not the
  // whole draft.
  time_exit_date: z.string().nullable().catch(null),
  time_exit_condition: z.string().nullable().catch(null),
  notes: z.string().nullable().catch(null),
});

export type TradePlanDraft = z.infer<typeof TradePlanDraftSchema>;

export function parseTradePlanDraft(raw: string): ParseResult<TradePlanDraft> {
  return parseFencedJson(raw, TradePlanDraftSchema);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Drops values that are structurally valid JSON but not usable as a trade plan.
 * The grid is the trader's starting point, so a level that contradicts the plan's
 * own geometry (a stop above the entry, a target below it) is worse than a blank
 * cell — it invites locking in a plan nobody checked.
 */
export function sanitizeTradePlanDraft(draft: TradePlanDraft): TradePlanDraft {
  const out: TradePlanDraft = { ...draft };

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
  if (out.entry_zone_low != null && out.entry_zone_high != null && out.entry_zone_low > out.entry_zone_high) {
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
  if (out.target_1 != null && out.target_2 != null && out.target_2 <= out.target_1) out.target_2 = null;

  if (
    out.position_size_pct != null &&
    (!Number.isFinite(out.position_size_pct) || out.position_size_pct <= 0 || out.position_size_pct > 100)
  ) {
    out.position_size_pct = null;
  }

  if (out.time_exit_date != null) {
    const d = out.time_exit_date.trim();
    out.time_exit_date = ISO_DATE.test(d) && !Number.isNaN(Date.parse(d)) ? d : null;
  }

  return out;
}
