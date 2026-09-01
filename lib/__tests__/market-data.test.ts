import { describe, expect, it, vi } from "vitest";

// The module instantiates `new YahooFinance()` once at import time, so the
// class itself is what has to be replaced. `vi.hoisted` is what lets the spy
// exist before the (hoisted) factory closes over it.
const { quoteSummary } = vi.hoisted(() => ({ quoteSummary: vi.fn() }));
vi.mock("yahoo-finance2", () => ({
  default: class {
    quoteSummary = quoteSummary;
  },
}));

import { getSectorProfile, resolveYahooSymbol, withRetry } from "@/lib/market-data";

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

  // yahoo-finance2 sets `code` to the HTTP status on its own HTTPError.
  const httpError = (code: number) => Object.assign(new Error(`HTTP ${code}`), { code });

  it("gives up immediately on a 404 rather than re-asking a settled question", async () => {
    // The cost this saves is not the two extra requests, it is the 1.5s of
    // backoff between them — paid once per exchange probed, and paid again on
    // the second probe that runs after the model call.
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(httpError(404));

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("HTTP 404");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying a 429, which says not now rather than never", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce("ok");

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying every status that is not on the permanent list", async () => {
    // 401 and 403 are the ones worth naming. Yahoo answers them under load and
    // when its crumb/cookie state goes stale — they describe the session, not
    // the symbol — and `withRetry` backs the thesis run, the CSV import and the
    // scheduled price poll alike. An allow-list of one keeps them retryable.
    for (const code of [400, 401, 403, 408, 500, 502, 503]) {
      const fn = vi.fn<() => Promise<never>>().mockRejectedValue(httpError(code));
      await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(`HTTP ${code}`);
      expect(fn).toHaveBeenCalledTimes(3);
    }
  });

  it("recovers when a 401 clears on the second attempt", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError(401))
      .mockResolvedValueOnce("ok");

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying a transport error, whose code is a string", async () => {
    // `ECONNRESET`/`ENOTFOUND` also arrive on `code`. Treating those as
    // permanent would turn one dropped connection into a failed thesis.
    const fn = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("socket hang up");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("keeps retrying an error with no code at all", async () => {
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("plain"));

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("plain");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("getSectorProfile", () => {
  it("reads sector and industry as Yahoo classifies them", async () => {
    quoteSummary.mockResolvedValueOnce({
      assetProfile: { sector: "Industrials", industry: "Aerospace & Defense" },
    });

    await expect(getSectorProfile("HAL.NS")).resolves.toEqual({
      sector: "Industrials",
      industry: "Aerospace & Defense",
    });
    // One module, not four: the pattern read wants the classification and has
    // no use for the fundamentals `getFundamentals` pulls.
    expect(quoteSummary).toHaveBeenCalledWith("HAL.NS", { modules: ["assetProfile"] });
  });

  it("returns nulls when Yahoo has no profile for the symbol", async () => {
    // True of ETFs (LIQUIDCASE), some ADRs and plenty of small-caps. The read
    // is told the sector is unknown and instructed not to guess, so this is the
    // path that puts a holding in "doesn't fit any pattern" honestly.
    quoteSummary.mockResolvedValueOnce({});

    await expect(getSectorProfile("LIQUIDCASE.NS")).resolves.toEqual({
      sector: null,
      industry: null,
    });
  });

  it("treats an empty-string classification as no classification", async () => {
    quoteSummary.mockResolvedValueOnce({ assetProfile: { sector: "", industry: "Utilities" } });

    await expect(getSectorProfile("X.NS")).resolves.toEqual({
      sector: null,
      industry: "Utilities",
    });
  });
});
