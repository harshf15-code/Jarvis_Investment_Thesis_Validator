import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { importRationalePlaceholder } from "@/lib/holding-watch";
import { isLiveMarket } from "@/lib/markets";
import { MAX_IMPORT_ROWS } from "@/lib/portfolio-import";
import { resolveImportRows } from "@/lib/portfolio/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePortfolioScope } from "@/lib/portfolio/active";
import { createClient } from "@/lib/supabase/server";
import type {
  EntryInsert,
  HoldingWatchStateInsert,
  MarketCode,
  PortfolioImportError,
  PositionInsert,
  ThesisInsert,
  TradePlanInsert,
} from "@/lib/types";

/**
 * Commits a reviewed CSV batch into the ordinary theses -> trade_plans ->
 * positions -> entries chain.
 *
 * The shape of this route is the whole design of the feature. An imported
 * holding is NOT a second kind of position: it is a real position hanging off
 * a minimal synthetic thesis and an all-null trade plan, so the Cockpit, the
 * positions table, `position-metrics.ts`, the Journal and the alert poller all
 * work on it with no changes at all.
 *
 * Rows are re-resolved here rather than trusted from the preview. The client's
 * resolve result is a courtesy; letting a browser choose which `stock_id` a
 * position points at would make the whole resolution step advisory.
 */
export const maxDuration = 120;

const CommitRowSchema = z.object({
  ticker: z.string().trim().min(1).max(40),
  quantity: z.number().positive(),
  averagePrice: z.number().positive(),
  // `z.iso.date()` rather than a shape regex: `2026-02-31` matches the shape
  // and then 500s on the insert, when it should be a 400 the trader can read.
  date: z.iso.date().nullable().optional(),
  /** The trader's own "why I bought this", if they gave one. */
  note: z.string().trim().max(2000).optional(),
  /** Set when the trader saw the duplicate warning and chose to import anyway. */
  confirmedDuplicate: z.boolean().optional(),
});

