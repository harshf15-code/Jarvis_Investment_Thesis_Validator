import { describe, expect, it } from "vitest";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";

describe("computeWeightedAverageEntry", () => {
  it("returns the single entry's price for one entry", () => {
    const result = computeWeightedAverageEntry([{ quantity: 100, price: 50 }]);
    expect(result.totalQuantity).toBe(100);
    expect(result.averagePrice).toBe(50);
  });

  it("computes sum(qty*price)/sum(qty) across multiple entries", () => {
    // US-05's formula: (100*50 + 100*60) / 200 = 55
    const result = computeWeightedAverageEntry([
      { quantity: 100, price: 50 },
      { quantity: 100, price: 60 },
    ]);
    expect(result.totalQuantity).toBe(200);
    expect(result.averagePrice).toBe(55);
  });

  it("weights unevenly-sized tranches correctly", () => {
    const result = computeWeightedAverageEntry([
      { quantity: 300, price: 100 },
      { quantity: 100, price: 140 },
    ]);
    expect(result.totalQuantity).toBe(400);
    expect(result.averagePrice).toBe(110);
  });

  it("returns zero for an empty entry list", () => {
    const result = computeWeightedAverageEntry([]);
    expect(result.totalQuantity).toBe(0);
    expect(result.averagePrice).toBe(0);
  });
});
