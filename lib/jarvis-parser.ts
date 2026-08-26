import { z } from "zod";

/**
 * Parses the raw text Jarvis (the LLM) returns for `JARVIS_SYSTEM_PROMPT`
 * (`lib/jarvis-prompt.ts`) back into structured data: five narrative
 * sections plus the trailing consolidated JSON block. This is pure logic —
 * no network calls, no DB access.
 *
 * The #1 flagged reliability risk for this app is parsing LLM output, so
 * `parseJarvisResponse` is built to degrade gracefully on any malformed
 * input rather than throw: Task 8 always needs to persist the raw response
 * (for manual review) regardless of whether structured extraction
 * succeeded, so a thrown exception here would be strictly worse than a
 * reported failure.
 */

/**
 * Mirrors the trailing JSON shape `JARVIS_SYSTEM_PROMPT` instructs the
 * model to emit, exactly (including the `verdict` enum).
 *
 * Design decision — `entry_zone.low > entry_zone.high`: accepted as-is,
 * not schema-rejected. This schema's job is shape/type validation (this is
 * a number, that is one of these three strings), not business-logic
 * validation. An inverted zone is a business-logic problem: Task 11's
 * `evaluateTriggers` treats `price` within `[entry_low, entry_high]` as
 * the "entry zone reached" condition, and an inverted range simply never
 * matches any real price, i.e. it degrades harmlessly to "this trigger
 * never fires" rather than corrupting data or crashing anything. Rejecting
 * it here would turn a downstream no-op into a hard extraction failure
 * (which discards the *entire* JSON block, not just the entry zone),
 * which is a worse outcome for a field that isn't even guaranteed to be
 * internally consistent from an LLM in the first place.
 */
export const AlertCriteriaExtractSchema = z.object({
  entry_zone: z.object({
    low: z.number(),
    high: z.number(),
  }),
  stop_loss: z.number(),
  trim_targets: z.array(
    z.object({
      price: z.number(),
      pct_of_position: z.number(),
    }),
  ),
  time_exit_date: z.iso.date().nullable(),
  reassessment_date: z.iso.date().nullable(),
  earnings_date: z.iso.date().nullable(),
  invalidation_condition: z.string(),
  catalyst: z.string(),
  verdict: z.enum(["proceed", "reject", "proceed_with_caution"]),
  position_size_note: z.string(),
});

export type AlertCriteriaExtract = z.infer<typeof AlertCriteriaExtractSchema>;

/**
 * Matches every ` ```json ... ``` ` fenced block in `raw`. Non-greedy
 * (`[\s\S]*?`) so each match stops at its *own* nearest closing fence
 * rather than swallowing forward to the last `` ``` `` in the whole
 * document (which would corrupt the "two blocks, last one wins" case by
 * merging both blocks' text into one capture). `[\s\S]` (rather than `.`)
 * so the capture spans newlines, since `.` doesn't match `\n` without the
 * `s` flag. Global so `matchAll` can find every occurrence, not just the
 * first.
 */
const JSON_FENCE_REGEX = /```json\s*([\s\S]*?)```/g;

/**
 * Finds all ` ```json ... ``` ` fenced blocks in `raw` and returns
 * `JSON.parse` of the LAST one (the model may echo the schema shape
 * earlier in its narrative before giving the real, final answer — see
 * `JARVIS_SYSTEM_PROMPT`'s "after ALL narrative sections" instruction).
 * Returns `null` if no fenced `json` block is found, or if the last one
 * found fails to parse as JSON (parse errors are caught here, never
 * thrown).
 */
