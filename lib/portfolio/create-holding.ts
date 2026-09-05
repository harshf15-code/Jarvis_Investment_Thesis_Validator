import { importRationalePlaceholder } from "@/lib/holding-watch";
import type {
  AssetClass,
  EntryInsert,
  HoldingWatchStateInsert,
  MarketCode,
  PositionInsert,
  ThesisInsert,
  TradePlanInsert,
} from "@/lib/types";

/**
 * The rows that make a holding out of nothing.
 *
 * `positions.thesis_id` and `positions.trade_plan_id` are both NOT NULL, so a
 * holding the app did not analyse still needs a thesis and a plan behind it.
 * Until crypto there was exactly one caller — the CSV import — and this lived
 * inline in its route. There are two now, and a five-insert sequence copied
 * twice drifts the first time either copy is touched.
 *
 * PURE. It returns rows and writes nothing: the import needs a rollback that
 * deletes theses (everything else cascades) and a batch audit row, the manual
 * add needs neither, and pushing that difference in here would mean a function
 * with two modes. Each caller owns its own failure handling.
 */

export type HoldingDraft = {
  ticker: string;
  stockId: string;
  quantity: number;
  price: number;
  date: string;
  /** The trader's own words, if they gave any. */
  note?: string;
  /** Provenance for the entry row — which file, or that it was added by hand. */
  entryNote: string;
  /** Decides whether the weekly holding watch is queued. */
  assetClass: AssetClass;
};

export type HoldingRows = {
  theses: ThesisInsert[];
  tradePlans: TradePlanInsert[];
  positions: PositionInsert[];
  entries: EntryInsert[];
  watchState: HoldingWatchStateInsert[];
};

export function buildHoldingRows(
  drafts: HoldingDraft[],
  ctx: { portfolioId: string; market: MarketCode; importBatchId: string | null },
): HoldingRows {
  const rows: HoldingRows = {
    theses: [],
    tradePlans: [],
    positions: [],
    entries: [],
    watchState: [],
  };

  for (const draft of drafts) {
    // Ids are generated up front so nothing depends on PostgREST returning
    // inserted rows in the order they were sent.
    const thesisId = crypto.randomUUID();
    const tradePlanId = crypto.randomUUID();
    const positionId = crypto.randomUUID();
    const note = draft.note?.trim();

    rows.theses.push({
      id: thesisId,
      // NOT NULL, so it always says something. The trader's own words when
      // they gave them: a later per-holding review is only as grounded as this.
      input_text: note && note.length > 0 ? note : importRationalePlaceholder(draft.ticker),
      mode: "stock_only",
      status: "active",
      markets: [ctx.market],
      // Setting `ticker` is exactly what this field is for: it may only ever be
      // set when the TRADER named the stock, and owning it is the strongest
      // form of naming it.
      ticker: draft.ticker,
      stock_id: draft.stockId,
      source: "imported",
      import_batch_id: ctx.importBatchId,
    });

    // Every level null: no analysis produced a trade plan, and inventing an
    // entry zone or a stop for a position this app never sized would be worse
    // than admitting there isn't one. The row exists because
    // `positions.trade_plan_id` is NOT NULL and the position detail page reads
    // it with `.single()`.
    rows.tradePlans.push({ id: tradePlanId, thesis_id: thesisId });

    rows.positions.push({
      id: positionId,
      portfolio_id: ctx.portfolioId,
      thesis_id: thesisId,
      trade_plan_id: tradePlanId,
      stock_id: draft.stockId,
      ticker: draft.ticker,
      status: "active",
    });

    rows.entries.push({
      id: crypto.randomUUID(),
      position_id: positionId,
      date: draft.date,
      quantity: draft.quantity,
      price: draft.price,
      tranche: "T1",
      notes: draft.entryNote,
    });

    // Queues the initial read rather than running it here (0022) -- but ONLY
    // for an equity. The watch's two triggers are `earnings_calendar` and
    // `fundamentals_delta`, and a coin has neither, so queueing one would spend
    // a model call every week to report "no earnings date found" forever.
    // Skipping the insert IS the scoping: what is never queued is never
    // drained, so there is no second filter to keep in step with this one.
    if (draft.assetClass === "equity") {
      rows.watchState.push({ position_id: positionId });
    }
  }

  return rows;
}
