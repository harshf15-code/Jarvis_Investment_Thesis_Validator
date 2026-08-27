import { describe, expect, it } from "vitest";
import { parseThesisResponse } from "@/lib/jarvis-thesis-parser";

const VALID_RESPONSE = `## Market View
The market believes X.

## Mispricing
The market is wrong because Y.

## Catalyst
Z will close the gap.

## Time Horizon
3-6 months.

## Invalidation
If A happens, thesis is dead.

\`\`\`json
{
  "mode": "stock_plus_thesis",
  "ticker": "BAJAJ-AUTO",
  "market_view": "The market believes X.",
  "mispricing": "The market is wrong because Y.",
  "catalyst": "Z will close the gap.",
  "time_horizon": "3-6 months",
  "invalidation_condition": "If A happens, thesis is dead.",
  "conviction_tier": "II",
  "conviction_score": 72,
  "stock_suggestions": []
}
\`\`\``;

describe("parseThesisResponse", () => {
  it("extracts all 5 narrative sections and validates the trailing JSON", () => {
    const result = parseThesisResponse(VALID_RESPONSE);
    expect(result.sections.marketView).toContain("The market believes X.");
    expect(result.sections.invalidation).toContain("thesis is dead.");
    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.ticker).toBe("BAJAJ-AUTO");
      expect(result.extraction.data.conviction_tier).toBe("II");
    }
  });

  it("returns ok:false with the raw response preserved when no json fence is present", () => {
    const result = parseThesisResponse("## Market View\nSome text with no JSON block.");
    expect(result.extraction.ok).toBe(false);
    expect(result.sections.marketView).toContain("Some text with no JSON block.");
  });

  it("returns ok:false when the JSON fails schema validation", () => {
    const result = parseThesisResponse('```json\n{"mode": "bogus"}\n```');
    expect(result.extraction.ok).toBe(false);
  });

  it("never throws on garbage input", () => {
    expect(() => parseThesisResponse("")).not.toThrow();
    expect(() => parseThesisResponse("```json\n{not valid json\n```")).not.toThrow();
  });

  it("accepts a thesis_only mode with populated stock_suggestions", () => {
    const raw = VALID_RESPONSE.replace(
      /"mode": "stock_plus_thesis",\n  "ticker": "BAJAJ-AUTO",/,
      '"mode": "thesis_only",\n  "ticker": null,',
    ).replace(
      '"stock_suggestions": []',
      '"stock_suggestions": [{"ticker": "TCS", "rationale": "Direct IT bottoming exposure"}]',
    );
    const result = parseThesisResponse(raw);
    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.stock_suggestions).toHaveLength(1);
      expect(result.extraction.data.ticker).toBe(null);
    }
  });

  it("accepts a null narrative field per the prompt's own contract (I7 fix)", () => {
    const raw = VALID_RESPONSE.replace('"catalyst": "Z will close the gap.",', '"catalyst": null,');
    const result = parseThesisResponse(raw);
    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.catalyst).toBe(null);
    }
  });
});
