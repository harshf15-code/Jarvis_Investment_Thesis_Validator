"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { ConsultDialog } from "@/components/council/consult-dialog";
import { usePortfolios } from "@/components/layout/portfolio-context";
import { PortfolioCouncilReportView } from "@/components/portfolio/council/portfolio-council-report";
import {
  PortfolioCouncilReportSchema,
  type PortfolioCouncilReport,
} from "@/lib/jarvis-portfolio-council";
import type { Portfolio, PortfolioCouncilReportRow } from "@/lib/types";

/**
 * Consult, then read. History below.
 *
 * Every stored document is re-validated on the way in, so a report written by
 * an older schema degrades to a labelled "re-run this" rather than rendering
 * half a verdict as though it were whole.
 */
export function PortfolioCouncilClient({
  currentQuantities,
  positionCount,
  portfolio,
}: {
  /** Ticker → quantity still held, so staleness sees a trim, not just a sale. */
  currentQuantities: Map<string, number>;
  positionCount: number;
  /** The book being consulted on. Null only in the roll-up, where PAST consults
   *  are still listed — "when did I last have anything looked at" is a fair
   *  question across books — but a new one is not offered: the Council judges
   *  one book's construction against one objective, and there is no objective
   *  for several books at once. */
  portfolio: Portfolio | null;
}) {
  const { portfolios } = usePortfolios();
  const [reports, setReports] = useState<PortfolioCouncilReportRow[] | null>(null);
  /** Cursor for the next page of history; null once there is no more. */
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portfolioId = portfolio?.id ?? null;
  /** Consulting needs one book. Reading history does not. */
  const canConsult = portfolioId !== null;
  const scopeParam = portfolioId ?? "all";

  // Switching books must not leave the previous book's verdict on screen under
  // the new book's name — indefinitely, if the new request fails. The reset is
  // a `key` on this component in the page rather than a pile of setState calls
  // at the top of this effect: React remounts on a changed key, which clears
  // the reports, the selection, the cursor AND any open roster picker at once,
  // with no cascading render and nothing to keep in sync by hand.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portfolio/council?portfolio=${scopeParam}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Could not load past consults.");
        setReports(body.reports ?? []);
        setNextBefore(body.nextBefore ?? null);
        setSelectedId(body.reports?.[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeParam]);

  async function loadOlder() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/portfolio/council?portfolio=${scopeParam}&before=${encodeURIComponent(nextBefore)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load older consults.");
      setReports((prev) => [...(prev ?? []), ...(body.reports ?? [])]);
      setNextBefore(body.nextBefore ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function consult(memberIds: string[]) {
    if (!portfolioId) return;
    setPicking(false);
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/council?portfolio=${portfolioId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_ids: memberIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The consult failed.");
      setReports((prev) => [body.report, ...(prev ?? [])]);
      setSelectedId(body.report.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  const selected = reports?.find((r) => r.id === selectedId) ?? null;
  // The book the SELECTED REPORT judged, which in the roll-up is not the book
  // on screen — there isn't one. It drives the fiduciary note, so a stored
  // verdict on a managed book carries its warning wherever it is read, and a
  // verdict on your own book never borrows one.
  const reportBook = selected
    ? (portfolios.find((p) => p.id === selected.portfolio_id) ?? portfolio)
    : portfolio;
  const parsed = selected ? PortfolioCouncilReportSchema.safeParse(selected.document) : null;
  const snapshot = selected?.holdings_snapshot as
    | { as_of?: string; books?: { holdings: { ticker: string; quantity: number }[] }[] }
    | undefined;

  const reviewedHoldings = (snapshot?.books ?? []).flatMap((b) => b.holdings);
  // The tickers the REPORT reviewed, not the ones held now. A historical
  // report must show the book it actually judged: passing today's list would
  // drop a sold holding along with every call made about it, and add a
  // newly-bought one as "No view" from a panel that never saw it.
  const reviewedTickers = [...new Set(reviewedHoldings.map((h) => h.ticker))].sort();

  // Stale when the book has moved on — by ticker OR by size. Comparing only
  // the ticker set would miss adding to a position or trimming one, which
  // changes every weight in the sub-book the structural read is about.
  //
  // Only asked when ONE book is on screen. `currentQuantities` is that book's
  // holdings; in the roll-up it is every book's, and comparing a report on one
  // book against the union would mark it stale because a different book exists.
  const reviewedQty = new Map(reviewedHoldings.map((h) => [h.ticker, h.quantity]));
  const stale =
    canConsult &&
    reviewedHoldings.length > 0 &&
    (reviewedQty.size !== currentQuantities.size ||
      [...currentQuantities].some(([ticker, qty]) => reviewedQty.get(ticker) !== qty));

  return (
    <div className="flex flex-col gap-6">
      {!canConsult && (
        <p className="rounded-lg bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
          Past consults across every book are below. To ask for a new one, choose a single
          portfolio in the switcher — the Council judges how one book is built against what that
          book is for, and several books at once have no single answer to either.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canConsult && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={running}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-display text-sm font-extrabold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
          >
            <Users className="size-4" />
            {running ? "Deliberating…" : reports?.length ? "Consult again" : "Consult the Council"}
          </button>
        )}
        {reports !== null && reports.length > 1 && (
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className="sunken rounded-lg px-3 py-2 text-xs text-on-surface focus:ring-1 focus:ring-primary/40"
          >
            {reports.map((r) => {
              // In the roll-up two consults on the same day are two different
              // books, and a list of bare dates cannot say which is which.
              const book = canConsult
                ? null
                : portfolios.find((p) => p.id === r.portfolio_id)?.name;
              return (
                <option key={r.id} value={r.id}>
                  {r.created_at.slice(0, 10)}
                  {book ? ` · ${book}` : ""}
                </option>
              );
            })}
          </select>
        )}
        {nextBefore && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingMore}
            className="rounded-full bg-white/5 px-4 py-2 text-xs text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
          >
            {loadingMore ? "Loading…" : "Load older consults"}
          </button>
        )}
      </div>

      {running && (
        <p className="rounded-lg bg-status-blue-container px-4 py-3 text-sm text-status-blue">
          Refreshing every holding, then asking each member. This one is slower than a thesis
          consult because it prices the whole book first.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>
      )}

      {reports !== null && reports.length === 0 && !running && canConsult && (
        <p className="text-sm text-on-surface-variant">
          No consult yet. {positionCount} open position{positionCount === 1 ? "" : "s"} to review.
        </p>
      )}

      {parsed && !parsed.success && (
        <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">
          This report was written in an older format and can&apos;t be shown. Consult again.
        </p>
      )}

      {parsed?.success && (
        <PortfolioCouncilReportView
          report={parsed.data as PortfolioCouncilReport}
          heldTickers={reviewedTickers}
          asOf={snapshot?.as_of ?? selected?.created_at ?? null}
          stale={stale}
          portfolio={reportBook}
        />
      )}

      {picking && canConsult && (
        <ConsultDialog
          onClose={() => setPicking(false)}
          onConfirm={consult}
          eyebrow="Portfolio review"
          title="Consult the Council on your book"
          blurb="Each member reads every open position — freshly priced — and judges how the portfolio is built, not whether to buy one stock."
          featurePrefix="portfolio_council_"
          costNote={`Plus a live price and fundamentals fetch for all ${positionCount} holdings, so this is slower than a thesis consult.`}
        />
      )}
    </div>
  );
}
