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
  market_view: z.string(),
  mispricing: z.string(),
  catalyst: z.string(),
  time_horizon: z.string(),
  invalidation_condition: z.string(),
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