const CommitInputSchema = z.object({
  /**
   * Which book these holdings land in. Required, no default.
   *
   * An import is the largest single write this app makes — up to 200 positions
   * in one commit — so it is also the largest single thing to get wrong. The
   * wizard asks before the file is even mapped.
   */
  portfolio_id: z.uuid("Choose which portfolio these holdings belong to."),
  source_filename: z.string().trim().min(1).max(255),
  market: z.string(),
  as_of_date: z.iso.date("as_of_date must be a real YYYY-MM-DD date"),
  objective: z.string().trim().max(2000).optional(),
  rows: z.array(CommitRowSchema).min(1).max(MAX_IMPORT_ROWS),
  /** Rows the trader saw flagged and chose not to import. Recorded, not acted on. */
  skipped: z
    .array(z.object({ ticker: z.string(), reason: z.string(), row: z.number().int().min(1) }))
    .max(MAX_IMPORT_ROWS)
    .optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CommitInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (!isLiveMarket(input.market)) {
    return NextResponse.json({ error: `Market "${input.market}" is not available yet.` }, { status: 400 });
  }
  const market = input.market as MarketCode;

  // A cost basis dated in the future would make every return calculation on the
  // Cockpit nonsense. One day of slack, because the browser sends the trader's
  // LOCAL calendar date and this server answers in UTC — in Auckland those are
  // routinely different days, and that is not the mistake this guard is for.
  const tomorrowUtc = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (input.as_of_date > tomorrowUtc) {
    return NextResponse.json({ error: "The 'as of' date cannot be in the future." }, { status: 400 });
  }

  const supabase = await createClient();

  // Checked before anything is priced. 0027's foreign key would refuse a book
  // that is not this trader's regardless — the key is on (portfolio_id,
  // user_id) — but it would refuse it after up to 200 rows had been resolved
  // over the network, and as a constraint violation rather than a sentence.
  const { data: book, error: bookError } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", input.portfolio_id)
    .maybeSingle();
  if (bookError) {
    return NextResponse.json({ error: bookError.message }, { status: 500 });
  }
  if (!book) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  let resolved;
  try {
    resolved = await resolveImportRows(
      supabase,
      input.rows.map((row, index) => ({
        index,
        ticker: row.ticker.toUpperCase(),
        quantity: row.quantity,
        averagePrice: row.averagePrice,
        date: row.date ?? null,
      })),
      market,
      input.portfolio_id,
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // `skipped` from the client is what the trader chose to leave out. Anything
  // added here is what the server refused, and both end up in the same audit
  // record — a row that vanished between preview and commit must be visible.
  const errors: PortfolioImportError[] = (input.skipped ?? []).map((s) => ({
    row: s.row,
    ticker: s.ticker,
    reason: s.reason,
  }));

  const accepted = resolved.filter((row, index) => {
    const submitted = input.rows[index];
    const importable =
      row.status === "resolved" ||
      (row.status === "duplicate" && submitted.confirmedDuplicate === true);
    if (!importable) {
      errors.push({
        // +2: the trader's file has a header on line 1.
        row: index + 2,
        ticker: row.ticker,
        reason: row.reason ?? "Could not be imported",
      });
    }
    return importable;
  });

  if (accepted.length === 0) {
    return NextResponse.json(
      { error: "None of these rows could be imported.", errors },
      { status: 400 },
    );
  }

  // --- stocks -------------------------------------------------------------
  // A shared market-data cache that `authenticated` may read but not write
  // (0014), so maintaining it is service-role work. Upsert on the unique
  // `yahoo_symbol` index rather than select-then-insert, which would race with
  // a concurrent thesis run on the same name.
  const admin = createAdminClient();
  // One payload row per symbol. A trader who confirms a ticker that appears
  // twice in their file legitimately imports two positions in it — but sending
  // the same conflict key twice makes Postgres refuse the whole statement
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time"), which
  // would fail the import before the audit row even exists.
  const stockPayload = [
    ...new Map(
      accepted.map((row) => [
        row.yahooSymbol!,
        {
          ticker: row.ticker,
          yahoo_symbol: row.yahooSymbol!,
          exchange: row.exchange!,
          currency: row.currency!,
          last_price: row.lastPrice,
          last_price_at: new Date().toISOString(),
        },
      ]),
    ).values(),
  ];
  const { data: stocks, error: stockError } = await admin
    .from("stocks")
    .upsert(stockPayload, { onConflict: "yahoo_symbol" })
    .select("id, yahoo_symbol");

  if (stockError || !stocks) {
    return NextResponse.json(
      { error: stockError?.message ?? "Failed to record the stocks being imported" },
      { status: 500 },
    );
  }
  const stockIdBySymbol = new Map(stocks.map((s) => [s.yahoo_symbol, s.id]));

  // --- the audit row, written FIRST ---------------------------------------
  // `status` defaults to 'failed', so a run that dies below leaves an honest
  // record rather than none at all.
  const { data: batch, error: batchError } = await supabase
    .from("portfolio_imports")
    .insert({
      portfolio_id: input.portfolio_id,
      source_filename: input.source_filename,
      market,
      as_of_date: input.as_of_date,
      total_rows: input.rows.length + (input.skipped?.length ?? 0),
    })
    .select("*")
    .single();

  if (batchError || !batch) {
    return NextResponse.json(
      { error: batchError?.message ?? "Failed to open an import batch" },
      { status: 500 },
    );
  }

  // --- the four inserts ---------------------------------------------------
  // Ids are generated up front so nothing depends on PostgREST returning
  // inserted rows in the order they were sent. Four round trips for the whole
  // batch, not four per row.
  const theses: ThesisInsert[] = [];
  const tradePlans: TradePlanInsert[] = [];
  const positions: PositionInsert[] = [];
  const entries: EntryInsert[] = [];
  const watchState: HoldingWatchStateInsert[] = [];

  for (const row of accepted) {
    const note = input.rows[row.index]?.note?.trim();
    const thesisId = crypto.randomUUID();
    const tradePlanId = crypto.randomUUID();
    const positionId = crypto.randomUUID();
    const stockId = stockIdBySymbol.get(row.yahooSymbol!)!;

    theses.push({
      id: thesisId,
      // NOT NULL, so it always says something. The trader's own words when
      // they gave them: a later per-holding review is only as grounded as this.
      input_text:
        note && note.length > 0 ? note : importRationalePlaceholder(row.ticker),
      mode: "stock_only",
      status: "active",
      markets: [market],
      // Setting `ticker` is exactly what this field is for: it may only ever be
      // set when the TRADER named the stock, and owning it is the strongest
      // form of naming it.
      ticker: row.ticker,
      stock_id: stockId,
      source: "imported",
      import_batch_id: batch.id,
    });
    // Every level null: no analysis produced a trade plan, and inventing an
    // entry zone or a stop for a position this app never sized would be worse
    // than admitting there isn't one. The row exists because
    // `positions.trade_plan_id` is NOT NULL and the position detail page reads
    // it with `.single()`.
    tradePlans.push({ id: tradePlanId, thesis_id: thesisId });
    positions.push({
      id: positionId,
      portfolio_id: input.portfolio_id,
      thesis_id: thesisId,
      trade_plan_id: tradePlanId,
      stock_id: stockId,
      ticker: row.ticker,
      status: "active",
    });
    entries.push({
      id: crypto.randomUUID(),
      position_id: positionId,
      date: row.date ?? input.as_of_date,
      quantity: row.quantity!,
      price: row.averagePrice!,
      tranche: "T1",
      notes: `Imported from ${input.source_filename}. Cost basis is a broker average; the date is approximate.`,
    });
    // Queues the initial read rather than running it here (0022). A null
    // `last_checked_at` is what the watch route drains first. Doing it inline
    // would be one model call per holding inside a route with a 120s budget
    // and a 200-row cap — a large import would blow the timeout, the spend cap
    // and the trader's patience in one action, and would fail the import for a
    // reason that has nothing to do with importing.
    watchState.push({ position_id: positionId });
  }

  const thesisIds = theses.map((t) => t.id!);

  const failed = async (message: string) => {
    // `trade_plans`, `positions` and `entries` all cascade from `theses`, so
    // deleting the theses unwinds a half-written batch completely. The audit
    // row stays, at its default 'failed', carrying the reason.
    await supabase.from("theses").delete().in("id", thesisIds);
    await supabase
      .from("portfolio_imports")
      // row 0 is not a line in the trader's file — it is the batch itself.
      .update({ errors: [...errors, { row: 0, ticker: "", reason: `Import failed: ${message}` }] })
      .eq("id", batch.id);
    return NextResponse.json({ error: message }, { status: 500 });
  };

  const thesisWrite = await supabase.from("theses").insert(theses);
  if (thesisWrite.error) return failed(thesisWrite.error.message);

  const planWrite = await supabase.from("trade_plans").insert(tradePlans);
  if (planWrite.error) return failed(planWrite.error.message);

  const positionWrite = await supabase.from("positions").insert(positions);
  if (positionWrite.error) return failed(positionWrite.error.message);

  const entryWrite = await supabase.from("entries").insert(entries);
  if (entryWrite.error) return failed(entryWrite.error.message);

  const watchWrite = await supabase.from("holding_watch_state").insert(watchState);
  if (watchWrite.error) {
    // Deliberately NOT `failed()`. The holdings are imported and correct; all
    // that is lost is the queued first read, which the trader can trigger by
    // hand from the position page. Unwinding a good import over a missing
    // queue entry would be the worse trade.
    console.error("[portfolio-import] holdings imported but the watch was not queued", watchWrite.error);
  }

  const { data: finished, error: finishError } = await supabase
    .from("portfolio_imports")
    .update({
      imported_rows: accepted.length,
      skipped_rows: errors.length,
      status: errors.length > 0 ? "partial" : "completed",
      errors,
    })
    .eq("id", batch.id)
    .select("*")
    .single();

  if (finishError) {
    // The holdings are in. Failing the request now would tell the trader their
    // import failed when it did not — the audit row is the lesser loss.
    console.error("[portfolio-import] batch written but not marked complete", finishError);
  }

  if (input.objective !== undefined && input.objective.length > 0) {
    const { error: profileError } = await supabase
      .from("portfolio_profiles")
      // Keyed on the book since 0027, so importing a second portfolio records
      // ITS objective rather than overwriting the first one's.
      .upsert(
        {
          portfolio_id: input.portfolio_id,
          objective: input.objective,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "portfolio_id" },
      );
    if (profileError) {
      console.error("[portfolio-import] failed to save the portfolio objective", profileError);
    }
  }

  return NextResponse.json(
    { batch: finished ?? batch, imported: accepted.length, skipped: errors },
    { status: 201 },
  );
}

/** Past batches, newest first — the audit trail behind "what did I import?". */
export async function GET(request: Request) {
  const scope = requirePortfolioScope(request);
  if (scope instanceof Response) return scope;

  const supabase = await createClient();
  let query = supabase.from("portfolio_imports").select("*");
  if (scope.mode === "one") query = query.eq("portfolio_id", scope.id);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ imports: data ?? [] });
}
