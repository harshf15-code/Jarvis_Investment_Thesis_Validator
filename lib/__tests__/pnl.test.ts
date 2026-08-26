import { describe, expect, it } from "vitest";

import { computeUnrealizedPnl } from "@/lib/pnl";

describe("computeUnrealizedPnl", () => {
  it("computes a positive absolute and percent gain when last price is above cost basis", () => {
    const result = computeUnrealizedPnl(190.12, 10, 150);

    expect(result.absolute).toBeCloseTo(401.2, 5);
    expect(result.percent).not.toBeNull();
    expect(result.percent!).toBeCloseTo(26.746666667, 5);
  });

  it("computes a negative absolute and percent loss when last price is below cost basis", () => {
    const result = computeUnrealizedPnl(100, 5, 150);

    expect(result.absolute).toBeCloseTo(-250, 5);
    expect(result.percent!).toBeCloseTo(-33.333333, 4);
  });

  it("returns zero absolute and zero percent at breakeven", () => {
    const result = computeUnrealizedPnl(150, 10, 150);

    expect(result.absolute).toBe(0);
    expect(result.percent).toBe(0);
  });

  it("returns null percent (not Infinity or NaN) when cost basis is zero", () => {
    const result = computeUnrealizedPnl(50, 4, 0);

    expect(result.absolute).toBe(200);
    expect(result.percent).toBeNull();
  });

  it("returns zero absolute for a zero-share position regardless of price movement", () => {
    const result = computeUnrealizedPnl(500, 0, 150);

    expect(result.absolute).toBe(0);
    // Percent return per share is still defined even with zero shares held.
    expect(result.percent!).toBeCloseTo(233.333333, 4);
  });

  it("handles fractional shares", () => {
    const result = computeUnrealizedPnl(120, 2.5, 100);

    expect(result.absolute).toBeCloseTo(50, 5);
    expect(result.percent!).toBeCloseTo(20, 5);
  });
});
