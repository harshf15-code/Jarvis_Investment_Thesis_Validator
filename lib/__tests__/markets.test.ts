import { describe, expect, it } from "vitest";

import {
  LIVE_MARKETS,
  MARKETS,
  exchangesFor,
  formatMarketPrice,
  isLiveMarket,
  isMarketCode,
  marketForExchange,
} from "@/lib/markets";

describe("markets", () => {
  it("exposes exactly the two markets that can actually be priced", () => {
    expect(LIVE_MARKETS).toEqual(["US", "IN"]);
  });

  /**
   * CN/EU/EM are deliberately present but not live. Pricing them needs a
   * currency column on `stocks` and FX-aware trade-plan geometry; until that
   * exists a half-priced report is worse than none, so they must never pass
   * the live check that gates thesis creation.
   */
  it("recognises non-live markets without treating them as usable", () => {
    for (const code of ["CN", "EU", "EM"] as const) {
      expect(isMarketCode(code)).toBe(true);
      expect(isLiveMarket(code)).toBe(false);
      expect(exchangesFor(code)).toEqual([]);
    }
  });

  it("rejects anything that is not a market code", () => {
    expect(isMarketCode("JP")).toBe(false);
    expect(isMarketCode(null)).toBe(false);
    expect(isLiveMarket("NSE")).toBe(false);
  });

  /**
   * India is one market across two exchanges — the reason `MarketCode` cannot
   * simply be `ExchangeCode`.
   */
  it("maps India to both its exchanges and the US to one", () => {
    expect(exchangesFor("IN")).toEqual(["NSE", "BSE"]);
    expect(exchangesFor("US")).toEqual(["US"]);
    expect(marketForExchange("NSE")).toBe("IN");
    expect(marketForExchange("BSE")).toBe("IN");
    expect(marketForExchange("US")).toBe("US");
  });

  /**
   * A Tokyo listing has no suffix in either live market's probe list, which is
   * what stops FANUC (6954.T) being shortlisted for a US or India run at all.
   */
  it("gives no live market an exchange that could resolve a foreign listing", () => {
    const all = LIVE_MARKETS.flatMap((m) => exchangesFor(m));
    expect(all).toEqual(expect.arrayContaining(["US", "NSE", "BSE"]));
    expect(all).toHaveLength(3);
  });

  it("formats prices in each market's own currency and digit grouping", () => {
    expect(formatMarketPrice(356.45, "US")).toBe("$356.45");
    // en-IN groups in lakhs: 1,00,000 not 100,000.
    expect(formatMarketPrice(100000, "IN")).toBe("₹1,00,000");
    expect(MARKETS.IN.currency).toBe("INR");
    expect(MARKETS.US.currency).toBe("USD");
  });
});
