import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import {
  callsFor,
  createMockSupabase,
  fail,
  ok,
} from "../../../stocks/__tests__/mock-supabase";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { DELETE, PATCH } from "@/app/api/fundamentals/[stockId]/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function deleteRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function ctx(stockId = "stock-1") {
  return { params: Promise.resolve({ stockId }) };
}

const AUTO_ROW = {
  id: 1,
  stock_id: "stock-1",
  metric_key: "P/E",
  metric_value: "24.5",
  source: "auto",
  updated_at: "2026-08-27T00:00:00.000Z",
};

const MANUAL_ROW = {
  id: 2,
  stock_id: "stock-1",
  metric_key: "Custom P/S",
  metric_value: "4.2",
  source: "manual",
  updated_at: "2026-08-27T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/fundamentals/[stockId]", () => {
  it("returns 400 and touches no Supabase call for an invalid body", async () => {
    const response = await PATCH(jsonRequest({ metric_key: "" }), ctx());
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 404 when the stock doesn't exist (or is soft-deleted)", async () => {
    const { client } = createMockSupabase([ok(null)]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(
      jsonRequest({ metric_key: "Custom P/S", metric_value: "4.2" }),
      ctx(),
    );
    expect(response.status).toBe(404);
  });

  it("creates a brand-new manual metric when no row exists for the key yet", async () => {
    const { client, calls } = createMockSupabase([
      ok({ id: "stock-1" }), // stockExists
      ok(null), // findExistingSource: no existing row
      ok(MANUAL_ROW), // upsert
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(
      jsonRequest({ metric_key: "Custom P/S", metric_value: "4.2" }),
      ctx(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(MANUAL_ROW);
    expect(callsFor(calls, "fundamentals", "upsert")).toHaveLength(1);
  });

  it("edits an existing manual metric's value", async () => {
    const { client, calls } = createMockSupabase([
      ok({ id: "stock-1" }), // stockExists
      ok({ source: "manual" }), // findExistingSource: existing manual row
      ok({ ...MANUAL_ROW, metric_value: "5.0" }), // upsert
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(
      jsonRequest({ metric_key: "Custom P/S", metric_value: "5.0" }),
      ctx(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.metric_value).toBe("5.0");
    expect(callsFor(calls, "fundamentals", "upsert")).toHaveLength(1);
  });

  it("rejects (409) a PATCH whose key collides with an existing auto-pulled row, and never touches the upsert", async () => {
    const { client, calls } = createMockSupabase([
      ok({ id: "stock-1" }), // stockExists
      ok({ source: AUTO_ROW.source }), // findExistingSource: existing auto row
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(
      jsonRequest({ metric_key: AUTO_ROW.metric_key, metric_value: "99" }),
      ctx(),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/auto-pulled/i);
    // The critical invariant: the auto row is never touched by an upsert.
    expect(callsFor(calls, "fundamentals", "upsert")).toHaveLength(0);
  });

  it("returns 500 when checking the existing row's source fails", async () => {
    const { client } = createMockSupabase([
      ok({ id: "stock-1" }), // stockExists
      fail("db is down"), // findExistingSource
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await PATCH(
      jsonRequest({ metric_key: "Custom P/S", metric_value: "4.2" }),
      ctx(),
    );
    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/fundamentals/[stockId]", () => {
  it("returns 400 when the 'key' query param is missing", async () => {
    const response = await DELETE(
      deleteRequest("http://localhost/api/fundamentals/stock-1"),
      ctx(),
    );
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 404 when the stock doesn't exist", async () => {
    const { client } = createMockSupabase([ok(null)]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await DELETE(
      deleteRequest(
        "http://localhost/api/fundamentals/stock-1?key=Custom%20P%2FS",
      ),
      ctx(),
    );
    expect(response.status).toBe(404);
  });

  it("deletes the row, scoped to source='manual'", async () => {
    const { client, calls } = createMockSupabase([
      ok({ id: "stock-1" }), // stockExists
      ok(null), // delete
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await DELETE(
      deleteRequest(
        "http://localhost/api/fundamentals/stock-1?key=Custom%20P%2FS",
      ),
      ctx(),
    );
    expect(response.status).toBe(204);

    const deleteCalls = callsFor(calls, "fundamentals", "delete");
    expect(deleteCalls).toHaveLength(1);
    const eqCalls = calls.filter(
      (call) => call.table === "fundamentals" && call.method === "eq",
    );
    expect(
      eqCalls.some(
        (call) => call.args[0] === "source" && call.args[1] === "manual",
      ),
    ).toBe(true);
  });
});
