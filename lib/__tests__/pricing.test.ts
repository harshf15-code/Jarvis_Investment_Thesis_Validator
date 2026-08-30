import { describe, expect, it } from "vitest";

import { estimateCostUsd, priceFor } from "@/lib/llm/pricing";

describe("estimateCostUsd", () => {
  it("prices a known model from its input and output rates", () => {
    // 1M in at $3 + 1M out at $15
    expect(estimateCostUsd("anthropic/claude-sonnet-4.5", 1_000_000, 1_000_000)).toBe(18);
  });

  it("keeps sub-cent precision rather than rounding a small call to zero", () => {
    // A loop of calls each rounded to zero would be free, and would pass every
    // budget check forever.
    const cost = estimateCostUsd("anthropic/claude-sonnet-4.5", 1000, 500);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("charges an unknown model at Sonnet rates, never free", () => {
    // Under-pricing an unrecognised model is an unbounded bill; over-pricing it
    // trips the cap early, which is only a complaint.
    expect(priceFor("some/model-nobody-added").inputPerMTok).toBeGreaterThan(0);
    expect(estimateCostUsd("some/model-nobody-added", 100_000, 100_000)).toBeGreaterThan(0);
  });

  it("is zero for a call that produced no tokens", () => {
    expect(estimateCostUsd("anthropic/claude-sonnet-4.5", 0, 0)).toBe(0);
  });
});
