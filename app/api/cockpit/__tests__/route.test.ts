import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/lib/supabase/server";
import { buildSupabaseMock, fakePortfolio, type TableRows } from "@/lib/testing/supabase-mock";
import { GET } from "../route";

// Real uuid shapes: the route parses `?portfolio=` strictly, so a fixture id
// like "pf-1" would be rejected before any of these assertions were reached.
const PF1 = "11111111-1111-4111-8111-111111111111";
const PF2 = "22222222-2222-4222-8222-222222222222";

const OVERDUE = "2020-01-01";
const FUTURE = "2099-12-31";

const OWNED = fakePortfolio({ id: PF1, name: "My Portfolio" });
const MANAGED = fakePortfolio({
  id: PF2,
  name: "Mom",
  ownership: "managed",
  beneficiary_name: "Mom",
  is_default: false,
});

/** Every book test needs the `portfolios` read the route now makes first. */
function mock(rows: TableRows, errors?: Record<string, { message: string }>) {
  return buildSupabaseMock({ portfolios: [OWNED], ...rows }, { errors });
}

/** The route refuses an unscoped request, so every call names a book. */
function req(scope: string = PF1) {
  return new Request(`http://t/api/cockpit?portfolio=${scope}`);
}

const POSITION = {
  id: "p1",
  ticker: "AAPL",
  stock_id: "s1",
  trade_plan_id: "tp1",
  thesis_id: "t1",
  status: "active",
  portfolio_id: PF1,
};