export function extractTrailingJsonBlock(raw: string): unknown | null {
  let matches: RegExpMatchArray[];
  try {
    matches = [...raw.matchAll(JSON_FENCE_REGEX)];
  } catch {
    // Defensive: matchAll on a well-formed RegExp/string pair shouldn't
    // throw, but this function's contract ("or null") holds regardless.
    return null;
  }

  if (matches.length === 0) {
    return null;
  }

  const lastMatch = matches[matches.length - 1];
  const jsonText = lastMatch[1];

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

/** The five narrative sections `parseJarvisResponse` splits `raw` into. */
export type JarvisSections = {
  thesis: string;
  stressTest: string;
  tradePlan: string;
  riskAwareness: string;
  exitDiscipline: string;
};

/**
 * The five `## `-prefixed headers `JARVIS_SYSTEM_PROMPT` instructs the
 * model to emit, in order. Matching is case-sensitive against this exact
 * text, per the system prompt's `OUTPUT FORMAT (strict)` section.
 */
const SECTION_HEADERS: { key: keyof JarvisSections; header: string }[] = [
  { key: "thesis", header: "## Thesis Structuring" },
  { key: "stressTest", header: "## Stress Test" },
  { key: "tradePlan", header: "## Trade Plan" },
  { key: "riskAwareness", header: "## Risk Awareness" },
  { key: "exitDiscipline", header: "## Exit Discipline" },
];

const EMPTY_SECTIONS: JarvisSections = {
  thesis: "",
  stressTest: "",
  tradePlan: "",
  riskAwareness: "",
  exitDiscipline: "",
};

/**
 * Splits `raw` on the five exact `## ` headers into narrative strings, one
 * per section. A missing header leaves its section as an empty string
 * rather than throwing — malformed/incomplete model output should degrade
 * gracefully, not crash the caller. Headers are searched for in canonical
 * order, each starting its search from just after the previous header
 * found, so a section quoting a *later* header's text in its own prose
 * (or the model repeating a header) doesn't cause a false early match.
 * Any text before the first header found, or after the JSON block
 * following the last header, is captured as part of that header's section
 * text (the JSON fence is not stripped out) since this function's only
 * job is header-splitting, not JSON-awareness.
 */
function splitJarvisSections(raw: string): JarvisSections {
  const sections: JarvisSections = { ...EMPTY_SECTIONS };

  const found: { key: keyof JarvisSections; start: number; end: number }[] =
    [];
  let searchFrom = 0;
  for (const { key, header } of SECTION_HEADERS) {
    const idx = raw.indexOf(header, searchFrom);
    if (idx === -1) {
      continue;
    }
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

export type JarvisExtraction =
  | { ok: true; data: AlertCriteriaExtract }
  | { ok: false; rawJson: unknown | null; error: string };

export type ParsedJarvisResponse = {
  sections: JarvisSections;
  extraction: JarvisExtraction;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parses a raw Jarvis LLM response into its five narrative sections plus
 * the extracted/validated trailing JSON block.
 *
 * This function MUST NEVER THROW: every failure mode (no JSON block found,
 * malformed JSON, schema validation failure, or any unexpected error)
 * returns `extraction.ok = false` with a human-readable `error` instead —
 * Task 8's caller always needs to persist `raw` and `sections` regardless
 * of whether extraction succeeded, so an exception here would silently
 * lose the whole analysis rather than degrading to "extraction failed".
 */
export function parseJarvisResponse(raw: string): ParsedJarvisResponse {
  try {
    const sections = splitJarvisSections(raw);
    const rawJson = extractTrailingJsonBlock(raw);

    if (rawJson === null) {
      return {
        sections,
        extraction: {
          ok: false,
          rawJson: null,
          error: "No valid ```json code block found in the response.",
        },
      };
    }

    const result = AlertCriteriaExtractSchema.safeParse(rawJson);
    if (!result.success) {
      return {
        sections,
        extraction: {
          ok: false,
          rawJson,
          error: `JSON block failed schema validation: ${result.error.message}`,
        },
      };
    }

    return {
      sections,
      extraction: { ok: true, data: result.data },
    };
  } catch (err) {
    // Belt-and-suspenders: every helper above already avoids throwing, but
    // this top-level catch is what makes the "never throws" contract
    // actually load-bearing rather than merely believed-true.
    return {
      sections: { ...EMPTY_SECTIONS },
      extraction: {
        ok: false,
        rawJson: null,
        error: `Unexpected error while parsing Jarvis response: ${errorMessage(err)}`,
      },
    };
  }
}
