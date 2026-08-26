import { describe, expect, it } from "vitest";

import {
  AlertCriteriaExtractSchema,
  extractTrailingJsonBlock,
  parseJarvisResponse,
} from "@/lib/jarvis-parser";

const VALID_JSON_BLOCK = `{
  "entry_zone": { "low": 140.5, "high": 148.0 },
  "stop_loss": 132.0,
  "trim_targets": [
    { "price": 175.0, "pct_of_position": 30 },
    { "price": 210.0, "pct_of_position": 40 }
  ],
  "time_exit_date": "2026-12-15",
  "reassessment_date": "2026-10-01",
  "earnings_date": null,
  "invalidation_condition": "A weekly close below 128 invalidates the thesis.",
  "catalyst": "Q3 earnings beat and margin expansion guide-up.",
  "verdict": "proceed",
  "position_size_note": "Standard 2% risk sizing given the stop distance."
}`;

/**
 * A realistic ~40-line fake Jarvis response: all 5 headers with narrative
 * prose, followed by exactly one trailing ```json block. Used as the
 * "well-formed" baseline for scenario (1) and reused (with edits) for the
 * other scenarios.
 */
function wellFormedResponse(jsonBlock = VALID_JSON_BLOCK): string {
  return `## Thesis Structuring
The market currently prices this stock as a mature, low-growth compounder,
reflected in its below-sector-average multiple. That view is mispriced
because the company's new product line is still being modeled as a
rounding error despite ramping revenue share quarter over quarter. The
mispricing exists because sell-side coverage hasn't updated segment models
since the last investor day. The catalyst is the upcoming Q3 print, which
should show the new segment crossing 15% of revenue. Time horizon: 2-3
quarters. This thesis is invalidated if segment revenue growth decelerates
sequentially for two consecutive quarters.

## Stress Test
1. The new segment's growth could be pulled-forward demand, not durable.
2. Margin dilution from the new segment could offset revenue upside.
3. A sector-wide multiple compression could suppress re-rating even if the
   fundamentals play out as expected.
The current price likely already reflects some optimism from recent
buy-side chatter, so the edge here is thinner than it first appears. Given
the asymmetry of the setup, this thesis survives the stress test, but with
reduced conviction versus the base case.

## Trade Plan
Entry zone: 140.50-148.00, sized to the stated invalidation level. Stop
loss at 132.00, below the recent swing low. First trim tier near +25%
gain, second tier near +50% gain, consistent with the standard scaling
rule for this time horizon.

## Risk Awareness
No emotional reasoning detected in this setup; the thesis is not chasing
a recent spike, and a hard stop is defined. Proceeding is reasonable given
the defined risk.

## Exit Discipline
Action: hold through the defined trim tiers unless the stop is hit. If
the stock gaps below the stop overnight, exit at the open rather than
waiting for a better fill. Warning: if conviction starts eroding after
one weak quarter, that is normal noise, not a reason to abandon the plan
early -- do not let a single data point trigger "you are breaking your
system."

\`\`\`json
${jsonBlock}
\`\`\``;
}

describe("scenario 1: well-formed response", () => {
  it("parses with extraction.ok === true and all 5 sections non-empty", () => {
    const result = parseJarvisResponse(wellFormedResponse());

    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.verdict).toBe("proceed");
      expect(result.extraction.data.entry_zone).toEqual({
        low: 140.5,
        high: 148.0,
      });
      expect(result.extraction.data.trim_targets).toHaveLength(2);
    }

    expect(result.sections.thesis.length).toBeGreaterThan(0);
    expect(result.sections.stressTest.length).toBeGreaterThan(0);
    expect(result.sections.tradePlan.length).toBeGreaterThan(0);
    expect(result.sections.riskAwareness.length).toBeGreaterThan(0);
    expect(result.sections.exitDiscipline.length).toBeGreaterThan(0);

    // Spot-check section boundaries are correct, not just non-empty.
    expect(result.sections.thesis).toContain("market currently prices");
    expect(result.sections.thesis).not.toContain("Stress Test");
    expect(result.sections.stressTest).toContain("pulled-forward demand");
    expect(result.sections.tradePlan).toContain("Entry zone");
  });
});

