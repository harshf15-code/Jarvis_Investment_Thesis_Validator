import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
  resolveYahooSymbol: (ticker: string, exchange: string) =>
    exchange === "NSE" ? `${ticker}.NS` : exchange === "BSE" ? `${ticker}.BO` : ticker,
}));

import { currentUser } from "@/lib/auth/user";
import { getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

type Table = Record<string, unknown>;

/**
 * Chains exactly as deep as the route goes, and throws on a table the route
 * should never touch — so a new query breaks its test loudly.
 *
 * `failOn` makes one insert fail, which is how the compensating-delete path
 * gets exercised.
 */
function buildSupabaseMock(opts: { held?: string[]; failOn?: string } = {}) {
  const calls = {
    theses: [] as unknown[][],
    trade_plans: [] as unknown[][],
    positions: [] as unknown[][],
    entries: [] as unknown[][],
    deletedThesisIds: null as string[] | null,
    batchUpdates: [] as Table[],
    profileUpserts: [] as Table[],
  };

  const insertFor = (table: keyof typeof calls) =>
    vi.fn().mockImplementation(async (rows: unknown[]) => {
      (calls[table] as unknown[][]).push(rows);
      return opts.failOn === table ? { error: { message: `${table} exploded` } } : { error: null };
    });

  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: (opts.held ?? []).map((ticker) => ({ ticker })),
              error: null,
            }),
          }),
          insert: insertFor("positions"),
        };
      }
      if (table === "portfolio_imports") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }),
            }),
          }),
          update: vi.fn().mockImplementation((patch: Table) => {
            calls.batchUpdates.push(patch);
            const eq = vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: "batch-1", ...patch }, error: null }),
              }),
            });
            // The failure path awaits `.eq(...)` directly, with no `.select()`.
            return { eq: Object.assign(vi.fn().mockImplementation((...args) => eq(...args)), {}) };
          }),
        };
      }
      if (table === "theses") {
        return {
          insert: insertFor("theses"),
          delete: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation(async (_col: string, ids: string[]) => {
              calls.deletedThesisIds = ids;
              return { error: null };
            }),
          }),
        };
      }
      if (table === "trade_plans") return { insert: insertFor("trade_plans") };
      if (table === "entries") return { insert: insertFor("entries") };
      if (table === "portfolio_profiles") {
        return {
          upsert: vi.fn().mockImplementation(async (patch: Table) => {
            calls.profileUpserts.push(patch);
            return { error: null };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _calls: calls,
  };
  return client;
}

function buildAdminMock() {
  return {
    from: vi.fn().mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockImplementation(async () => ({
          data: [
            { id: "stock-infy", yahoo_symbol: "INFY.NS" },
            { id: "stock-tcs", yahoo_symbol: "TCS.NS" },
          ],
          error: null,
        })),
      }),
    }),
  };
}

function post(body: Record<string, unknown>) {
  return new Request("http://test/api/portfolio/imports", {
    method: "POST",
    body: JSON.stringify({
      source_filename: "holdings.csv",
      market: "IN",
      as_of_date: "2026-08-01",
      rows: [{ ticker: "INFY", quantity: 10, averagePrice: 1500 }],
      ...body,
    }),
  }) as never;
}

