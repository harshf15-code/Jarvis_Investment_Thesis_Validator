import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "@/lib/concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in INPUT order, not completion order", async () => {
    // The failure this guards: callers zip results back against the input, so
    // completion order would pair each holding with a different holding's data.
    const delays = [40, 5, 25, 1];
    const out = await mapWithConcurrency(delays, 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual(delays);
  });

  it("never runs more than `limit` at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapWithConcurrency([], 8, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 8, async (n) => n * 2)).toEqual([2, 4]);
  });
});
