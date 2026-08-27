import { describe, expect, it } from "vitest";
import { computeRiskReward, computeMaxDrawdownPct, computeCashAtRisk } from "@/lib/risk-reward";

describe("computeRiskReward", () => {
  it("computes reward/risk ratio using the midpoint of entry to target vs entry to stop", () => {
    // risk = 100-90=10, reward = 130-100=30 -> 3:1
    expect(computeRiskReward({ entry: 100, stop: 90, target: 130 })).toBe(3);
  });
  it("returns null when stop equals entry (undefined risk)", () => {
    expect(computeRiskReward({ entry: 100, stop: 100, target: 130 })).toBe(null);
  });
});

describe("computeMaxDrawdownPct", () => {
  it("computes percent distance from entry to stop", () => {
    expect(computeMaxDrawdownPct({ entry: 100, stop: 90 })).toBe(10);
  });
});

describe("computeCashAtRisk", () => {
  it("computes rupees at risk given portfolio value, position size %, entry, and stop", () => {
    // position value = 100000 * 5% = 5000; drawdown 10% -> 500 at risk
    expect(computeCashAtRisk({ portfolioValue: 100000, positionSizePct: 5, entry: 100, stop: 90 })).toBe(500);
  });
});
