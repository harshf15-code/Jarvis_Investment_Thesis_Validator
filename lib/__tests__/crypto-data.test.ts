import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CryptoDataError, cryptoStockKey, fetchTopCoins, getCryptoPrices } from "@/lib/crypto-data";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("COINGECKO_API_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("cryptoStockKey", () => {
  it("builds a key that cannot collide with a Yahoo symbol", () => {
    // Yahoo symbols are uppercase and contain no colons, so this namespace is
    // unreachable from the equity side.
    expect(cryptoStockKey("bitcoin", "INR")).toBe("coingecko:bitcoin:inr");
  });

  it("lower-cases the currency so one coin in one book is one key", () => {
    expect(cryptoStockKey("bitcoin", "inr")).toBe(cryptoStockKey("bitcoin", "INR"));
  });

  it("distinguishes the same coin in two currencies", () => {
    // The whole reason the grain is (coin, currency): `stocks` carries
    // last_price AND currency on the row.
    expect(cryptoStockKey("bitcoin", "INR")).not.toBe(cryptoStockKey("bitcoin", "USD"));
  });
});

describe("getCryptoPrices", () => {
  it("prices every coin in one call, in the currency asked for", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({
        bitcoin: { inr: 7515223, last_updated_at: 1788544990 },
        ethereum: { inr: 231262, last_updated_at: 1788544990 },
      }),
    );

    const prices = await getCryptoPrices(["bitcoin", "ethereum"], "INR");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("ids=bitcoin%2Cethereum");
    expect(url).toContain("vs_currencies=inr");
    expect(prices.get("bitcoin")?.price).toBe(7515223);
    expect(prices.get("ethereum")?.asOf).toEqual(new Date(1788544990 * 1000));
  });

  it("sends the demo key as a header, never in the query string", async () => {
    // A key in a URL ends up in logs, referrers and error reports.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ bitcoin: { usd: 1 } }));
    await getCryptoPrices(["bitcoin"], "USD");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("test-key");
    expect((init?.headers as Record<string, string>)["x-cg-demo-api-key"]).toBe("test-key");
  });

  it("omits a coin the response does not mention rather than inventing a zero", async () => {
    // A missing price must not read as a price of nothing: `last_price` stays
    // null and the UI says "Price unavailable". A zero renders a holding as a
    // total loss.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ bitcoin: { usd: 79551 } }));
    const prices = await getCryptoPrices(["bitcoin", "dogecoin"], "USD");
    expect(prices.has("dogecoin")).toBe(false);
    expect(prices.size).toBe(1);
  });

  it("throws on a rate limit rather than returning an empty book", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as Response);
    await expect(getCryptoPrices(["bitcoin"], "USD")).rejects.toThrow(CryptoDataError);
    // Once, not three times. A rate limit will not clear in 500ms, and backing
    // off into it spends two more calls out of 10,000/month to learn the same
    // thing. The hourly poll is the retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does retry a server error, which backing off can actually fix", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response)
      .mockResolvedValue(ok({ bitcoin: { usd: 79551 } }));

    const prices = await getCryptoPrices(["bitcoin"], "USD");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prices.get("bitcoin")?.price).toBe(79551);
  });

  it("does not call the API at all for an empty id list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect((await getCryptoPrices([], "INR")).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to run unconfigured rather than silently reporting no prices", async () => {
    vi.stubEnv("COINGECKO_API_KEY", "");
    await expect(getCryptoPrices(["bitcoin"], "USD")).rejects.toThrow(/COINGECKO_API_KEY/);
  });
});

describe("fetchTopCoins", () => {
  it("returns the ranked universe with upper-cased symbols", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok([
        { id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1 },
        { id: "ethereum", symbol: "eth", name: "Ethereum", market_cap_rank: 2 },
      ]),
    );

    const coins = await fetchTopCoins(10);

    expect(coins).toEqual([
      { coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 },
      { coingecko_id: "ethereum", symbol: "ETH", name: "Ethereum", market_cap_rank: 2 },
    ]);
  });
});
