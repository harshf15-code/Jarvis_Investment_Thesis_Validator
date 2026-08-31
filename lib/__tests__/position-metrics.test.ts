import { describe, expect, it } from "vitest";
import { computePositionPnl, computeDistanceToStop, isNearStop } from "@/lib/position-metrics";

describe("computePositionPnl", () => {
  it("computes absolute and percent return", () => {
    const pnl = computePositionPnl({ currentPrice: 120, avgEntry: 100, quantity: 50 });
    expect(pnl.absolute).toBe(1000);
    expect(pnl.percent).toBe(20);
  });

  it("returns a negative return when price is below entry", () => {
    const pnl = computePositionPnl({ currentPrice: 90, avgEntry: 100, quantity: 10 });
    expect(pnl.absolute).toBe(-100);
    expect(pnl.percent).toBe(-10);
  });
});

describe("computeDistanceToStop", () => {
  it("returns positive rupee and percent distance when above stop", () => {
    const d = computeDistanceToStop({ currentPrice: 110, stopLoss: 100 });
    expect(d).not.toBeNull();
    expect(d!.absolute).toBe(10);
    expect(d!.percent).toBeCloseTo(9.09, 1);
  });

  it("returns null when there is no stop set", () => {
    expect(computeDistanceToStop({ currentPrice: 110, stopLoss: null })).toBeNull();
  });

  it("returns zero-or-negative distance when at or below stop", () => {
    const d = computeDistanceToStop({ currentPrice: 95, stopLoss: 100 });
    expect(d!.absolute).toBe(-5);
  });
});

describe("isNearStop", () => {
  it("flags a position inside the 3% danger zone", () => {
    // 100 -> 98 is 2% above the stop.
    expect(isNearStop({ currentPrice: 100, stopLoss: 98 })).toBe(true);
  });

  it("does not flag a position comfortably above its stop", () => {
    // 100 -> 90 is 10% above the stop.
    expect(isNearStop({ currentPrice: 100, stopLoss: 90 })).toBe(false);
  });

  it("flags a position already trading through its stop", () => {
    expect(isNearStop({ currentPrice: 89, stopLoss: 90 })).toBe(true);
  });

  it("flags the exact boundary", () => {
    expect(isNearStop({ currentPrice: 100, stopLoss: 97 })).toBe(true);
  });

  it("honours an explicit threshold", () => {
    expect(isNearStop({ currentPrice: 100, stopLoss: 95, thresholdPercent: 3 })).toBe(false);
    expect(isNearStop({ currentPrice: 100, stopLoss: 95, thresholdPercent: 6 })).toBe(true);
  });

  it("is not an alert when the stop or the quote is missing", () => {
    expect(isNearStop({ currentPrice: 100, stopLoss: null })).toBe(false);
    expect(isNearStop({ currentPrice: null, stopLoss: 98 })).toBe(false);
  });
});