describe("scenario 2: missing JSON block", () => {
  it("returns ok: false with sections still populated", () => {
    const withoutJson = wellFormedResponse().replace(
      /```json[\s\S]*```/,
      "",
    );
    const result = parseJarvisResponse(withoutJson);

    expect(result.extraction.ok).toBe(false);
    if (!result.extraction.ok) {
      expect(result.extraction.rawJson).toBeNull();
      expect(result.extraction.error).toMatch(/no valid.*json/i);
    }

    expect(result.sections.thesis.length).toBeGreaterThan(0);
    expect(result.sections.stressTest.length).toBeGreaterThan(0);
    expect(result.sections.tradePlan.length).toBeGreaterThan(0);
    expect(result.sections.riskAwareness.length).toBeGreaterThan(0);
    expect(result.sections.exitDiscipline.length).toBeGreaterThan(0);
  });
});

describe("scenario 3: malformed JSON (trailing comma)", () => {
  it("returns ok: false, rawJson: null, without throwing", () => {
    const malformedBlock = `{
  "entry_zone": { "low": 140.5, "high": 148.0 },
  "stop_loss": 132.0,
  "trim_targets": [ { "price": 175.0, "pct_of_position": 30 }, ],
  "time_exit_date": "2026-12-15",
  "reassessment_date": "2026-10-01",
  "earnings_date": null,
  "invalidation_condition": "A weekly close below 128 invalidates.",
  "catalyst": "Q3 earnings.",
  "verdict": "proceed",
  "position_size_note": "Standard sizing.",
}`;
    const raw = wellFormedResponse(malformedBlock);

    let result;
    expect(() => {
      result = parseJarvisResponse(raw);
    }).not.toThrow();

    expect(result!.extraction.ok).toBe(false);
    if (!result!.extraction.ok) {
      expect(result!.extraction.rawJson).toBeNull();
      expect(result!.extraction.error).toMatch(/no valid.*json/i);
    }
  });
});

