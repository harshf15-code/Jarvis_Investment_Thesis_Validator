import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { callsFor, createMockSupabase, fail, ok } from "./mock-supabase";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
  resolveYahooSymbol: vi.fn(
    (ticker: string, exchange: string) => `${ticker.toUpperCase()}.${exchange}`,
  ),
  MarketDataError: class MarketDataError extends Error {},
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote, MarketDataError } from "@/lib/market-data";
import { GET, POST } from "@/app/api/stocks/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const STOCK_ROW = {
  id: "stock-1",
  ticker: "AAPL",
  yahoo_symbol: "AAPL.US",
  exchange: "US",
  type: "watchlist",
  status: "watching",
  consecutive_failure_count: 0,
  stale_since: null,
  last_price: 190.12,
  last_price_at: "2026-08-27T00:00:00.000Z",
  created_at: "2026-08-27T00:00:00.000Z",
  deleted_at: null,
};

const HOLDING_ROW = {
  stock_id: "stock-1",
  shares: 10,
  cost_basis: 150,
  date_acquired: "2024-01-15",
  updated_at: "2026-08-27T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/stocks", () => {
  it("returns 400 and touches no Supabase call for an invalid body", async () => {
    const response = await POST(jsonRequest({ ticker: "", exchange: "US", type: "watchlist" }));

    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 422 with a ticker field error, and never inserts, when the quote lookup fails", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(
      new MarketDataError("no regularMarketPrice"),
    );
    const { client, calls } = createMockSupabase([]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await POST(
      jsonRequest({ ticker: "BADTICKER", exchange: "US", type: "watchlist" }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.field).toBe("ticker");
    expect(calls.length).toBe(0);
  });

  it("rethrows a non-MarketDataError from getQuote instead of treating it as a bad ticker", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(new Error("network down"));

    await expect(
      POST(jsonRequest({ ticker: "AAPL", exchange: "US", type: "watchlist" })),
    ).rejects.toThrow("network down");
  });

  it("creates a watchlist entry (no holdings insert) on success", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({ price: 190.12, asOf: new Date("2026-08-27") });
    const { client, calls } = createMockSupabase([ok(STOCK_ROW)]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await POST(
      jsonRequest({ ticker: "aapl", exchange: "US", type: "watchlist" }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.holding).toBeNull();
    expect(callsFor(calls, "stocks", "insert")).toHaveLength(1);
    expect(callsFor(calls, "holdings", "insert")).toHaveLength(0);
  });

  it("creates both the stock and holding rows for a holding, in order", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({ price: 190.12, asOf: new Date("2026-08-27") });
    const { client, calls } = createMockSupabase([
      ok({ ...STOCK_ROW, type: "holding" }),
      ok(HOLDING_ROW),
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await POST(
      jsonRequest({
        ticker: "aapl",
        exchange: "US",
        type: "holding",
        shares: 10,
        cost_basis: 150,
        date_acquired: "2024-01-15",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.holding).toEqual(HOLDING_ROW);
    expect(callsFor(calls, "stocks", "insert")).toHaveLength(1);
    expect(callsFor(calls, "holdings", "insert")).toHaveLength(1);
    expect(callsFor(calls, "stocks", "delete")).toHaveLength(0);
  });

  it("deletes the just-created stocks row for real when the holdings insert fails (orphan cleanup)", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({ price: 190.12, asOf: new Date("2026-08-27") });
    const { client, calls } = createMockSupabase([
      ok({ ...STOCK_ROW, type: "holding" }), // stocks insert succeeds
      fail("holdings insert failed"), // holdings insert fails
      ok(null), // stocks delete (cleanup)
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await POST(
      jsonRequest({
        ticker: "aapl",
        exchange: "US",
        type: "holding",
        shares: 10,
        cost_basis: 150,
        date_acquired: "2024-01-15",
      }),
    );

    expect(response.status).toBe(500);

    const deleteCalls = callsFor(calls, "stocks", "delete");
    expect(deleteCalls).toHaveLength(1);

    // The cleanup delete must target the exact row just created.
    const eqCallsAfterDelete = calls.filter(
      (call) => call.table === "stocks" && call.method === "eq",
    );
    const lastEqCall = eqCallsAfterDelete[eqCallsAfterDelete.length - 1];
    expect(lastEqCall.args).toEqual(["id", STOCK_ROW.id]);
  });

  it("returns a distinct, actionable error when the orphan-cleanup delete itself fails", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({ price: 190.12, asOf: new Date("2026-08-27") });
    const { client, calls } = createMockSupabase([
      ok({ ...STOCK_ROW, type: "holding" }), // stocks insert succeeds
      fail("holdings insert failed"), // holdings insert fails
      fail("cleanup delete failed"), // stocks delete (cleanup) ALSO fails
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await POST(
      jsonRequest({
        ticker: "aapl",
        exchange: "US",
        type: "holding",
        shares: 10,
        cost_basis: 150,
        date_acquired: "2024-01-15",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    // The cleanup delete was still attempted (and its result checked)...
    expect(callsFor(calls, "stocks", "delete")).toHaveLength(1);
    // ...but since it failed too, the response must say so distinctly from
    // the "cleanup succeeded" case, so this is diagnosable rather than
    // silently swallowed.
    expect(body.error).toMatch(/cleanup/i);
    expect(body.error).not.toBe("holdings insert failed");
  });

  it("maps a unique-violation stock insert failure to 409", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({ price: 190.12, asOf: new Date("2026-08-27") });
    const { client } = createMockSupabase([fail("duplicate key", "23505")]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await POST(
      jsonRequest({ ticker: "aapl", exchange: "US", type: "watchlist" }),
    );

    expect(response.status).toBe(409);
  });
});

describe("GET /api/stocks", () => {
  it("joins each stock with its holdings row (or null), ordered as returned", async () => {
    const stocks = [
      { ...STOCK_ROW, id: "stock-1", type: "holding" },
      { ...STOCK_ROW, id: "stock-2", type: "watchlist" },
    ];
    const holdings = [{ ...HOLDING_ROW, stock_id: "stock-1" }];
    const { client } = createMockSupabase([ok(stocks), ok(holdings)]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].holding).toEqual(holdings[0]);
    expect(body[1].holding).toBeNull();
  });

  it("returns an empty list without querying holdings when there are no stocks", async () => {
    const { client, calls } = createMockSupabase([ok([])]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual([]);
    expect(callsFor(calls, "holdings", "select")).toHaveLength(0);
  });

  it("returns 500 when the stocks query fails", async () => {
    const { client } = createMockSupabase([fail("db is down")]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await GET();
    expect(response.status).toBe(500);
  });
});
