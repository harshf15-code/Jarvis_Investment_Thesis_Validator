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

describe("parseThesisResponse — invented-ticker guard", () => {
  const body = (json: string) => `## Market View
V

## Mispricing
M

## Catalyst
C

## Time Horizon
T

## Invalidation
I

\`\`\`json
${json}
\`\`\``;

  const json = (over: Record<string, unknown>) =>
    JSON.stringify({
      mode: "thesis_only",
      ticker: null,
      market_view: "V",
      mispricing: "M",
      catalyst: "C",
      time_horizon: "T",
      invalidation_condition: "I",
      conviction_tier: "II",
      conviction_score: 60,
      stock_suggestions: [],
      ...over,
    });

  /**
   * The robotics regression, at the layer that can actually prevent it. A
   * `thesis_only` extraction that also names a ticker is self-contradictory,
   * and downstream that ticker is treated as the trader's own conviction: the
   * memorandum route seeds it first and never drops it. ZBRA reached a memo
   * this way from a sector question that never mentioned it.
   */
  it("strips a ticker from a thesis_only extraction", () => {
    const parsed = parseThesisResponse(body(json({ ticker: "ZBRA" })));
    expect(parsed.extraction.ok).toBe(true);
    if (!parsed.extraction.ok) return;
    expect(parsed.extraction.data.ticker).toBe(null);
    expect(parsed.extraction.data.mode).toBe("thesis_only");
    // The rest of the extraction survives untouched.
    expect(parsed.extraction.data.conviction_score).toBe(60);
  });

  it("leaves the ticker alone when the mode says a stock was named", () => {
    for (const mode of ["stock_only", "stock_plus_thesis"]) {
      const parsed = parseThesisResponse(body(json({ mode, ticker: "TCS" })));
      expect(parsed.extraction.ok).toBe(true);
      if (!parsed.extraction.ok) return;
      expect(parsed.extraction.data.ticker).toBe("TCS");
    }
  });

  it("keeps suggestions, which are not load-bearing", () => {
    const parsed = parseThesisResponse(
      body(json({ ticker: "ZBRA", stock_suggestions: [{ ticker: "ROK", rationale: "r" }] })),
    );
    expect(parsed.extraction.ok).toBe(true);
    if (!parsed.extraction.ok) return;
    expect(parsed.extraction.data.ticker).toBe(null);
    expect(parsed.extraction.data.stock_suggestions).toHaveLength(1);
  });
});
