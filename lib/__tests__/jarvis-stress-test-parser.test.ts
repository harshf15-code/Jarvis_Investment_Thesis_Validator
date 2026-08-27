import { describe, expect, it } from "vitest";
import { parseStressTestResponse } from "@/lib/jarvis-thesis-parser";

const RAW = `\`\`\`json
{
  "bear_cases": [
    { "reason": "Margins compress on rising input costs", "counter": "Pricing power offsets 80% historically" },
    { "reason": "Competitor undercuts on price", "counter": "Brand moat has held for a decade" },
    { "reason": "Macro slowdown reduces demand", "counter": "Company has diversified geographically" },
    { "reason": "Regulatory scrutiny increases", "counter": "Legal team has precedent on their side" }
  ]
}
\`\`\``;

describe("parseStressTestResponse", () => {
  it("extracts bear cases with modified defaulting to false", () => {
    const result = parseStressTestResponse(RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.bear_cases).toHaveLength(4);
      expect(result.data.bear_cases[0].modified).toBe(false);
    }
  });

  it("returns ok:false on malformed input without throwing", () => {
    expect(() => parseStressTestResponse("no json here")).not.toThrow();
    expect(parseStressTestResponse("no json here").ok).toBe(false);
  });
});
