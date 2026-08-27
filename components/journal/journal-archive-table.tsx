"use client";

import { useMemo, useState } from "react";
import type { TradeJournalEntry, ThesisOutcome } from "@/lib/types";

/** Spec US-19: filterable archive + aggregate stats + expandable rows. */
export function JournalArchiveTable({ entries }: { entries: TradeJournalEntry[] }) {
  const [tickerFilter, setTickerFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<ThesisOutcome | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (tickerFilter && !e.ticker.toLowerCase().includes(tickerFilter.toLowerCase())) return false;
      if (outcomeFilter !== "all" && e.thesis_outcome !== outcomeFilter) return false;
      return true;
    });
  }, [entries, tickerFilter, outcomeFilter]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const avgDiscipline = total > 0 ? filtered.reduce((s, e) => s + e.discipline_score, 0) / total : 0;
    const wins = filtered.filter((e) => e.pnl_pct !== null && e.pnl_pct > 0).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const tagCounts = new Map<string, number>();
    for (const e of filtered) for (const tag of e.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const mostCommonTag = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    return { total, avgDiscipline, winRate, mostCommonTag };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Trades Reviewed", stats.total],
          ["Avg Discipline", stats.avgDiscipline.toFixed(1)],
          ["Win Rate", `${stats.winRate.toFixed(0)}%`],
          ["Most Common Lesson Tag", stats.mostCommonTag],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-surface-container-low p-4">
            <p className="font-display text-xs uppercase text-on-surface/50">{label}</p>
            <p className="mt-1 font-mono text-lg text-on-surface">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <input
          placeholder="Filter by ticker"
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
          className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
        />
        <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as ThesisOutcome | "all")} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
          <option value="all">All outcomes</option>
          <option value="confirmed">Confirmed</option>
          <option value="partially_confirmed">Partially Confirmed</option>
          <option value="invalidated">Invalidated</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl bg-surface-container-low">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-on-surface/50">
              <th className="p-3">Ticker</th>
              <th className="p-3">P&L %</th>
              <th className="p-3">Outcome</th>
              <th className="p-3">Discipline</th>
              <th className="p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <>
                <tr
                  key={e.id}
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="cursor-pointer even:bg-surface-container-lowest hover:bg-surface-container-high"
                >
                  <td className="p-3 font-medium">{e.ticker}</td>
                  <td className={`p-3 font-mono ${e.pnl_pct != null && e.pnl_pct >= 0 ? "text-status-green" : "text-status-red"}`}>
                    {e.pnl_pct != null ? `${e.pnl_pct >= 0 ? "+" : ""}${e.pnl_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="p-3">{e.thesis_outcome.replace("_", " ")}</td>
                  <td className="p-3">{e.discipline_score}/5</td>
                  <td className="p-3 text-on-surface/60">{e.created_at.slice(0, 10)}</td>
                </tr>
                {expanded === e.id && (
                  <tr key={`${e.id}-detail`} className="bg-surface-container-lowest">
                    <td colSpan={5} className="p-4 text-sm text-on-surface/80">
                      <p><span className="text-on-surface/50">Jarvis Verdict:</span> {e.jarvis_verdict ?? "—"}</p>
                      <p className="mt-2"><span className="text-on-surface/50">Lessons:</span> {e.lessons ?? "—"}</p>
                      <div className="mt-2 flex gap-2">
                        {e.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-surface-container-highest px-2 py-0.5 text-xs">{tag}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
