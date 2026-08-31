"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Upload } from "lucide-react";

import { ColumnMapper } from "@/components/positions/import/column-mapper";
import { PreviewTable } from "@/components/positions/import/preview-table";
import { parseCsv } from "@/lib/csv";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import {
  buildDraftRows,
  detectColumns,
  MAX_IMPORT_ROWS,
  RESOLVE_CHUNK,
  type ColumnMapping,
  type DraftImportRow,
  type ResolvedImportRow,
} from "@/lib/portfolio-import";
import { cn } from "@/lib/utils";
import type { MarketCode } from "@/lib/types";

type Step = "upload" | "preview";

/**
 * The CSV import, in three steps: map the columns, review what resolved,
 * commit.
 *
 * The file is read and parsed HERE, in the browser, and never uploaded. A
 * broker export carries account numbers, ISINs and P&L the app has no business
 * seeing; only the three mapped columns are ever sent to the server. It also
 * means the mapping UI is instant, with no round trip between choosing a file
 * and seeing whether the columns were understood.
 */
export function ImportWizard({ hasObjective }: { hasObjective: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");

  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    ticker: null,
    quantity: null,
    averagePrice: null,
    date: null,
  });
  // India by default: this is a Kite export far more often than not, and
  // probing the wrong market resolves INFY to a NYSE ADR priced in dollars.
  const [market, setMarket] = useState<MarketCode>("IN");
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [objective, setObjective] = useState("");

  const [resolved, setResolved] = useState<ResolvedImportRow[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mappingReady =
    mapping.ticker !== null && mapping.quantity !== null && mapping.averagePrice !== null;

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
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setMapping(detectColumns(parsed.headers));
    } catch {
      setError("Couldn't read that file. It needs to be a plain CSV.");
    }
  }

  async function resolveRows() {
    const drafts = buildDraftRows(rawRows, mapping);
    if (drafts.length === 0) {
      setError("No rows in that file have a ticker in the column you mapped.");
      return;
    }
    if (drafts.length > MAX_IMPORT_ROWS) {
      setError(`That file has ${drafts.length} holdings; ${MAX_IMPORT_ROWS} is the most one import can take.`);
      return;
    }

    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: drafts.length });
    const out: ResolvedImportRow[] = [];
    try {
      // Chunked because each row costs up to one Yahoo quote per exchange in
      // the chosen market. One request for 200 rows would time out; eight
      // bounded ones with a progress line will not.
      for (let i = 0; i < drafts.length; i += RESOLVE_CHUNK) {
        const chunk: DraftImportRow[] = drafts.slice(i, i + RESOLVE_CHUNK);
        const res = await fetch("/api/portfolio/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ market, rows: chunk }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Couldn't price these holdings.");
        out.push(...(body.rows as ResolvedImportRow[]));
        setProgress({ done: Math.min(i + RESOLVE_CHUNK, drafts.length), total: drafts.length });
      }
      setResolved(out);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const importable = resolved.filter(
    (r) => r.status === "resolved" || (r.status === "duplicate" && confirmed.has(r.index)),
  );
  const skipped = resolved.filter((r) => !importable.includes(r));

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_filename: fileName,
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
          })),
          skipped: skipped.map((r) => ({
            row: r.index + 2,
            ticker: r.ticker,
            reason: r.reason ?? "Skipped",
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't save these holdings.");
      router.push("/positions");
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
                1 · The file
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                Any broker&apos;s holdings export, as long as it has a ticker, a quantity and an
                average cost. It is read in your browser — only the three columns you map are ever
                sent anywhere.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-3 self-start rounded-full border border-white/10 px-4 py-2 text-xs text-on-surface-variant transition-colors hover:border-white/25 hover:text-on-surface">
              <Upload className="size-3.5" />
              {fileName || "Choose a CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
            </label>

            <div>
              <p className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
                Market
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {MARKET_ORDER.map((code) => {
                  const meta = MARKETS[code];
                  return (
                    <button
                      key={code}
                      type="button"
                      disabled={!meta.live || busy}
                      aria-pressed={market === code}
                      onClick={() => setMarket(code)}
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
              <p className="mt-2 text-[11px] text-on-surface-variant/70">
                One market per file. The same symbol can be listed in two of them at very different
                prices, so this is not something Jarvis will guess.
              </p>
            </div>
          </section>

          {headers.length > 0 && (
            <section className="glass-panel flex flex-col gap-4 rounded-xl p-5">
              <div>
                <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
                  2 · The columns
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {rawRows.length} row{rawRows.length === 1 ? "" : "s"} found. Change anything Jarvis
                  guessed wrong.
                </p>
              </div>

              <ColumnMapper headers={headers} mapping={mapping} onChange={setMapping} />

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

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={resolveRows}
                  disabled={!mappingReady || busy}
                  className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-colors hover:bg-primary-dim disabled:opacity-40"
                >
                  {busy ? "Pricing…" : "Price these holdings"}
                </button>
                {progress && (
                  <span className="text-xs text-on-surface-variant">
                    {progress.done} of {progress.total}
                  </span>
                )}
                {!mappingReady && (
                  <span className="text-xs text-on-surface-variant/70">
                    Ticker, quantity and average cost are all needed.
                  </span>
                )}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="glass-panel flex flex-col gap-4 rounded-xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
                  3 · Check before anything is saved
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Nothing has been written yet. {importable.length} to import
                  {skipped.length > 0 ? `, ${skipped.length} skipped` : ""}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep("upload")}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface"
              >
                <ArrowLeft className="size-3.5" />
                Back to the columns
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
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="sunken rounded-lg px-3 py-2 text-sm text-on-surface focus:ring-1 focus:ring-primary/40 focus:outline-none"
                />
                <span className="max-w-64 text-[11px] leading-snug text-on-surface-variant/70">
                  A holdings export carries an average cost, not purchase dates. This one date is
                  stamped on every row, and it is an approximation.
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
                Nothing here can be imported yet — fix a row in your file, or tick a duplicate to
                import it anyway.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
