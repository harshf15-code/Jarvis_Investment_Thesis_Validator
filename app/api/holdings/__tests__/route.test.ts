import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/crypto-data", () => ({
  getCryptoPrices: vi.fn(),
  cryptoStockKey: (id: string, cur: string) => `coingecko:${id}:${cur.toLowerCase()}`,
}));

import { currentUser } from "@/lib/auth/user";
import { getCryptoPrices } from "@/lib/crypto-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

const PF1 = "11111111-1111-4111-8111-111111111111";

let stockUpsert: Record<string, unknown> | null = null;
let inserted: Record<string, Record<string, unknown>[]> = {};
let deleted = false;

function mockClients(
  opts: { book?: { base_currency: string } | null; coin?: boolean; insertFails?: string } = {},
) {
  const book = opts.book === undefined ? { base_currency: "INR" } : opts.book;
  const user = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: book ? { id: PF1, ...book } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "crypto_universe") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  opts.coin === false
                    ? null
                    : { coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        insert: async (rows: Record<string, unknown>[]) => {
          inserted[table] = rows;
          return { error: opts.insertFails === table ? { message: "boom" } : null };
        },
        delete: () => ({
          in: async () => {
            deleted = true;
            return { error: null };
          },
        }),
      };
    }),
  };
  const admin = {
    from: vi.fn().mockImplementation(() => ({
      upsert: (row: Record<string, unknown>) => {
        stockUpsert = row;
        return {
          select: () => ({ single: async () => ({ data: { id: "stock-1" }, error: null }) }),
        };
      },
    })),
  };
  return { user, admin };
}

function useMocks(opts: Parameters<typeof mockClients>[0] = {}) {
  const { user, admin } = mockClients(opts);
  vi.mocked(createClient).mockResolvedValue(user as never);
  vi.mocked(createAdminClient).mockReturnValue(admin as never);
}

const post = (body: Record<string, unknown> = {}) =>
  new Request("http://test/api/holdings", {
    method: "POST",
    body: JSON.stringify({
      portfolio_id: PF1,
      coingecko_id: "bitcoin",
      quantity: 0.0043,
      price: 7515223,
      date: "2026-09-01",
      ...body,
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  stockUpsert = null;
  inserted = {};
  deleted = false;
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  useMocks();
  vi.mocked(getCryptoPrices).mockResolvedValue(
    new Map([["bitcoin", { price: 7515223, asOf: new Date("2026-09-04T00:00:00Z") }]]) as never,
  );
});

describe("POST /api/holdings", () => {
  it("creates a position, a thesis and a plan for the coin", async () => {
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(inserted.positions).toHaveLength(1);
    expect(inserted.theses).toHaveLength(1);
    expect(inserted.trade_plans).toHaveLength(1);
    expect(inserted.entries).toHaveLength(1);
  });

  it("prices the coin in the BOOK's currency, asking the trader nothing", async () => {
    await POST(post());
    expect(getCryptoPrices).toHaveBeenCalledWith(["bitcoin"], "INR");
    expect(stockUpsert).toMatchObject({
      yahoo_symbol: "coingecko:bitcoin:inr",
      coingecko_id: "bitcoin",
      asset_class: "crypto",
      exchange: "CRYPTO",
      currency: "INR",
    });
  });

  it("never queues a coin for the weekly holding watch", async () => {
    await POST(post());
    expect(inserted.holding_watch_state).toBeUndefined();
  });

  it("records the holding even when CoinGecko is down", async () => {
    // A missing last_price renders as "Price unavailable" and the next poll
    // fills it in. Losing the holding because a third party is down would be
    // worse.
    vi.mocked(getCryptoPrices).mockRejectedValue(new Error("429"));
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(inserted.positions).toHaveLength(1);
  });

  it("leaves a shared cached price alone when CoinGecko is down", async () => {
    // This row is shared by every book holding the same (coin, currency).
    // Writing null over it would blank a good price for positions this add
    // never touched -- so the fields are OMITTED, not nulled, and the upsert
    // leaves whatever the last successful poll stored.
    vi.mocked(getCryptoPrices).mockRejectedValue(new Error("429"));
    await POST(post());
    expect(stockUpsert).not.toHaveProperty("last_price");
    expect(stockUpsert).not.toHaveProperty("last_price_at");
  });

  it("writes the price when there IS one", async () => {
    await POST(post());
    expect(stockUpsert).toMatchObject({ last_price: 7515223 });
  });

  it("refuses a cost basis dated in the future", async () => {
    // A holding bought tomorrow is not a holding, and a future cost-basis date
    // corrupts every return this app computes from it.
    const res = await POST(post({ date: "2099-01-01" }));
    expect(res.status).toBe(400);
    expect(inserted.positions).toBeUndefined();
  });

  it("refuses a book this trader cannot see", async () => {
    useMocks({ book: null });
    expect((await POST(post())).status).toBe(404);
  });

  it("refuses a coin outside the tracked universe", async () => {
    // Guards the failure this feature exists to stop: a free-text ticker
    // resolving to the wrong asset with no error.
    useMocks({ coin: false });
    const res = await POST(post({ coingecko_id: "not-a-coin" }));
    expect(res.status).toBe(400);
    expect(inserted.positions).toBeUndefined();
  });

  it("refuses a non-positive quantity before writing anything", async () => {
    expect((await POST(post({ quantity: 0 }))).status).toBe(400);
    expect(inserted.positions).toBeUndefined();
  });

  it("accepts a ten-decimal quantity, which is why 0029 widened the column", async () => {
    const res = await POST(post({ quantity: 0.0000000001 }));
    expect(res.status).toBe(201);
    expect(inserted.entries[0].quantity).toBe(0.0000000001);
  });

  it("unwinds a half-written holding when an insert fails", async () => {
    // Everything cascades from `theses`, so deleting them is the whole undo.
    useMocks({ insertFails: "positions" });
    expect((await POST(post())).status).toBe(500);
    expect(deleted).toBe(true);
  });

  it("401s when not signed in", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    expect((await POST(post())).status).toBe(401);
  });

  it("rejects a body it cannot parse before touching the database", async () => {
    const res = await POST(
      new Request("http://test/api/holdings", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});
