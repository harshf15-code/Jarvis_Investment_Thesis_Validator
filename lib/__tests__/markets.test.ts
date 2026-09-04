import { describe, expect, it } from "vitest";

import {
  LIVE_MARKETS,
  MARKETS,
  THESIS_MARKETS,
  THESIS_MARKET_CHOICES,
  exchangesFor,
  currencyForExchange,
  currencyForMarket,
  formatMarketPrice,
  isLiveMarket,
  isMarketCode,
  localeForCurrency,
  marketForExchange,
  symbolForCurrency,
} from "@/lib/markets";

describe("markets", () => {
  it("exposes exactly the markets that can actually be priced", () => {
    // Three since 0030. Crypto is priced by CoinGecko rather than Yahoo, but
    // priced is priced — a coin can be held, valued and alerted on. What it
    // cannot be is the subject of a thesis, and that is `THESIS_MARKETS`, not
    // this list. The two questions were the same until crypto arrived.
    expect(LIVE_MARKETS).toEqual(["US", "IN", "CRYPTO"]);
  });

  /**
   * CN/EU/EM are deliberately present but not live. `stocks` carries a
   * currency since 0021, so their prices would at least be LABELLED correctly
   * — but nothing can resolve one of these names in the first place:
   * `exchange_code` has no value for SSE, LSE or XETRA, `exchangesFor` is
   * empty for all three, and `resolveYahooSymbol` has no suffix to build. They
   * must never pass the live check that gates thesis creation.
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

describe("currency", () => {
  it("maps each live market's exchanges to that market's currency", () => {
    expect(currencyForExchange("NSE")).toBe("INR");
    expect(currencyForExchange("BSE")).toBe("INR");
    expect(currencyForExchange("US")).toBe("USD");
  });

  it("agrees with the market table it is derived from", () => {
    expect(currencyForMarket("IN")).toBe("INR");
    expect(currencyForMarket("US")).toBe("USD");
    // Not live, but still a real answer — the watch on a `stocks` row does not
    // care whether a thesis could be run against that market.
    expect(currencyForMarket("CN")).toBe("CNY");
  });

  it("gives INR the locale that groups digits the Indian way", () => {
    expect(localeForCurrency("INR")).toBe("en-IN");
    expect(localeForCurrency("inr")).toBe("en-IN");
  });

  it("resolves USD to en-US rather than to Emerging Markets' entry", () => {
    // Both US and EM name USD. First in MARKET_ORDER wins, which is US.
    expect(localeForCurrency("USD")).toBe("en-US");
  });

  it("falls back to en-US for a currency no market claims", () => {
    expect(localeForCurrency("SGD")).toBe("en-US");
  });

  it("names a currency it has no symbol for rather than borrowing one", () => {
    expect(symbolForCurrency("INR")).toBe("₹");
    expect(symbolForCurrency("USD")).toBe("$");
    // The one thing it must never do is fall through to ₹ or $.
    expect(symbolForCurrency("SGD")).toBe("SGD ");
  });
});

describe("CRYPTO market", () => {
  it("is live, so a holding can be imported into it", () => {
    expect(MARKETS.CRYPTO.live).toBe(true);
  });

  it("is not offered for a thesis", () => {
    // Crypto is holdings-only in v1: there is no Discovery shortlist for it and
    // no memorandum to write. A market picker that offers it would produce a
    // thesis the rest of the app cannot service.
    expect(MARKETS.CRYPTO.tradable).toBe(false);
    expect(THESIS_MARKETS).not.toContain("CRYPTO");
    expect(THESIS_MARKETS).toContain("IN");
    expect(THESIS_MARKETS).toContain("US");
  });

  it("has no exchanges, because a coin is not listed anywhere", () => {
    expect(MARKETS.CRYPTO.exchanges).toEqual([]);
  });

  it("is absent from the thesis picker rather than greyed out in it", () => {
    // CN/EU/EM render disabled as "coming soon" because they genuinely are.
    // Crypto is not coming soon, so showing it that way would promise a
    // feature nobody plans to build.
    expect(THESIS_MARKET_CHOICES).not.toContain("CRYPTO");
    expect(THESIS_MARKET_CHOICES).toContain("CN");
  });

  it("keeps every equity market tradable", () => {
    // Guards against `tradable` being added and then silently defaulting the
    // existing markets to false.
    expect(MARKETS.IN.tradable).toBe(true);
    expect(MARKETS.US.tradable).toBe(true);
  });
});
