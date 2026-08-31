"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { ConsultDialog } from "@/components/council/consult-dialog";
import { PortfolioCouncilReportView } from "@/components/portfolio/council/portfolio-council-report";
import {
  PortfolioCouncilReportSchema,
  type PortfolioCouncilReport,
} from "@/lib/jarvis-portfolio-council";
import type { PortfolioCouncilReportRow } from "@/lib/types";

/**
 * Consult, then read. History below.
 *
 * Every stored document is re-validated on the way in, so a report written by
 * an older schema degrades to a labelled "re-run this" rather than rendering
 * half a verdict as though it were whole.
 */
export function PortfolioCouncilClient({
  heldTickers,
  positionCount,
}: {
  heldTickers: string[];
  positionCount: number;
}) {
  const [reports, setReports] = useState<PortfolioCouncilReportRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio/council");
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Could not load past consults.");
        setReports(body.reports ?? []);
        setSelectedId(body.reports?.[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function consult(memberIds: string[]) {
    setPicking(false);
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/council", {
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
  const parsed = selected ? PortfolioCouncilReportSchema.safeParse(selected.document) : null;
  const snapshot = selected?.holdings_snapshot as
    | { as_of?: string; books?: { holdings: { ticker: string }[] }[] }
    | undefined;

  // The book has moved on if what was reviewed no longer matches what is held.
  const reviewed = new Set(
    (snapshot?.books ?? []).flatMap((b) => b.holdings.map((h) => h.ticker)),
  );
  const stale =
    reviewed.size > 0 &&
    (reviewed.size !== heldTickers.length || heldTickers.some((t) => !reviewed.has(t)));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setPicking(true)}
          disabled={running}
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-display text-sm font-extrabold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
        >
          <Users className="size-4" />
          {running ? "Deliberating…" : reports?.length ? "Consult again" : "Consult the Council"}
        </button>
        {reports !== null && reports.length > 1 && (
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className="sunken rounded-lg px-3 py-2 text-xs text-on-surface focus:ring-1 focus:ring-primary/40"
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.created_at.slice(0, 10)}
              </option>
            ))}
          </select>
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

      {reports !== null && reports.length === 0 && !running && (
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
          heldTickers={heldTickers}
          asOf={snapshot?.as_of ?? selected?.created_at ?? null}
          stale={stale}
        />
      )}

      {picking && (
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
