import { describe, expect, it } from "vitest";

import { buildHoldingRows, type HoldingDraft } from "@/lib/portfolio/create-holding";

const PF1 = "11111111-1111-4111-8111-111111111111";

const draft = (over: Partial<HoldingDraft> = {}): HoldingDraft => ({
  ticker: "INFY",
  stockId: "stock-1",
  quantity: 10,
  price: 1500,
  date: "2026-01-15",
  entryNote: "Imported from broker.csv.",
  assetClass: "equity",
  ...over,
});

describe("buildHoldingRows", () => {
  it("mints a thesis, a plan, a position and an entry per holding", () => {
    const rows = buildHoldingRows([draft()], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: "b1",
    });

    expect(rows.theses).toHaveLength(1);
    expect(rows.tradePlans).toHaveLength(1);
    expect(rows.positions).toHaveLength(1);
    expect(rows.entries).toHaveLength(1);
  });

  it("wires the four rows to each other by id", () => {
    // `positions.thesis_id` and `.trade_plan_id` are NOT NULL, which is the
    // whole reason the stubs exist.
    const { theses, tradePlans, positions, entries } = buildHoldingRows([draft()], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: "b1",
    });
    expect(positions[0].thesis_id).toBe(theses[0].id);
    expect(positions[0].trade_plan_id).toBe(tradePlans[0].id);
    expect(tradePlans[0].thesis_id).toBe(theses[0].id);
    expect(entries[0].position_id).toBe(positions[0].id);
  });

  it("files the position in the book it was told, never a default", () => {
    const { positions } = buildHoldingRows([draft()], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: null,
    });
    expect(positions[0].portfolio_id).toBe(PF1);
  });

  it("leaves every trade-plan level null", () => {
    // No analysis produced a plan. Inventing a stop for a position this app
    // never sized would be worse than admitting there isn't one.
    const { tradePlans } = buildHoldingRows([draft()], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: "b1",
    });
    expect(tradePlans[0].stop_loss ?? null).toBeNull();
    expect(tradePlans[0].target_1 ?? null).toBeNull();
    expect(tradePlans[0].entry_zone_low ?? null).toBeNull();
  });

  it("queues an equity for the weekly holding watch", () => {
    const { watchState, positions } = buildHoldingRows([draft()], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: "b1",
    });
    expect(watchState).toEqual([{ position_id: positions[0].id }]);
  });

  it("does NOT queue a coin for the holding watch", () => {
    // The watch's two triggers are earnings and fundamentals deltas. Neither
    // exists for a coin, so queueing one spends a model call to report "no
    // earnings date found" every week, forever. Not queueing IS the scoping:
    // what is never queued is never drained.
    const { watchState } = buildHoldingRows(
      [draft({ ticker: "BTC", assetClass: "crypto" })],
      { portfolioId: PF1, market: "CRYPTO", importBatchId: null },
    );
    expect(watchState).toEqual([]);
  });

  it("queues only the equities in a mixed batch", () => {
    const { watchState, positions } = buildHoldingRows(
      [draft(), draft({ ticker: "BTC", assetClass: "crypto" })],
      { portfolioId: PF1, market: "IN", importBatchId: "b1" },
    );
    expect(watchState).toEqual([{ position_id: positions[0].id }]);
  });

  it("uses the trader's own words as the thesis input when they gave any", () => {
    const { theses } = buildHoldingRows([draft({ note: "Bought on the dip." })], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: "b1",
    });
    expect(theses[0].input_text).toBe("Bought on the dip.");
  });

  it("still says something when they gave none", () => {
    // `theses.input_text` is NOT NULL, and a later per-holding review is only
    // as grounded as this string.
    const { theses } = buildHoldingRows([draft()], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: "b1",
    });
    expect(theses[0].input_text).toContain("INFY");
    expect(theses[0].input_text.length).toBeGreaterThan(0);
  });

  it("treats a whitespace-only note as no note", () => {
    const { theses } = buildHoldingRows([draft({ note: "   " })], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: "b1",
    });
    expect(theses[0].input_text).toContain("INFY");
  });

  it("carries a null batch id for a manual add", () => {
    const { theses } = buildHoldingRows([draft()], {
      portfolioId: PF1,
      market: "CRYPTO",
      importBatchId: null,
    });
    expect(theses[0].import_batch_id).toBeNull();
  });

  it("marks every holding as imported, however it arrived", () => {
    // `source: 'imported'` is what the positions table reads to say a holding
    // has no Jarvis trade plan behind it. True of a hand-added coin too.
    const { theses } = buildHoldingRows([draft({ assetClass: "crypto" })], {
      portfolioId: PF1,
      market: "CRYPTO",
      importBatchId: null,
    });
    expect(theses[0].source).toBe("imported");
  });

  it("gives every row a distinct id across a multi-row batch", () => {
    const { positions, theses } = buildHoldingRows([draft(), draft({ ticker: "TCS" })], {
      portfolioId: PF1,
      market: "IN",
      importBatchId: "b1",
    });
    expect(positions[0].id).not.toBe(positions[1].id);
    expect(theses[0].id).not.toBe(theses[1].id);
  });
});
