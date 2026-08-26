import { describe, expect, it, vi } from "vitest";

import { resolveYahooSymbol, withRetry } from "@/lib/market-data";

describe("resolveYahooSymbol", () => {
  it("appends .NS and uppercases for NSE", () => {
    expect(resolveYahooSymbol("reliance", "NSE")).toBe("RELIANCE.NS");
  });

  it("appends .BO and uppercases for BSE", () => {
    expect(resolveYahooSymbol("reliance", "BSE")).toBe("RELIANCE.BO");
  });

  it("adds no suffix (but still uppercases) for US", () => {
    expect(resolveYahooSymbol("aapl", "US")).toBe("AAPL");
  });
});

describe("withRetry", () => {
  // `baseDelayMs: 1` (rather than mocking timers) keeps this suite fast
  // without needing to fight fake-timer/promise-microtask interleaving:
  // withRetry's own backoff math is exercised (exponential doubling is
  // still exact), just at a millisecond scale instead of the real
  // 500ms/1000ms default.

  it("resolves with the eventual result after failing twice, and calls fn exactly 3 times", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("success");

    const result = await withRetry(fn, { retries: 2, baseDelayMs: 1 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rejects with the last error after retries + 1 attempts when fn always fails", async () => {
    const retries = 2;
    let callCount = 0;
    const fn = vi.fn<() => Promise<never>>().mockImplementation(() => {
      callCount += 1;
      return Promise.reject(new Error(`fail ${callCount}`));
    });

    await expect(withRetry(fn, { retries, baseDelayMs: 1 })).rejects.toThrow(
      `fail ${retries + 1}`,
    );
    expect(fn).toHaveBeenCalledTimes(retries + 1);
  });

  it("uses the default of 2 retries (3 total attempts) when opts is omitted", async () => {
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("nope"));

    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry at all when fn succeeds on the first attempt", async () => {
    const fn = vi.fn<() => Promise<string>>().mockResolvedValueOnce("ok");

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).resolves.toBe(
      "ok",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
