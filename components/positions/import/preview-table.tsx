"use client";

import { formatCurrency } from "@/lib/format";
import type { ImportRowStatus, ResolvedImportRow } from "@/lib/portfolio-import";

const STATUS_STYLE: Record<ImportRowStatus, string> = {
  resolved: "bg-status-green-container text-status-green",
  duplicate: "bg-status-blue-container text-status-blue",
  unresolved: "bg-error-container text-error",
  invalid: "bg-error-container text-error",
};

const STATUS_LABEL: Record<ImportRowStatus, string> = {
  resolved: "Ready",
  duplicate: "Already held",
  unresolved: "Not found",
  invalid: "Check this row",
};

/**
 * Step 2's preview. Nothing has been written when this renders, which is the
 * point: a typo'd symbol or a delisted name is something to catch here rather
 * than to discover later on the Cockpit.
 *
 * A row that failed is shown WITH its reason, never dropped silently. A
 * duplicate is shown with a checkbox, because "I really do want a second
 * position in this name" is a legitimate thing to mean.
 */
export function PreviewTable({
  rows,
  notes,
  confirmed,
  onNote,
  onConfirm,
}: {
  rows: ResolvedImportRow[];
  notes: Record<number, string>;
  confirmed: Set<number>;
  onNote: (index: number, note: string) => void;
  onConfirm: (index: number, value: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-surface-container-low">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-on-surface/50">
            <th className="p-3">Line</th>
            <th className="p-3">Ticker</th>
            <th className="p-3">Company</th>
            <th className="p-3">Qty</th>
            <th className="p-3">Avg cost</th>
            <th className="p-3">Status</th>
            <th className="p-3">Why did you buy this?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const failed = row.status === "unresolved" || row.status === "invalid";
            return (
              <tr
                key={row.index}
                className={`align-top even:bg-surface-container-lowest ${failed ? "opacity-60" : ""}`}
              >
                {/* +2: their file has a header on line 1, so this is the line
                    number they will actually find in their spreadsheet. */}
                <td className="p-3 font-mono text-xs text-on-surface/40">{row.index + 2}</td>
                <td className={`p-3 font-medium ${failed ? "line-through" : "text-on-surface"}`}>
                  {row.ticker}
                  {row.exchange && (
                    <span className="ml-1.5 font-mono text-[9px] text-on-surface/40">{row.exchange}</span>
                  )}
                </td>
                <td className="p-3 text-on-surface-variant">{row.companyName ?? "—"}</td>
                <td className="p-3 font-mono tabular-nums">{row.quantity ?? "—"}</td>
                <td className="p-3 font-mono tabular-nums">
                  {row.averagePrice !== null && row.currency
                    ? formatCurrency(row.averagePrice, row.currency)
                    : (row.averagePrice ?? "—")}
                </td>
                <td className="p-3">
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[9px] tracking-wider uppercase ${STATUS_STYLE[row.status]}`}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                  {row.reason && (
                    <p className="mt-1 max-w-56 text-[11px] leading-snug text-on-surface-variant/70">
                      {row.reason}
                    </p>
                  )}
                  {row.status === "duplicate" && (
                    <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-on-surface-variant">
                      <input
                        type="checkbox"
                        checked={confirmed.has(row.index)}
                        onChange={(e) => onConfirm(row.index, e.target.checked)}
                        className="size-3 accent-[var(--color-primary)]"
                      />
                      Import anyway
                    </label>
                  )}
                </td>
                <td className="p-3">
                  {!failed && (
                    <input
                      value={notes[row.index] ?? ""}
                      onChange={(e) => onNote(row.index, e.target.value)}
                      placeholder="e.g. lending growth + cheap vs peers"
                      maxLength={2000}
                      className="sunken w-48 rounded-lg px-2.5 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