describe("POST /api/portfolio/imports", () => {
  let supabase: ReturnType<typeof buildSupabaseMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
    supabase = buildSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    vi.mocked(createAdminClient).mockReturnValue(buildAdminMock() as never);
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "INFY.NS" || symbol === "TCS.NS") {
        return { price: 1600, asOf: new Date("2026-08-31T10:00:00Z"), name: "A Company" };
      }
      throw new Error("not found");
    });
  });

  it("401s a request with no session", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    expect((await POST(post({}))).status).toBe(401);
  });

  it("writes one thesis, plan, position and entry per holding, in four inserts", async () => {
    const res = await POST(
      post({
        rows: [
          { ticker: "INFY", quantity: 10, averagePrice: 1500, note: "Cheap on cash flows" },
          { ticker: "TCS", quantity: 5, averagePrice: 3200 },
        ],
      }),
    );
    expect(res.status).toBe(201);

    const { theses, trade_plans, positions, entries } = supabase._calls;
    // One insert call each, carrying two rows — not four calls per holding.
    expect([theses, trade_plans, positions, entries].map((c) => c.length)).toEqual([1, 1, 1, 1]);
    expect(theses[0]).toHaveLength(2);

    const [infy] = theses[0] as Record<string, unknown>[];
    expect(infy).toMatchObject({
      source: "imported",
      mode: "stock_only",
      status: "active",
      ticker: "INFY",
      markets: ["IN"],
      import_batch_id: "batch-1",
      input_text: "Cheap on cash flows",
    });
  });

  it("gives a holding with no note an input_text that says so", async () => {
    // `theses.input_text` is NOT NULL, and a later per-holding review is only
    // as grounded as this field — so it must never be a placeholder that reads
    // like the trader's own words.
    await POST(post({}));
    const [thesis] = supabase._calls.theses[0] as Record<string, unknown>[];
    expect(thesis.input_text).toMatch(/No stated reason recorded at import/);
  });

  it("creates the trade plan with every level null", async () => {
    await POST(post({}));
    const [plan] = supabase._calls.trade_plans[0] as Record<string, unknown>[];
    expect(Object.keys(plan).sort()).toEqual(["id", "thesis_id"]);
  });

  it("points the position and entry at the ids generated for that row", async () => {
    await POST(post({}));
    const [thesis] = supabase._calls.theses[0] as Record<string, unknown>[];
    const [plan] = supabase._calls.trade_plans[0] as Record<string, unknown>[];
    const [position] = supabase._calls.positions[0] as Record<string, unknown>[];
    const [entry] = supabase._calls.entries[0] as Record<string, unknown>[];
    // Ids are generated up front precisely so this never depends on PostgREST
    // returning inserted rows in the order they were sent.
    expect(position.thesis_id).toBe(thesis.id);
    expect(position.trade_plan_id).toBe(plan.id);
    expect(entry.position_id).toBe(position.id);
    expect(entry).toMatchObject({ tranche: "T1", quantity: 10, price: 1500, date: "2026-08-01" });
  });

  it("stamps the batch date on an entry and flags the note as approximate", async () => {
    await POST(post({ as_of_date: "2026-07-15" }));
    const [entry] = supabase._calls.entries[0] as Record<string, unknown>[];
    expect(entry.date).toBe("2026-07-15");
    expect(entry.notes).toMatch(/holdings\.csv/);
    expect(entry.notes).toMatch(/approximate/);
  });

  it("deletes the theses and leaves the batch failed when an insert fails", async () => {
    // theses -> trade_plans -> positions -> entries all cascade from theses, so
    // deleting the theses unwinds a half-written batch completely.
    supabase = buildSupabaseMock({ failOn: "entries" });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await POST(post({}));
    expect(res.status).toBe(500);

    const thesisIds = (supabase._calls.theses[0] as Record<string, unknown>[]).map((t) => t.id);
    expect(supabase._calls.deletedThesisIds).toEqual(thesisIds);
    // The batch row survives at its default 'failed', carrying the reason.
    expect(JSON.stringify(supabase._calls.batchUpdates)).toMatch(/entries exploded/);
  });

  it("skips a duplicate the trader did not confirm, and records why", async () => {
    supabase = buildSupabaseMock({ held: ["INFY"] });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await POST(
      post({
        rows: [
          { ticker: "INFY", quantity: 10, averagePrice: 1500 },
          { ticker: "TCS", quantity: 5, averagePrice: 3200 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(supabase._calls.theses[0]).toHaveLength(1);
    const body = await res.json();
    expect(body.skipped[0]).toMatchObject({ ticker: "INFY" });
    expect(body.skipped[0].reason).toMatch(/already hold/);
  });

  it("imports a duplicate the trader did confirm", async () => {
    supabase = buildSupabaseMock({ held: ["INFY"] });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const res = await POST(
      post({ rows: [{ ticker: "INFY", quantity: 10, averagePrice: 1500, confirmedDuplicate: true }] }),
    );
    expect(res.status).toBe(201);
    expect(supabase._calls.theses[0]).toHaveLength(1);
  });

  it("400s when nothing in the batch can be imported", async () => {
    const res = await POST(post({ rows: [{ ticker: "GHOST", quantity: 1, averagePrice: 1 }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0].reason).toMatch(/No listing found/);
    expect(supabase._calls.theses).toHaveLength(0);
  });

  it("refuses a cost basis dated in the future", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await POST(post({ as_of_date: tomorrow }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be in the future/);
  });

  it("refuses more rows than one batch allows", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({
      ticker: `T${i}`,
      quantity: 1,
      averagePrice: 1,
    }));
    expect((await POST(post({ rows }))).status).toBe(400);
  });

  it("refuses a market that is not live yet", async () => {
    expect((await POST(post({ market: "EU" }))).status).toBe(400);
  });

  it("saves the portfolio objective only when one was given", async () => {
    await POST(post({}));
    expect(supabase._calls.profileUpserts).toHaveLength(0);

    supabase = buildSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    await POST(post({ objective: "Compound for ten years." }));
    expect(supabase._calls.profileUpserts[0]).toMatchObject({ objective: "Compound for ten years." });
  });
});
