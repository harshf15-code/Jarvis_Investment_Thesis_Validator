import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { GET } from "../route";

const OVERDUE = "2020-01-01";
const FUTURE = "2099-12-31";

type TableRows = Record<string, unknown[]>;

/**
 * Every read in the cockpit route is `.select(...)` followed by either
 * `.in(...)` (the id-scoped joins) or `.order(...)` (the recommendations
 * feed), so one shared builder covers all of them.
 */
function buildMock(rows: TableRows) {
  const resolved = (table: string) =>
    Promise.resolve({ data: rows[table] ?? [], error: null });
  const order = vi.fn();
  return {
    _order: order,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions" && rows._positionsError) {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockImplementation(() => resolved(table)),
          order: order.mockImplementation(() => resolved(table)),
        }),
      };
    }),
  };
}

const POSITION = {
  id: "p1",
  ticker: "AAPL",
  stock_id: "s1",
  trade_plan_id: "tp1",
  thesis_id: "t1",
  status: "active",
};

describe("GET /api/cockpit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates positions, total open P&L, and overdue theses", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildMock({
        positions: [POSITION],
        entries: [{ position_id: "p1", quantity: 10, price: 100 }],
        exits: [],
        stocks: [{ id: "s1", last_price: 120, exchange: "US" }],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: OVERDUE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalOpenPnl.absolute).toBe(200); // (120-100)*10
    expect(body.totalOpenPnl.percent).toBeCloseTo(20); // 200 / (100*10)
    expect(body.overdueTickers).toContain("AAPL");
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0].weightedAverage).toEqual({ totalQuantity: 10, averagePrice: 100 });
    expect(body.positions[0].convictionTier).toBe("I");
    expect(body.positions[0].stock.exchange).toBe("US");
  });

  it("prices only the quantity still held after a partial exit", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildMock({
        positions: [{ ...POSITION, status: "partial_exit" }],
        entries: [{ position_id: "p1", quantity: 10, price: 100 }],
        exits: [{ position_id: "p1", quantity: 4, price: 130 }],
        stocks: [{ id: "s1", last_price: 120, exchange: "US" }],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: FUTURE }],
        theses: [{ id: "t1", conviction_tier: "II" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const res = await GET();
    const body = await res.json();

    expect(body.totalOpenPnl.absolute).toBe(120); // (120-100) * 6 remaining
    expect(body.totalOpenPnl.percent).toBeCloseTo(20); // 120 / (100*6) — cost basis of the remainder
    expect(body.overdueTickers).toEqual([]);
  });

  it("excludes a position with no quoted price from the P&L totals", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildMock({
        positions: [POSITION, { ...POSITION, id: "p2", ticker: "MSFT", stock_id: "s2" }],
        entries: [
          { position_id: "p1", quantity: 10, price: 100 },
          { position_id: "p2", quantity: 5, price: 200 },
        ],
        exits: [],
        stocks: [
          { id: "s1", last_price: 120, exchange: "US" },
          { id: "s2", last_price: null, exchange: "US" },
        ],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: FUTURE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const res = await GET();
    const body = await res.json();

    // The unpriced position contributes neither P&L nor cost basis, so the
    // percent stays that of the one position that can actually be valued.
    expect(body.totalOpenPnl.absolute).toBe(200);
    expect(body.totalOpenPnl.percent).toBeCloseTo(20);
    expect(body.positions).toHaveLength(2);
  });

  it("joins each recommendation to its stock and asks for them newest-first", async () => {
    const mock = buildMock({
      positions: [],
      stocks: [{ id: "s9", last_price: 250, exchange: "NSE" }],
      jarvis_recommendations: [
        { id: "r1", stock_id: "s9", ticker: "INFY", converted_to_position: false },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const res = await GET();
    const body = await res.json();

    expect(body.positions).toEqual([]);
    expect(body.totalOpenPnl).toEqual({ absolute: 0, percent: 0 });
    expect(body.overdueTickers).toEqual([]);
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].recommendation.ticker).toBe("INFY");
    expect(body.recommendations[0].stock.last_price).toBe(250);
    expect(mock._order).toHaveBeenCalledWith("recommended_at", { ascending: false });
  });

  it("returns 500 when the positions read fails", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildMock({ _positionsError: [1] }) as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("boom");
  });
});