describe("scenario 4: two ```json blocks", () => {
  it("uses the LAST block, not the first", () => {
    const echoedBlock = `{
  "entry_zone": { "low": 1, "high": 2 },
  "stop_loss": 0.5,
  "trim_targets": [ { "price": 3, "pct_of_position": 50 } ],
  "time_exit_date": null,
  "reassessment_date": null,
  "earnings_date": null,
  "invalidation_condition": "example schema echo",
  "catalyst": "example schema echo",
  "verdict": "reject",
  "position_size_note": "example schema echo"
}`;
    const responseWithEcho = wellFormedResponse().replace(
      "## Trade Plan\n",
      `## Trade Plan\nFor reference, the required output shape looks like:\n\`\`\`json\n${echoedBlock}\n\`\`\`\n`,
    );

    const result = parseJarvisResponse(responseWithEcho);

    // Sanity: the raw text really does contain two fenced json blocks.
    expect(responseWithEcho.match(/```json/g)).toHaveLength(2);

    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.verdict).toBe("proceed");
      expect(result.extraction.data.entry_zone).toEqual({
        low: 140.5,
        high: 148.0,
      });
      expect(result.extraction.data.invalidation_condition).not.toContain(
        "example schema echo",
      );
    }
  });

  it("extractTrailingJsonBlock alone also returns the last block", () => {
    const raw = `\`\`\`json\n{"a": 1}\n\`\`\`\nsome narrative in between\n\`\`\`json\n{"a": 2}\n\`\`\``;
    expect(extractTrailingJsonBlock(raw)).toEqual({ a: 2 });
  });
});

describe("scenario 5: entry_zone.low > entry_zone.high", () => {
  // Decision (documented in lib/jarvis-parser.ts's AlertCriteriaExtractSchema
  // JSDoc and in the task report): accepted as-is, not schema-rejected.
  // This is a shape/type validator, not a business-logic validator; an
  // inverted zone degrades harmlessly downstream (Task 11's trigger check
  // never matches any real price against an inverted range) rather than
  // discarding an otherwise-valid, otherwise-usable JSON block.
  it("is accepted by the schema and by parseJarvisResponse", () => {
    const invertedBlock = VALID_JSON_BLOCK.replace(
      '"entry_zone": { "low": 140.5, "high": 148.0 }',
      '"entry_zone": { "low": 148.0, "high": 140.5 }',
    );

    const schemaResult = AlertCriteriaExtractSchema.safeParse(
      JSON.parse(invertedBlock),
    );
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) {
      expect(schemaResult.data.entry_zone.low).toBeGreaterThan(
        schemaResult.data.entry_zone.high,
      );
    }

    const result = parseJarvisResponse(wellFormedResponse(invertedBlock));
    expect(result.extraction.ok).toBe(true);
    if (result.extraction.ok) {
      expect(result.extraction.data.entry_zone).toEqual({
        low: 148.0,
        high: 140.5,
      });
    }
  });
});

describe("adversarial inputs that must never throw", () => {
  it("empty string", () => {
    expect(() => parseJarvisResponse("")).not.toThrow();
    const result = parseJarvisResponse("");
    expect(result.extraction.ok).toBe(false);
    expect(result.sections).toEqual({
      thesis: "",
      stressTest: "",
      tradePlan: "",
      riskAwareness: "",
      exitDiscipline: "",
    });
  });

  it("a response with no headers at all", () => {
    const raw = "The stock looks fine I guess, no structured output here.";
    expect(() => parseJarvisResponse(raw)).not.toThrow();
    const result = parseJarvisResponse(raw);
    expect(result.extraction.ok).toBe(false);
    expect(result.sections.thesis).toBe("");
    expect(result.sections.exitDiscipline).toBe("");
  });

  it("a response where the JSON block appears BEFORE the narrative sections", () => {
    const raw = `\`\`\`json\n${VALID_JSON_BLOCK}\n\`\`\`\n## Thesis Structuring\nSome thesis text.\n## Stress Test\nSome stress test text.\n## Trade Plan\nSome trade plan text.\n## Risk Awareness\nSome risk text.\n## Exit Discipline\nSome exit text.`;

    expect(() => parseJarvisResponse(raw)).not.toThrow();
    const result = parseJarvisResponse(raw);

    expect(result.extraction.ok).toBe(true);
    expect(result.sections.thesis).toContain("Some thesis text");
    expect(result.sections.exitDiscipline).toContain("Some exit text");
  });

  it("a JSON block that parses but is the wrong shape (schema validation failure)", () => {
    const raw = wellFormedResponse('{"not": "the right shape"}');
    expect(() => parseJarvisResponse(raw)).not.toThrow();
    const result = parseJarvisResponse(raw);
    expect(result.extraction.ok).toBe(false);
    if (!result.extraction.ok) {
      expect(result.extraction.rawJson).toEqual({ not: "the right shape" });
      expect(result.extraction.error).toMatch(/schema validation/i);
    }
  });

  it("a JSON block containing a JSON array instead of an object", () => {
    const raw = wellFormedResponse("[1, 2, 3]");
    expect(() => parseJarvisResponse(raw)).not.toThrow();
    const result = parseJarvisResponse(raw);
    expect(result.extraction.ok).toBe(false);
  });

  it("non-string-coercible garbage doesn't crash extractTrailingJsonBlock", () => {
    expect(() => extractTrailingJsonBlock("```json```")).not.toThrow();
    expect(extractTrailingJsonBlock("```json```")).toBeNull();
    expect(() => extractTrailingJsonBlock("no fences here at all")).not.toThrow();
    expect(extractTrailingJsonBlock("no fences here at all")).toBeNull();
  });

  it("an invalid verdict enum value fails schema validation without throwing", () => {
    const badVerdictBlock = VALID_JSON_BLOCK.replace(
      '"verdict": "proceed"',
      '"verdict": "maybe"',
    );
    const raw = wellFormedResponse(badVerdictBlock);
    expect(() => parseJarvisResponse(raw)).not.toThrow();
    const result = parseJarvisResponse(raw);
    expect(result.extraction.ok).toBe(false);
  });
});
