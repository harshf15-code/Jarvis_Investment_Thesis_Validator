import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { callsFor, createMockSupabase, fail, ok } from "../../__tests__/mock-supabase";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { DELETE, PATCH } from "@/app/api/stocks/[id]/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function ctx(id = "stock-1") {
  return { params: Promise.resolve({ id }) };
}

const WATCHLIST_STOCK = {
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

const HOLDING_STOCK = { ...WATCHLIST_STOCK, type: "holding" };

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

describe("PATCH /api/stocks/[id]", () => {
  it("returns 400 and touches no Supabase call for an invalid body", async () => {
    const response = await PATCH(jsonRequest({ type: "holding" }), ctx());
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 404 when the stock doesn't exist (or is already soft-deleted)", async () => {
    const { client } = createMockSupabase([ok(null)]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(jsonRequest({ type: "watchlist" }), ctx());
    expect(response.status).toBe(404);
  });

  it("switching to holding upserts holdings and updates stocks.type", async () => {
    const { client, calls } = createMockSupabase([
      ok(WATCHLIST_STOCK), // fetch existing
      ok(null), // holdings upsert
      ok(null), // stocks update
      ok(HOLDING_STOCK), // refetch stock
      ok(HOLDING_ROW), // refetch holding
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(
      jsonRequest({
        type: "holding",
        shares: 10,
        cost_basis: 150,
        date_acquired: "2024-01-15",
      }),
      ctx(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.type).toBe("holding");
    expect(body.holding).toEqual(HOLDING_ROW);
    expect(callsFor(calls, "holdings", "upsert")).toHaveLength(1);
    expect(callsFor(calls, "stocks", "update")).toHaveLength(1);
    expect(callsFor(calls, "holdings", "delete")).toHaveLength(0);
  });

  it("switching to watchlist deletes the holdings row (not the stocks row) and updates stocks.type", async () => {
    const { client, calls } = createMockSupabase([
      ok(HOLDING_STOCK), // fetch existing
      ok(null), // holdings delete
      ok(null), // stocks update
      ok(WATCHLIST_STOCK), // refetch stock
      ok(null), // refetch holding (gone)
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(jsonRequest({ type: "watchlist" }), ctx());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.holding).toBeNull();
    expect(callsFor(calls, "holdings", "delete")).toHaveLength(1);
    expect(callsFor(calls, "stocks", "delete")).toHaveLength(0);
  });

  it("updates holding fields directly when the stock is already a holding", async () => {
    const { client, calls } = createMockSupabase([
      ok(HOLDING_STOCK), // fetch existing
      ok(null), // holdings update
      ok(HOLDING_STOCK), // refetch stock (no stocks.update call needed: stockUpdate empty)
      ok({ ...HOLDING_ROW, shares: 8 }), // refetch holding
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(jsonRequest({ shares: 8 }), ctx());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.holding.shares).toBe(8);
    expect(callsFor(calls, "holdings", "update")).toHaveLength(1);
    expect(callsFor(calls, "stocks", "update")).toHaveLength(0);
  });

  it("rejects holding-field updates on a watchlist-only stock", async () => {
    const { client, calls } = createMockSupabase([ok(WATCHLIST_STOCK)]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(jsonRequest({ shares: 8 }), ctx());

    expect(response.status).toBe(400);
    expect(callsFor(calls, "holdings", "update")).toHaveLength(0);
    expect(callsFor(calls, "stocks", "update")).toHaveLength(0);
  });
});

describe("DELETE /api/stocks/[id]", () => {
  it("soft-deletes by setting deleted_at, and never issues a real stocks delete", async () => {
    const { client, calls } = createMockSupabase([
      ok({ id: "stock-1", deleted_at: null }), // fetch existing
      ok(null), // update
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await DELETE(jsonRequest(undefined), ctx());

    expect(response.status).toBe(204);

    const updateCalls = callsFor(calls, "stocks", "update");
    expect(updateCalls).toHaveLength(1);
    const updatePayload = updateCalls[0].args[0] as { deleted_at: string };
    expect(typeof updatePayload.deleted_at).toBe("string");
    expect(Number.isNaN(Date.parse(updatePayload.deleted_at))).toBe(false);

    // The critical soft-delete invariant: no real DELETE against `stocks`.
    expect(callsFor(calls, "stocks", "delete")).toHaveLength(0);
  });

  it("returns 404 for a stock that doesn't exist", async () => {
    const { client, calls } = createMockSupabase([ok(null)]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await DELETE(jsonRequest(undefined), ctx());

    expect(response.status).toBe(404);
    expect(callsFor(calls, "stocks", "update")).toHaveLength(0);
    expect(callsFor(calls, "stocks", "delete")).toHaveLength(0);
  });

  it("returns 404 (not a second soft delete) for an already soft-deleted stock", async () => {
    const { client, calls } = createMockSupabase([
      ok({ id: "stock-1", deleted_at: "2026-01-01T00:00:00.000Z" }),
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await DELETE(jsonRequest(undefined), ctx());

    expect(response.status).toBe(404);
    expect(callsFor(calls, "stocks", "update")).toHaveLength(0);
    expect(callsFor(calls, "stocks", "delete")).toHaveLength(0);
  });

  it("returns 500 when the update fails", async () => {
    const { client } = createMockSupabase([
      ok({ id: "stock-1", deleted_at: null }),
      fail("db is down"),
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await DELETE(jsonRequest(undefined), ctx());
    expect(response.status).toBe(500);
  });
});
