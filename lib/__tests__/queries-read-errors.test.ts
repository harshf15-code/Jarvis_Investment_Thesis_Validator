import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { buildSupabaseMock, fakePortfolio, type TableRows } from "@/lib/testing/supabase-mock";
import { readCockpit } from "@/lib/cockpit";
import { readOpportunities, readPositionDetail, readSignalFeed } from "@/lib/queries";
import type { Database } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * These readers each fan out into several queries whose results are folded
 * together with `?? []` and `?? null`. That fallback is right for a row that is
 * genuinely absent and WRONG for a query that failed, because the two produce
 * the same shape: an empty `entries` list is indistinguishable from a position
 * bought for nothing, and a missing `stocks` row from a stock with no price.
 *
 * So every supplementary read here has to fail loudly. The one exception is
 * PostgREST's `PGRST116` — `.single()` matching no row — which is an answer the
 * screens already render, and the last two tests pin that it stays one.
 */
const PF1 = "11111111-1111-4111-8111-111111111111";
const OWNED = fakePortfolio({ id: PF1, name: "My Portfolio" });

type Errors = Record<string, { message: string; code?: string }>;

function client(rows: TableRows, errors?: Errors) {
  return buildSupabaseMock(rows, { errors }) as unknown as SupabaseClient<Database>;
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

describe("readCockpit", () => {
  it("throws when a supporting read in the batch fails", async () => {
    // Without this, `entries` is `[]`, the weighted-average entry is 0, and the
    // Cockpit reports the whole book at infinite profit.
    await expect(
      readCockpit(client({ portfolios: [OWNED], positions: [POSITION] }, { entries: { message: "entries exploded" } }), {
        mode: "one",
        id: PF1,
      }),
    ).rejects.toThrow("entries exploded");
  });

  it("throws when the price read fails rather than showing a flat account", async () => {
    await expect(
      readCockpit(client({ portfolios: [OWNED], positions: [POSITION] }, { stocks: { message: "stocks exploded" } }), {
        mode: "one",
        id: PF1,
      }),
    ).rejects.toThrow("stocks exploded");
  });
});

describe("readSignalFeed", () => {
  it("throws rather than showing an empty agenda when the positions read fails", async () => {
    // An empty agenda sidebar means "nothing due in the next 14 days", which is
    // a statement the trader acts on.
    await expect(
      readSignalFeed(client({ intelligence_signals: [] }, { positions: { message: "positions exploded" } })),
    ).rejects.toThrow("positions exploded");
  });

  it("throws when the trade-plan read behind the agenda fails", async () => {
    await expect(
      readSignalFeed(
        client(
          { intelligence_signals: [], positions: [{ id: "p1", ticker: "AAPL", trade_plan_id: "tp1" }] },
          { trade_plans: { message: "plans exploded" } },
        ),
      ),
    ).rejects.toThrow("plans exploded");
  });
});

describe("readOpportunities", () => {
  const ROW = { id: "o1", ticker: "AAPL", market: "US", conviction_tier: "A" };

  it("throws rather than reporting an owned ticker as not held", async () => {
    // `held` is the badge that stops the trader buying a second lot of
    // something they already own. A failed read must not render it as `false`.
    await expect(
      readOpportunities(client({ opportunities: [ROW], stocks: [] }, { positions: { message: "positions exploded" } })),
    ).rejects.toThrow("positions exploded");
  });
});

describe("readPositionDetail", () => {
  it("reports no such position as null, not as a failure", async () => {
    const result = await readPositionDetail(
      client({}, { positions: { message: "no rows", code: "PGRST116" } }),
      "p1",
    );
    expect(result).toBeNull();
  });

  it("throws when the position lookup itself fails", async () => {
    // Returning null here would reach the page as `notFound()` — telling the
    // trader their holding no longer exists because a read timed out.
    await expect(
      readPositionDetail(client({}, { positions: { message: "connection reset" } }), "p1"),
    ).rejects.toThrow("connection reset");
  });

  it("throws when a supplementary read fails", async () => {
    await expect(
      readPositionDetail(
        client({ positions: [POSITION] }, { exits: { message: "exits exploded" } }),
        "p1",
      ),
    ).rejects.toThrow("exits exploded");
  });

  it("still renders a position whose trade plan simply has no row", async () => {
    // Imported holdings reach this screen without an analysed plan, and the
    // screen has a branch that says so. PGRST116 must stay survivable.
    const result = await readPositionDetail(
      client({ positions: [POSITION] }, { trade_plans: { message: "no rows", code: "PGRST116" } }),
      "p1",
    );
    expect(result?.tradePlan).toBeNull();
    expect(result?.position.ticker).toBe("AAPL");
  });
});
