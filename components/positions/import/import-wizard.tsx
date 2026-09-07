"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Upload } from "lucide-react";

import { ColumnMapper } from "@/components/positions/import/column-mapper";
import { PreviewTable } from "@/components/positions/import/preview-table";
import { TypedRowsEditor } from "@/components/positions/import/typed-rows";
import { PortfolioPicker } from "@/components/portfolio/portfolio-picker";
import { parseCsv } from "@/lib/csv";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import {
  buildDraftRows,
  buildTypedRows,
  detectColumns,
  EMPTY_TYPED_ROW,
  localToday,
  MAX_IMPORT_ROWS,
  repeatedTickerIndices,
  RESOLVE_CHUNK,
  type ColumnMapping,
  type DraftImportRow,
  type ResolvedImportRow,
  type TypedHoldingEntry,
} from "@/lib/portfolio-import";
import { cn } from "@/lib/utils";
import type { MarketCode } from "@/lib/types";

type Step = "upload" | "preview";

/** Where the rows come from. Nothing downstream of `resolveRows` knows which. */
type Source = "csv" | "typed";

/**
 * Adding holdings you already own: choose a book, name the market, give it the
 * rows, review what resolved, commit.
 *
 * The rows arrive one of two ways and the difference ends immediately. A CSV is
 * read and parsed HERE, in the browser, and never uploaded — a broker export
 * carries account numbers, ISINs and P&L the app has no business seeing, so
 * only the three mapped columns are ever sent. Typed rows are the same three
 * fields without the file. Both become `DraftImportRow[]`, and from there one
 * path prices them, flags a name already held, and writes them.
 *
 * A second source, not a second importer: the resolution step is the whole
 * value of this screen, and a typed ticker needs it more than a broker's does.
 */
