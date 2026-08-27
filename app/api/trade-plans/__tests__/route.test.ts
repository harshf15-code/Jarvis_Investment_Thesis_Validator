import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

/**
 * Both `.insert(...)` calls echo the row the route actually built back as the
 * created record (same convention as `app/api/trade-plans/[id]/__tests__`), so
 * assertions on the response body test the route's own field mapping rather
 * than a value pre-baked here.
 */
function buildMock(opts: {
  convictionTier: string;
  stockId?: string | null;
  lastPrice?: number | null;
  existingPlan?: { id: string } | null;
}) {
  const tradePlanInsert = vi.fn().mockImplementation((row: Record<string, unknown>) => ({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "tp1", ...row }, error: null }),
    }),
  }));
  const recInsert = vi.fn().mockImplementation((row: Record<string, unknown>) => ({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "rec1", ...row }, error: null }),
    }),
  }));
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "theses") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "t1",
                  stock_id: opts.stockId === undefined ? "s1" : opts.stockId,
                  ticker: "AAPL",
                  conviction_tier: opts.convictionTier,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "stocks") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { last_price: opts.lastPrice === undefined ? 150 : opts.lastPrice },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "trade_plans") {
        return {
          insert: tradePlanInsert,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: opts.existingPlan ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "jarvis_recommendations") return { insert: recInsert };
      throw new Error(`unexpected table ${table}`);
    }),
    _tradePlanInsert: tradePlanInsert,
    _recInsert: recInsert,
  };
}

const VALID_BODY = {
  thesis_id: "t1",
  entry_zone_low: 140,
  entry_zone_high: 150,
  stop_loss: 130,
  target_1: 170,
  target_2: 190,
  position_size_pct: 5,
};

function post(body: unknown) {
  const req = new Request("http://test", { method: "POST", body: JSON.stringify(body) });
  return POST(req as never);
}

describe("POST /api/trade-plans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a body missing stop_loss", async () => {
    const res = await post({ thesis_id: "t1" });
    expect(res.status).toBe(400);
  });

  it("creates a jarvis_recommendation for a Tier I thesis, copying the plan's levels and the live price", async () => {
    const mock = buildMock({ convictionTier: "I" });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const res = await post(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.recommendation.id).toBe("rec1");
    expect(mock._recInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        thesis_id: "t1",
        trade_plan_id: "tp1",
        stock_id: "s1",
        ticker: "AAPL",
        conviction_tier: "I",
        price_at_recommendation: 150,
        recommended_entry_low: 140,
        recommended_entry_high: 150,
        recommended_stop: 130,
        recommended_target_1: 170,
        recommended_target_2: 190,
      }),
    );
  });

  it("records the submitted grid as the plan's ai_suggested baseline with no edited fields", async () => {
    const mock = buildMock({ convictionTier: "II" });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const res = await post(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mock._tradePlanInsert).toHaveBeenCalledWith(
      expect.objectContaining({ thesis_id: "t1", stop_loss: 130, edited_fields: [] }),
    );
    expect(body.tradePlan.ai_suggested).toEqual(
      expect.objectContaining({ stop_loss: 130, target_1: 170 }),
    );
    expect(body.tradePlan.ai_suggested.thesis_id).toBeUndefined();
  });

  it("skips jarvis_recommendation creation for a Tier III thesis", async () => {
    const mock = buildMock({ convictionTier: "III" });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const res = await post(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.recommendation).toBe(null);
    expect(mock._recInsert).not.toHaveBeenCalled();
  });

  it("rejects a macro thesis with no stock_id", async () => {
    const mock = buildMock({ convictionTier: "I", stockId: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const res = await post(VALID_BODY);

    expect(res.status).toBe(400);
    expect(mock._tradePlanInsert).not.toHaveBeenCalled();
  });

  it("refuses to create a second trade plan for a thesis that already has one", async () => {
    const mock = buildMock({ convictionTier: "I", existingPlan: { id: "tp-existing" } });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const res = await post(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.tradePlanId).toBe("tp-existing");
    expect(mock._tradePlanInsert).not.toHaveBeenCalled();
  });
});
