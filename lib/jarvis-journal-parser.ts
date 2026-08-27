import { z } from "zod";
import { extractTrailingJsonBlock } from "./jarvis-thesis-parser";

const JournalVerdictSchema = z.object({
  verdict: z.string(),
  suggested_tags: z.array(z.string()),
});

export type JournalVerdictExtraction =
  | { ok: true; data: { verdict: string; suggestedTags: string[] } }
  | { ok: false; error: string };

/** Same never-throws contract as the other Jarvis parsers. */
export function parseJournalVerdict(raw: string): JournalVerdictExtraction {
  try {
    const rawJson = extractTrailingJsonBlock(raw);
    if (rawJson === null) return { ok: false, error: "No valid ```json code block found." };
    const result = JournalVerdictSchema.safeParse(rawJson);
    if (!result.success) return { ok: false, error: `Schema validation failed: ${result.error.message}` };
    return { ok: true, data: { verdict: result.data.verdict, suggestedTags: result.data.suggested_tags } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