export function ImportWizard({
  /** The books that have already said what they are for. Every book, not just
   *  the one in the URL — step 1 below can send these rows somewhere else. */
  booksWithObjective,
  /** Which source the screen opens on. `/positions` links here with `typed`
   *  for the "a few stocks, no spreadsheet" case. */
  defaultSource = "csv",
}: {
  booksWithObjective: string[];
  defaultSource?: Source;
}) {
  const router = useRouter();
  // Which book the file lands in. Asked as its own step rather than inherited
  // from the header switcher: up to 200 positions commit at once here, which
  // makes this the largest single thing in the app to get wrong.
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("upload");

  const [source, setSource] = useState<Source>(defaultSource);
  const [typedRows, setTypedRows] = useState<TypedHoldingEntry[]>([
    // Three, because one looks like a form for a single holding and this exists
    // for the trader who has a handful.
    { ...EMPTY_TYPED_ROW },
    { ...EMPTY_TYPED_ROW },
    { ...EMPTY_TYPED_ROW },
  ]);

  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    ticker: null,
    quantity: null,
    averagePrice: null,
    date: null,
  });
  // No default, deliberately. It used to open on India — reasonable, since
  // this is a Kite export more often than not, but the chips sat below the
  // file picker and a trader could map columns and price a whole book without
  // ever seeing them. The copy underneath says Jarvis will not guess the
  // market, and a pre-selection is exactly that guess. Probing the wrong one
  // resolves INFY to a NYSE ADR priced in dollars.
  const [market, setMarket] = useState<MarketCode | null>(null);
  // The trader's own calendar, not UTC — see `localToday`.
  const [asOfDate, setAsOfDate] = useState(localToday());
  const [objective, setObjective] = useState("");
  // Answered against the book this file is actually going into, resolved after
  // step 1 rather than on the server before it. Null until one is chosen, which
  // is also before this field can be reached.
  const hasObjective = portfolioId !== null && booksWithObjective.includes(portfolioId);
  // Read by the in-flight resolve loop, which closed over the book it started
  // with and cannot see later state any other way.
  const portfolioIdRef = useRef(portfolioId);
  useEffect(() => {
    portfolioIdRef.current = portfolioId;
  }, [portfolioId]);

  const [resolved, setResolved] = useState<ResolvedImportRow[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mappingReady =
    mapping.ticker !== null && mapping.quantity !== null && mapping.averagePrice !== null;
  // A typed batch has no mapping to get right, so what stands in for it is
  // simply having written something. Everything else about the row is judged in
  // the preview, where it can be shown beside what the ticker resolved to.
  const typedReady = typedRows.some((row) => row.ticker.trim() !== "");
  const rowsReady = source === "csv" ? mappingReady && headers.length > 0 : typedReady;

  /**
   * Everything derived from the previous file, mapping or market.
   *
   * `confirmed` and `notes` are keyed by ROW INDEX, so carrying them across a
   * new file would silently apply a duplicate confirmation given for one
   * holding to whatever now sits at that line — which is the one decision in
   * this flow that must always be made deliberately.
   */
  function clearPreview() {
    setResolved([]);
    setConfirmed(new Set());
    setNotes({});
    setStep("upload");
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) {
        setError("That file has no rows in it.");
        return;
      }
      clearPreview();
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setMapping(detectColumns(parsed.headers));
    } catch {
      setError("Couldn't read that file. It needs to be a plain CSV.");
    }
  }

  async function resolveRows() {
    // The button is disabled without a market or a book; this is the guard that
    // makes both non-null for the request body rather than a `!` assertion.
    if (market === null || portfolioId === null) return;
    // The one line that knows where the rows came from. Everything below —
    // chunking, the repeat scan, the stale-book guard — is written against
    // `DraftImportRow[]` and cannot tell.
    const drafts =
      source === "csv" ? buildDraftRows(rawRows, mapping) : buildTypedRows(typedRows);
    if (drafts.length === 0) {
      setError(
        source === "csv"
          ? "No rows in that file have a ticker in the column you mapped."
          : "Nothing to price yet — fill in at least one row.",
      );
      return;
    }
    if (drafts.length > MAX_IMPORT_ROWS) {
      setError(`That is ${drafts.length} holdings; ${MAX_IMPORT_ROWS} is the most one import can take.`);
      return;
    }

    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: drafts.length });
    // The book this run is FOR. Duplicate detection is per-book, so a preview
    // is only true of the book it was resolved against; if that changes under
    // us the result is discarded rather than shown against the new one.
    const resolvingFor = portfolioId;
    const out: ResolvedImportRow[] = [];
    try {
      // Chunked because each row costs up to one Yahoo quote per exchange in
      // the chosen market. One request for 200 rows would time out; eight
      // bounded ones with a progress line will not.
      // Computed over the WHOLE file, because a ticker repeated at rows 3 and
      // 40 falls in two different chunks and neither request could see the
      // other. Without this the preview shows both as clean and the second is
      // then skipped at commit, never having been offered the checkbox.
      const repeatedIndices = [...repeatedTickerIndices(drafts.map((d) => d.ticker))].map(
        (position) => drafts[position].index,
      );

      for (let i = 0; i < drafts.length; i += RESOLVE_CHUNK) {
        const chunk: DraftImportRow[] = drafts.slice(i, i + RESOLVE_CHUNK);
        const res = await fetch("/api/portfolio/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolio_id: resolvingFor,
            market,
            rows: chunk,
            repeatedIndices,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Couldn't price these holdings.");
        out.push(...(body.rows as ResolvedImportRow[]));
        setProgress({ done: Math.min(i + RESOLVE_CHUNK, drafts.length), total: drafts.length });
      }
      // `clearPreview()` already ran on the change; returning here stops this
      // run from putting the old book's rows back.
      if (resolvingFor !== portfolioIdRef.current) return;
      setResolved(out);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // A CSV has a header on line 1, so its first holding is line 2; a typed table
  // has no header. The server derives the same offset from whether a filename
  // was sent, so the two agree without either being told by the other.
  const lineOffset = source === "csv" ? 2 : 1;

  const importable = resolved.filter(
    (r) => r.status === "resolved" || (r.status === "duplicate" && confirmed.has(r.index)),
  );
  const skipped = resolved.filter((r) => !importable.includes(r));

  async function commit() {
    if (market === null || portfolioId === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          // Omitted entirely for a typed batch. The server reads its absence as
          // "nobody uploaded anything" and stamps the entry note accordingly —
          // "Imported from holdings.csv" would be a claim about a file that
          // does not exist.
          ...(source === "csv" ? { source_filename: fileName } : {}),
          market,
          as_of_date: asOfDate,
          objective: objective.trim() || undefined,
          rows: importable.map((r) => ({
            ticker: r.ticker,
            quantity: r.quantity,
            averagePrice: r.averagePrice,
            date: r.date,
            note: notes[r.index]?.trim() || undefined,
            confirmedDuplicate: confirmed.has(r.index),
            // Where the trader saw this row. Only survivors of the preview are
            // sent, so its position in THIS array says nothing about the line
            // they would look at if the server refuses it after all.
            index: r.index,
          })),
          skipped: skipped.map((r) => ({
            row: r.index + lineOffset,
            ticker: r.ticker,
            reason: r.reason ?? "Skipped",
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't save these holdings.");
      // Into the book these rows went into, not the default. Landing on your own
      // holdings after adding to someone else's book reads as a failed import —
      // the rows are there, just not on the screen you were sent to.
      router.push(`/positions?portfolio=${portfolioId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</div>
      )}

      {step === "upload" ? (
        <>
          <section className="glass-panel flex flex-col gap-4 rounded-xl p-5">
            <div>
              <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
                1 · Which portfolio is this?
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                One batch commits up to {MAX_IMPORT_ROWS} positions at once, so this is asked here
                rather than taken from whichever book you were last looking at.
              </p>
            </div>

            <PortfolioPicker
              value={portfolioId}
              // Locked while a resolve is running. The chunk loop below prices
              // against the book it started with, so changing books mid-flight
              // would land a preview describing one book on a form that commits
              // into another — duplicate flags and all. The loop also refuses a
              // stale result, but that is the backstop; not offering the change
              // is the honest control.
              disabled={busy}
              onChange={(id) => {
                setPortfolioId(id);
                // Duplicate detection is per-book since 0027 — "you already
                // hold INFY" is a claim about ONE book — so a preview resolved
                // against the previous choice is answering the wrong question.
                // Same reason the market buttons clear it.
                clearPreview();
              }}
              label=""
            />
          </section>

          <section className="glass-panel flex flex-col gap-4 rounded-xl p-5">
            <div>
              <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
                2 · Which market are these in?
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                One market per batch. The same symbol is listed in two of them at very different
                prices in different currencies, so this is asked, never guessed. Crypto prices in
                whatever currency the portfolio you picked is kept in.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {MARKET_ORDER.map((code) => {
                const meta = MARKETS[code];
                return (
                  <button
                    key={code}
                    type="button"
                    disabled={!meta.live || busy}
                    aria-pressed={market === code}
                    onClick={() => {
                      setMarket(code);
                      clearPreview();
                    }}
                    title={meta.live ? undefined : "Coming soon"}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition-colors",
                      !meta.live
                        ? "cursor-not-allowed border-white/5 text-on-surface-variant/40"
                        : market === code
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-white/10 text-on-surface-variant hover:border-white/25 hover:text-on-surface",
                    )}
                  >
                    {meta.label}
                    {!meta.live && <span className="ml-1.5 text-[9px] opacity-70">soon</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className={cn(
              "glass-panel flex flex-col gap-4 rounded-xl p-5 transition-opacity",
              market === null && "opacity-50",
            )}
          >
            <div>
              <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
                3 · The holdings
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                A broker&apos;s export, or type them in. A file is read in your browser — only the
                three columns you map are ever sent anywhere.
              </p>
            </div>

            {/* Both sources produce the same rows, so switching is free — but
                the preview was resolved against the OTHER set and would be
                answering about holdings that are no longer on screen. Cleared
                for the same reason changing the book or the market clears it. */}
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["csv", "Upload a CSV"],
                  ["typed", "Type them in"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  aria-pressed={source === value}
                  onClick={() => {
                    setSource(value);
                    clearPreview();
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-40",
                    source === value
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-white/10 text-on-surface-variant hover:border-white/25 hover:text-on-surface",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {source === "csv" ? (
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className={cn(
                    "flex items-center gap-3 self-start rounded-full border border-white/10 px-4 py-2 text-xs transition-colors",
                    market === null
                      ? "cursor-not-allowed text-on-surface-variant/40"
                      : "cursor-pointer text-on-surface-variant hover:border-white/25 hover:text-on-surface",
                  )}
                >
                  <Upload className="size-3.5" />
                  {fileName || "Choose a CSV"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    disabled={busy || market === null || portfolioId === null}
                    onChange={(e) => void handleFile(e.target.files?.[0])}
                  />
                </label>
                {portfolioId === null ? (
                  <span className="text-[11px] text-on-surface-variant/70">
                    Pick a portfolio first — it decides whose holdings these become.
                  </span>
                ) : (
                  market === null && (
                    <span className="text-[11px] text-on-surface-variant/70">
                      Pick a market first — it decides which exchanges each ticker is looked up on.
                    </span>
                  )
                )}
              </div>
            ) : (
              <TypedRowsEditor
                rows={typedRows}
                onChange={(rows) => {
                  setTypedRows(rows);
                  // Same reason as everything else here: the preview describes
                  // the rows it was resolved from, not whatever replaced them.
                  clearPreview();
                }}
                disabled={busy || market === null || portfolioId === null}
              />
            )}
          </section>

          {source === "csv" && market !== null && headers.length > 0 && (
            <section className="glass-panel flex flex-col gap-4 rounded-xl p-5">
              <div>
                <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
                  4 · The columns
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {rawRows.length} row{rawRows.length === 1 ? "" : "s"} found. Change anything Jarvis
                  guessed wrong.
                </p>
              </div>

              <ColumnMapper
                headers={headers}
                mapping={mapping}
                onChange={(next) => {
                  setMapping(next);
                  clearPreview();
                }}
              />

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-on-surface/40">
                      {headers.map((h, i) => (
                        <th key={`${h}-${i}`} className="p-2 font-mono font-normal">
                          {h || `Column ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rawRows.slice(0, 3).map((row, i) => (
                      <tr key={i} className="text-on-surface-variant">
                        {headers.map((_, c) => (
                          <td key={c} className="p-2">
                            {row[c] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Outside both sections rather than inside the CSV one, where it
              used to live: a typed batch never renders a column mapper, and a
              button that only exists once a file has been read is no button at
              all for the trader who did not bring one. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={resolveRows}
              disabled={!rowsReady || market === null || portfolioId === null || busy}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-colors hover:bg-primary-dim disabled:opacity-40"
            >
              {busy ? "Pricing…" : "Price these holdings"}
            </button>
            {progress && (
              <span className="text-xs text-on-surface-variant">
                {progress.done} of {progress.total}
              </span>
            )}
            {!busy && (portfolioId === null || market === null) ? (
              <span className="text-xs text-on-surface-variant/70">
                {portfolioId === null
                  ? "Pick a portfolio first — it decides whose holdings these become."
                  : "Pick a market first — it decides which exchanges each ticker is looked up on."}
              </span>
            ) : (
              !rowsReady &&
              !busy && (
                <span className="text-xs text-on-surface-variant/70">
                  {source === "csv"
                    ? headers.length === 0
                      ? "Choose a CSV to map its columns."
                      : "Ticker, quantity and average cost are all needed."
                    : "Give at least one row a ticker."}
                </span>
              )
            )}
          </div>
        </>
      ) : (
        <>
          <section className="glass-panel flex flex-col gap-4 rounded-xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
                  5 · Check before anything is saved
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Nothing has been written yet. {importable.length} to import
                  {skipped.length > 0 ? `, ${skipped.length} skipped` : ""}.
                </p>
                {/* The one field worth slowing down for. The rows carry the
                    ticker, the quantity and the cost; the reason is the only
                    thing Jarvis cannot recover later, and every future read is
                    measured against it. You can still add it afterwards on the
                    holding's own page, but never as well as you can now. */}
                <p className="mt-2 text-xs text-on-surface-variant">
                  Worth filling in the last column while you remember. Jarvis checks each
                  holding against your reason for owning it — with none recorded, it can
                  tell you what changed but never whether it matters.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep("upload")}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface"
              >
                <ArrowLeft className="size-3.5" />
                {source === "csv" ? "Back to the columns" : "Back to the rows"}
              </button>
            </div>

            <div className="flex flex-wrap gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
                  Held since
                </span>
                <input
                  type="date"
                  value={asOfDate}
                  max={localToday()}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="sunken rounded-lg px-3 py-2 text-sm text-on-surface focus:ring-1 focus:ring-primary/40 focus:outline-none"
                />
                <span className="max-w-64 text-[11px] leading-snug text-on-surface-variant/70">
                  Stamped on every row that did not bring its own date — a holdings export carries
                  an average cost, not purchase dates — so it is an approximation.
                </span>
              </label>

              {!hasObjective && (
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
                    What is this portfolio for? (optional)
                  </span>
                  <input
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    maxLength={2000}
                    placeholder="e.g. Long-term compounding, 10-year horizon, no leverage."
                    className="sunken rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
                  />
                  <span className="text-[11px] text-on-surface-variant/70">
                    Asked once. You can change it later.
                  </span>
                </label>
              )}
            </div>
          </section>

          <PreviewTable
            rows={resolved}
            lineOffset={lineOffset}
            notes={notes}
            confirmed={confirmed}
            onNote={(index, note) => setNotes((prev) => ({ ...prev, [index]: note }))}
            onConfirm={(index, value) =>
              setConfirmed((prev) => {
                const next = new Set(prev);
                if (value) next.add(index);
                else next.delete(index);
                return next;
              })
            }
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={commit}
              disabled={busy || importable.length === 0}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-colors hover:bg-primary-dim disabled:opacity-40"
            >
              {busy
                ? "Importing…"
                : `Import ${importable.length} holding${importable.length === 1 ? "" : "s"}`}
            </button>
            {importable.length === 0 && (
              <span className="text-xs text-on-surface-variant/70">
                Nothing here can be imported yet — fix a row, or tick a duplicate to import it
                anyway.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
