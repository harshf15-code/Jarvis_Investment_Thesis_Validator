import { describe, expect, it } from "vitest";
import { parseJournalVerdict } from "@/lib/jarvis-journal-parser";

const RAW = `\`\`\`json
{"verdict": "You sized correctly and respected the stop. The thesis played out as planned.", "suggested_tags": ["Indian EV", "Buyback Signal"]}
\`\`\``;

describe("parseJournalVerdict", () => {
  it("extracts the verdict and suggested tags", () => {
    const result = parseJournalVerdict(RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.verdict).toContain("sized correctly");
      expect(result.data.suggestedTags).toEqual(["Indian EV", "Buyback Signal"]);
    }
  });

  it("never throws on garbage input", () => {
    expect(() => parseJournalVerdict("not json")).not.toThrow();
    expect(parseJournalVerdict("not json").ok).toBe(false);
  });
});
