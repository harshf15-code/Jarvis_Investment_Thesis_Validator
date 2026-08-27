import { describe, expect, it } from "vitest";
import { computePositionPnl, computeDistanceToStop } from "@/lib/position-metrics";

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
    expect(d!.rupees).toBe(10);
    expect(d!.percent).toBeCloseTo(9.09, 1);
  });

  it("returns null when there is no stop set", () => {
    expect(computeDistanceToStop({ currentPrice: 110, stopLoss: null })).toBeNull();
  });

  it("returns zero-or-negative distance when at or below stop", () => {
    const d = computeDistanceToStop({ currentPrice: 95, stopLoss: 100 });
    expect(d!.rupees).toBe(-5);
  });
});
