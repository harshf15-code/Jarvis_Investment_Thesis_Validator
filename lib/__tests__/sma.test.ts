import { describe, expect, it } from "vitest";

import { simpleMovingAverage } from "@/lib/sma";

describe("simpleMovingAverage", () => {
  it("returns leading nulls until a full window is available, then the rolling average", () => {
    // closes:  [1, 2, 3, 4, 5, 6]
    // window 3 averages: idx0 null, idx1 null, idx2 (1+2+3)/3=2,
    // idx3 (2+3+4)/3=3, idx4 (3+4+5)/3=4, idx5 (4+5+6)/3=5
    const closes = [1, 2, 3, 4, 5, 6];
    const result = simpleMovingAverage(closes, 3);

    expect(result).toEqual([null, null, 2, 3, 4, 5]);
    expect(result).toHaveLength(closes.length);
  });

  it("returns all nulls when the series is shorter than the window", () => {
    expect(simpleMovingAverage([1, 2], 3)).toEqual([null, null]);
  });

  it("returns every value unchanged for a window of 1", () => {
    expect(simpleMovingAverage([10, 20, 30], 1)).toEqual([10, 20, 30]);
  });

  it("handles a window equal to the full series length", () => {
    expect(simpleMovingAverage([1, 2, 3], 3)).toEqual([null, null, 2]);
  });
});
