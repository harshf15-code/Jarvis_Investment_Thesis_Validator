import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/lib/supabase/server";
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
    vi.mocked(createClient).mockResolvedValue(
      buildMock({
        positions: [POSITION],
        entries: [{ position_id: "p1", quantity: 10, price: 100 }],
        exits: [],
        stocks: [{ id: "s1", last_price: 120, exchange: "US", currency: "USD" }],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: OVERDUE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalsByCurrency).toHaveLength(1);
    expect(body.totalsByCurrency[0].currency).toBe("USD");
    expect(body.totalsByCurrency[0].absolute).toBe(200); // (120-100)*10
    expect(body.totalsByCurrency[0].percent).toBeCloseTo(20); // 200 / (100*10)
    expect(body.totalsByCurrency[0].positions).toBe(1);
    expect(body.overdueTickers).toContain("AAPL");
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0].weightedAverage).toEqual({ totalQuantity: 10, averagePrice: 100 });
    expect(body.positions[0].convictionTier).toBe("I");
    expect(body.positions[0].stock.exchange).toBe("US");
  });

  it("prices only the quantity still held after a partial exit", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildMock({
        positions: [{ ...POSITION, status: "partial_exit" }],
        entries: [{ position_id: "p1", quantity: 10, price: 100 }],
        exits: [{ position_id: "p1", quantity: 4, price: 130 }],
        stocks: [{ id: "s1", last_price: 120, exchange: "US", currency: "USD" }],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: FUTURE }],
        theses: [{ id: "t1", conviction_tier: "II" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const res = await GET();
    const body = await res.json();

    expect(body.totalsByCurrency[0].absolute).toBe(120); // (120-100) * 6 remaining
    expect(body.totalsByCurrency[0].percent).toBeCloseTo(20); // 120 / (100*6) — cost basis of the remainder
    expect(body.overdueTickers).toEqual([]);
  });

  it("excludes a position with no quoted price from the P&L totals", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildMock({
        positions: [POSITION, { ...POSITION, id: "p2", ticker: "MSFT", stock_id: "s2" }],
        entries: [
          { position_id: "p1", quantity: 10, price: 100 },
          { position_id: "p2", quantity: 5, price: 200 },
        ],
        exits: [],
        stocks: [
          { id: "s1", last_price: 120, exchange: "US", currency: "USD" },
          { id: "s2", last_price: null, exchange: "US", currency: "USD" },
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
    expect(body.totalsByCurrency).toHaveLength(1);
    expect(body.totalsByCurrency[0].absolute).toBe(200);
    expect(body.totalsByCurrency[0].percent).toBeCloseTo(20);
    expect(body.totalsByCurrency[0].positions).toBe(1);
    expect(body.positions).toHaveLength(2);
  });

  it("totals a mixed-currency book per currency, never blended", async () => {
    // The defect this replaced: one scalar summing (120-100)*10 dollars with
    // (1200-1000)*10 rupees to 2200 of nothing, divided by a cost basis of
    // 11,000 of nothing. Both numbers below are individually true; no
    // arithmetic relates them, because no exchange rate exists here.
    vi.mocked(createClient).mockResolvedValue(
      buildMock({
        positions: [POSITION, { ...POSITION, id: "p2", ticker: "INFY", stock_id: "s2" }],
        entries: [
          { position_id: "p1", quantity: 10, price: 100 },
          { position_id: "p2", quantity: 10, price: 1000 },
        ],
        exits: [],
        stocks: [
          { id: "s1", last_price: 120, exchange: "US", currency: "USD" },
          { id: "s2", last_price: 1200, exchange: "NSE", currency: "INR" },
        ],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: FUTURE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const res = await GET();
    const body = await res.json();

    expect(body.totalsByCurrency).toHaveLength(2);
    // Largest cost basis leads: ₹10,000 of rupees ahead of $1,000 of dollars.
    expect(body.totalsByCurrency.map((t: { currency: string }) => t.currency)).toEqual(["INR", "USD"]);

    const inr = body.totalsByCurrency[0];
    expect(inr).toMatchObject({ currency: "INR", absolute: 2000, positions: 1 });
    expect(inr.percent).toBeCloseTo(20);

    const usd = body.totalsByCurrency[1];
    expect(usd).toMatchObject({ currency: "USD", absolute: 200, positions: 1 });
    expect(usd.percent).toBeCloseTo(20);
  });

  it("keeps NSE and BSE in one rupee total rather than splitting by exchange", async () => {
    // The old display-side mitigation keyed on ExchangeCode, so a book holding
    // one NSE name and one BSE name was labelled "mixed currencies" while
    // being entirely rupees. Currency is the right key; exchange never was.
    vi.mocked(createClient).mockResolvedValue(
      buildMock({
        positions: [POSITION, { ...POSITION, id: "p2", ticker: "TCS", stock_id: "s2" }],
        entries: [
          { position_id: "p1", quantity: 10, price: 100 },
          { position_id: "p2", quantity: 10, price: 100 },
        ],
        exits: [],
        stocks: [
          { id: "s1", last_price: 120, exchange: "NSE", currency: "INR" },
          { id: "s2", last_price: 120, exchange: "BSE", currency: "INR" },
        ],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: null, target_2: null, time_exit_date: FUTURE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const body = await (await GET()).json();

    expect(body.totalsByCurrency).toHaveLength(1);
    expect(body.totalsByCurrency[0]).toMatchObject({ currency: "INR", absolute: 400, positions: 2 });
  });

  it("lists an overdue ticker once even when two positions share it", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildMock({
        positions: [POSITION, { ...POSITION, id: "p2" }],
        entries: [],
        exits: [],
        stocks: [{ id: "s1", last_price: 120, exchange: "US", currency: "USD" }],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: null, target_2: null, time_exit_date: OVERDUE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const res = await GET();
    const body = await res.json();

    expect(body.overdueTickers).toEqual(["AAPL"]);
  });

  it("joins each recommendation to its stock and asks for them newest-first", async () => {
    const mock = buildMock({
      positions: [],
      stocks: [{ id: "s9", last_price: 250, exchange: "NSE", currency: "INR" }],
      jarvis_recommendations: [
        { id: "r1", stock_id: "s9", ticker: "INFY", converted_to_position: false },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await GET();
    const body = await res.json();

    expect(body.positions).toEqual([]);
    expect(body.totalsByCurrency).toEqual([]);
    expect(body.overdueTickers).toEqual([]);
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].recommendation.ticker).toBe("INFY");
    expect(body.recommendations[0].stock.last_price).toBe(250);
    expect(mock._order).toHaveBeenCalledWith("recommended_at", { ascending: false });
  });

  it("returns 500 when the positions read fails", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock({ _positionsError: [1] }) as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("boom");
  });
});
