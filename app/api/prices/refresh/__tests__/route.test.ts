import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
}));
vi.mock("@/lib/crypto-data", () => ({
  getCryptoPrices: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { getCryptoPrices } from "@/lib/crypto-data";
import { getQuote } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

/** Reads `stocks` — the user's own session client, since reads are allowed to it. */
type StockRow = {
  id: string;
  yahoo_symbol: string;
  coingecko_id?: string | null;
  currency?: string | null;
};

function buildReadClientMock(stocks: StockRow[]) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: stocks, error: null }),
      }),
    }),
  };
}

/** Writes the refreshed price back. Separate client on purpose — see 0014. */
function buildWriteClientMock() {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  return { client: { from: vi.fn().mockReturnValue({ update }) }, update, eq };
}

function postWith(stockIds: unknown) {
  return POST(
    new Request("http://test/api/prices/refresh", {
      method: "POST",
      body: JSON.stringify({ stockIds }),
    }) as never,
  );
}

describe("POST /api/prices/refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-array stockIds body", async () => {
    expect((await postWith("not-an-array")).status).toBe(400);
  });

  it("rejects more ids than the per-request cap", async () => {
    // Each id costs an outbound Yahoo fetch (up to 3 attempts) plus a write, so
    // an uncapped list would let one request fan out to thousands of calls.
    const res = await postWith(Array.from({ length: 51 }, (_, i) => `s${i}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 50/i);
  });

  it("accepts a request exactly at the cap", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `s${i}`);
    vi.mocked(createClient).mockResolvedValue(buildReadClientMock([]) as never);
    vi.mocked(createAdminClient).mockReturnValue(buildWriteClientMock().client as never);
    expect((await postWith(ids)).status).toBe(200);
  });

  it("returns fresh prices for each resolvable stock and omits failures", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildReadClientMock([
        { id: "s1", yahoo_symbol: "AAPL" },
        { id: "s2", yahoo_symbol: "BROKEN" },
      ]) as never,
    );
    const writer = buildWriteClientMock();
    vi.mocked(createAdminClient).mockReturnValue(writer.client as never);
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "BROKEN") throw new Error("no quote");
      return { price: 150.25, asOf: new Date("2026-08-27T10:00:00Z"), name: "Apple Inc.", currency: "USD" };
    });

    const res = await postWith(["s1", "s2"]);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.prices.s1.price).toBe(150.25);
    expect(body.prices.s1.asOf).toBe("2026-08-27T10:00:00.000Z");
    // Returned, not just written: a caller holding a currency seeded from
    // `exchange` would otherwise render the stale one until a full reload.
    expect(body.prices.s1.currency).toBe("USD");
    expect(body.prices.s2).toBeUndefined();

    // The price write-back must go through the service-role client: since 0014
    // `authenticated` may read `stocks` but not write it.
    expect(writer.update).toHaveBeenCalledTimes(1);
    expect(writer.update).toHaveBeenCalledWith({
      last_price: 150.25,
      last_price_at: "2026-08-27T10:00:00.000Z",
      // Re-asserted on every refresh, not written once and trusted forever:
      // 0021 seeded `currency` from `exchange`, which is a guess, and this is
      // the path that corrects a row seeded wrong.
      currency: "USD",
    });
  });

  it("leaves the stored currency alone when a quote does not report one", async () => {
    // Overwriting a known currency with a guess would be worse than keeping
    // the one already on the row.
    vi.mocked(createClient).mockResolvedValue(
      buildReadClientMock([{ id: "s1", yahoo_symbol: "AAPL" }]) as never,
    );
    const writer = buildWriteClientMock();
    vi.mocked(createAdminClient).mockReturnValue(writer.client as never);
    vi.mocked(getQuote).mockResolvedValue({
      price: 150.25,
      asOf: new Date("2026-08-27T10:00:00Z"),
      name: "Apple Inc.",
      currency: null,
    } as never);

    await postWith(["s1"]);

    expect(writer.update).toHaveBeenCalledWith({
      last_price: 150.25,
      last_price_at: "2026-08-27T10:00:00.000Z",
    });
  });
});

describe("POST /api/prices/refresh — crypto", () => {
  const coin = (over: Partial<StockRow> = {}): StockRow => ({
    id: "s-btc",
    yahoo_symbol: "coingecko:bitcoin:inr",
    coingecko_id: "bitcoin",
    currency: "INR",
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCryptoPrices).mockResolvedValue(
      new Map([["bitcoin", { price: 7515223, asOf: new Date("2026-09-04T00:00:00Z") }]]) as never,
    );
  });

  it("prices a coin through CoinGecko, never through Yahoo", async () => {
    // `yahoo_symbol` on a coin is the synthetic `coingecko:<id>:<currency>`
    // key -- a deliberate lie in one column. Handing it to getQuote fails on
    // every load of a coin position, which is what this route is FOR.
    const writer = buildWriteClientMock();
    vi.mocked(createClient).mockResolvedValue(buildReadClientMock([coin()]) as never);
    vi.mocked(createAdminClient).mockReturnValue(writer.client as never);

    const body = await (await postWith(["s-btc"])).json();

    expect(getQuote).not.toHaveBeenCalled();
    expect(getCryptoPrices).toHaveBeenCalledWith(["bitcoin"], "INR");
    expect(body.prices["s-btc"]).toMatchObject({ price: 7515223, currency: "INR" });
  });

  it("asks once per currency, not once per coin", async () => {
    // /simple/price is batched, so a book showing eight coins is one call.
    vi.mocked(getCryptoPrices).mockResolvedValue(new Map() as never);
    vi.mocked(createClient).mockResolvedValue(
      buildReadClientMock([
        coin(),
        coin({ id: "s-eth", yahoo_symbol: "coingecko:ethereum:inr", coingecko_id: "ethereum" }),
      ]) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue(buildWriteClientMock().client as never);

    await postWith(["s-btc", "s-eth"]);

    expect(getCryptoPrices).toHaveBeenCalledTimes(1);
    expect(getCryptoPrices).toHaveBeenCalledWith(["bitcoin", "ethereum"], "INR");
  });

  it("leaves the stored price alone when CoinGecko is down", async () => {
    // The last polled price is a better answer than a blank.
    const writer = buildWriteClientMock();
    vi.mocked(getCryptoPrices).mockRejectedValue(new Error("429"));
    vi.mocked(createClient).mockResolvedValue(buildReadClientMock([coin()]) as never);
    vi.mocked(createAdminClient).mockReturnValue(writer.client as never);

    const res = await postWith(["s-btc"]);

    expect(res.status).toBe(200);
    expect((await res.json()).prices).toEqual({});
    expect(writer.update).not.toHaveBeenCalled();
  });

  it("prices a mixed request at both sources", async () => {
    const writer = buildWriteClientMock();
    vi.mocked(getQuote).mockResolvedValue({
      price: 1600,
      asOf: new Date("2026-09-04T10:00:00Z"),
      name: "Infosys",
      currency: "INR",
    } as never);
    vi.mocked(createClient).mockResolvedValue(
      buildReadClientMock([
        coin(),
        { id: "s-infy", yahoo_symbol: "INFY.NS", coingecko_id: null, currency: "INR" },
      ]) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue(writer.client as never);

    const body = await (await postWith(["s-btc", "s-infy"])).json();

    expect(getQuote).toHaveBeenCalledWith("INFY.NS");
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(body.prices["s-btc"].price).toBe(7515223);
    expect(body.prices["s-infy"].price).toBe(1600);
  });
});