describe("GET /api/cockpit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates positions, total open P&L, and overdue theses", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mock({
        positions: [POSITION],
        entries: [{ position_id: "p1", quantity: 10, price: 100 }],
        exits: [],
        stocks: [{ id: "s1", last_price: 120, exchange: "US", currency: "USD" }],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: OVERDUE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const res = await GET(req());
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
      mock({
        positions: [{ ...POSITION, status: "partial_exit" }],
        entries: [{ position_id: "p1", quantity: 10, price: 100 }],
        exits: [{ position_id: "p1", quantity: 4, price: 130 }],
        stocks: [{ id: "s1", last_price: 120, exchange: "US", currency: "USD" }],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: 130, target_2: 150, time_exit_date: FUTURE }],
        theses: [{ id: "t1", conviction_tier: "II" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const body = await (await GET(req())).json();

    expect(body.totalsByCurrency[0].absolute).toBe(120); // (120-100) * 6 remaining
    expect(body.totalsByCurrency[0].percent).toBeCloseTo(20); // cost basis of the remainder
    expect(body.overdueTickers).toEqual([]);
  });

  it("excludes a position with no quoted price from the P&L totals", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mock({
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

    const body = await (await GET(req())).json();

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
      mock({
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

    const body = await (await GET(req())).json();

    expect(body.totalsByCurrency).toHaveLength(2);
    // One position each, so the tie breaks on the code — a stable order that
    // does NOT rank ₹10,000 above $1,000 by comparing the raw numbers.
    expect(body.totalsByCurrency.map((t: { currency: string }) => t.currency)).toEqual(["INR", "USD"]);

    const inr = body.totalsByCurrency[0];
    expect(inr).toMatchObject({ currency: "INR", absolute: 2000, positions: 1 });
    expect(inr.percent).toBeCloseTo(20);

    const usd = body.totalsByCurrency[1];
    expect(usd).toMatchObject({ currency: "USD", absolute: 200, positions: 1 });
    expect(usd.percent).toBeCloseTo(20);
  });

  it("orders sub-books by position count, never by comparing the raw money", async () => {
    // The trap: ₹10,000 is a bigger NUMBER than $2,000 and worth far less.
    vi.mocked(createClient).mockResolvedValue(
      mock({
        positions: [
          POSITION,
          { ...POSITION, id: "p2", ticker: "MSFT", stock_id: "s1" },
          { ...POSITION, id: "p3", ticker: "INFY", stock_id: "s2" },
        ],
        entries: [
          { position_id: "p1", quantity: 10, price: 100 },
          { position_id: "p2", quantity: 10, price: 100 },
          { position_id: "p3", quantity: 10, price: 1000 },
        ],
        exits: [],
        stocks: [
          { id: "s1", last_price: 120, exchange: "US", currency: "USD" },
          { id: "s2", last_price: 1200, exchange: "NSE", currency: "INR" },
        ],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: null, target_2: null, time_exit_date: FUTURE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const body = await (await GET(req())).json();

    // USD leads on two positions against one, despite ₹10,000 > $2,000.
    expect(body.totalsByCurrency.map((t: { currency: string }) => t.currency)).toEqual(["USD", "INR"]);
    expect(body.totalsByCurrency[0].positions).toBe(2);
  });

  it("keeps NSE and BSE in one rupee total rather than splitting by exchange", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mock({
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

    const body = await (await GET(req())).json();

    expect(body.totalsByCurrency).toHaveLength(1);
    expect(body.totalsByCurrency[0]).toMatchObject({ currency: "INR", absolute: 400, positions: 2 });
  });

  it("lists an overdue ticker once even when two positions share it", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mock({
        positions: [POSITION, { ...POSITION, id: "p2" }],
        entries: [],
        exits: [],
        stocks: [{ id: "s1", last_price: 120, exchange: "US", currency: "USD" }],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: null, target_2: null, time_exit_date: OVERDUE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const body = await (await GET(req())).json();

    expect(body.overdueTickers).toEqual(["AAPL"]);
  });

  it("joins each recommendation to its stock and asks for them newest-first", async () => {
    const m = mock({
      positions: [],
      stocks: [{ id: "s9", last_price: 250, exchange: "NSE", currency: "INR" }],
      jarvis_recommendations: [
        { id: "r1", stock_id: "s9", ticker: "INFY", converted_to_position: false },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(m as never);

    const body = await (await GET(req())).json();

    expect(body.positions).toEqual([]);
    expect(body.totalsByCurrency).toEqual([]);
    expect(body.overdueTickers).toEqual([]);
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].recommendation.ticker).toBe("INFY");
    expect(body.recommendations[0].stock.last_price).toBe(250);
    expect(
      m.calls.some(
        (c) =>
          c.table === "jarvis_recommendations" &&
          c.method === "order" &&
          c.args[0] === "recommended_at",
      ),
    ).toBe(true);
  });

  it("returns 500 when the positions read fails", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mock({ positions: [] }, { positions: { message: "boom" } }) as never,
    );

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("boom");
  });

  /* --- portfolio scoping (0027) ------------------------------------------ */

  it("refuses a request that does not say which portfolio", async () => {
    vi.mocked(createClient).mockResolvedValue(mock({ positions: [] }) as never);

    const res = await GET(new Request("http://t/api/cockpit"));

    // A 400, not a guess. A default here would show one person's money under
    // another's name on exactly the screen nobody re-reads.
    expect(res.status).toBe(400);
  });

  it("scopes the positions read to the book that was asked for", async () => {
    const m = mock({ positions: [], jarvis_recommendations: [] });
    vi.mocked(createClient).mockResolvedValue(m as never);

    await GET(req(PF1));

    expect(m.filters("positions").portfolio_id).toBe(PF1);
  });

  it("404s on a portfolio this trader does not own", async () => {
    vi.mocked(createClient).mockResolvedValue(mock({ positions: [] }) as never);

    const res = await GET(req("99999999-9999-4999-8999-999999999999"));

    // The same answer RLS gives for someone else's row. Refusing differently
    // would confirm the id exists.
    expect(res.status).toBe(404);
  });

  it("sums OWNED books only in the roll-up, and lists the managed one separately", async () => {
    // The whole point of `ownership`: someone else's retirement must not be
    // added to the number the trader reads as their own net worth.
    vi.mocked(createClient).mockResolvedValue(
      buildSupabaseMock({
        portfolios: [OWNED, MANAGED],
        positions: [
          POSITION,
          { ...POSITION, id: "p2", ticker: "INFY", stock_id: "s2", portfolio_id: PF2 },
        ],
        entries: [
          { position_id: "p1", quantity: 10, price: 100 },
          { position_id: "p2", quantity: 10, price: 100 },
        ],
        exits: [],
        stocks: [
          { id: "s1", last_price: 120, exchange: "US", currency: "USD" },
          { id: "s2", last_price: 150, exchange: "US", currency: "USD" },
        ],
        trade_plans: [{ id: "tp1", stop_loss: 90, target_1: null, target_2: null, time_exit_date: FUTURE }],
        theses: [{ id: "t1", conviction_tier: "I" }],
        jarvis_recommendations: [],
      }) as never,
    );

    const body = await (await GET(req("all"))).json();

    // Only the owned book's $200 — not the managed book's $500.
    expect(body.totalsByCurrency).toHaveLength(1);
    expect(body.totalsByCurrency[0].absolute).toBe(200);

    // But the managed book is still shown, with its own number.
    const managed = body.byPortfolio.find(
      (b: { portfolio: { id: string } }) => b.portfolio.id === PF2,
    );
    expect(managed.totalsByCurrency[0].absolute).toBe(500);
    expect(managed.positionCount).toBe(1);
    // And its positions are still on screen — excluded from the total, not hidden.
    expect(body.positions).toHaveLength(2);
  });

  it("gives a MANAGED book opened on its own a real headline total", async () => {
    // The exclusion is about the ROLL-UP: a managed book must not be folded
    // into the trader's own net worth. Opening it on its own asks a different
    // question — "how is the money I run for my mother doing" is the whole
    // reason that book exists — and excluding it there too left her positions
    // on screen above a blank P&L, which is not caution, just a missing number.
    vi.mocked(createClient).mockResolvedValue(
      buildSupabaseMock({
        portfolios: [OWNED, MANAGED],
        positions: [{ ...POSITION, id: "p2", stock_id: "s2", portfolio_id: PF2 }],
        entries: [{ position_id: "p2", quantity: 10, price: 100 }],
        exits: [],
        stocks: [{ id: "s2", last_price: 150, exchange: "US", currency: "USD" }],
        trade_plans: [],
        theses: [],
        jarvis_recommendations: [],
      }) as never,
    );

    const body = await (await GET(req(PF2))).json();

    expect(body.totalsByCurrency).toHaveLength(1);
    expect(body.totalsByCurrency[0].absolute).toBe(500); // (150-100)*10
    expect(body.totalsByCurrency[0].positions).toBe(1);
  });

  it("gives a single book its own byPortfolio entry so the header can name it", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mock({ positions: [], jarvis_recommendations: [] }) as never,
    );

    const body = await (await GET(req(PF1))).json();

    expect(body.scope.mode).toBe("one");
    expect(body.scope.portfolios[0].name).toBe("My Portfolio");
    expect(body.byPortfolio).toHaveLength(1);
  });
});
