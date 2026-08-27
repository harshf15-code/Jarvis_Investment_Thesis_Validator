"use client";

import { useState } from "react";

import type { ThesisCondition } from "@/lib/types";

/** Spec US-15: 3-4 measurable thesis conditions with editable current values — see this task's ruling for `thesis_conditions`'s migration. */
export function ThesisMetricsPanel({
  tradePlanId,
  conditions,
  warningText,
}: {
  tradePlanId: string;
  conditions: ThesisCondition[];
  warningText: string | null;
}) {
  const [rows, setRows] = useState(conditions);
  const [error, setError] = useState<string | null>(null);
  // Bumped for one row when its save is rolled back, to remount that
  // (uncontrolled) input so the DOM value follows the rollback instead of
  // keeping the unsaved text on screen. Same `defaultValue`-remount trick as
  // `app/(app)/thesis/[id]/page.tsx`; keyed per row so a failure here can't
  // discard text the user is mid-way through typing in a sibling row.
  const [revisions, setRevisions] = useState<Record<number, number>>({});

  async function handleBlur(index: number, value: string) {
    if (rows[index].currentValue === value) return;
    const previous = rows;
    const next = rows.map((r, i) => (i === index ? { ...r, currentValue: value } : r));
    setRows(next);
    setError(null);
    try {
      const res = await fetch(`/api/trade-plans/${tradePlanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis_conditions: next }),
      });
      // A silently-dropped autosave on a financial tracking field is worse than
      // a visible failure — the user would keep trading off a number they think
      // is recorded. So a failure rolls the optimistic value back rather than
      // leaving an unsaved number sitting there looking saved.
      if (!res.ok) throw new Error("Failed to save thesis condition");
    } catch {
      setRows(previous);
      setRevisions((r) => ({ ...r, [index]: (r[index] ?? 0) + 1 }));
      setError("Couldn't save that value — reverted to the last saved one. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-sm uppercase text-on-surface/50">Thesis Metrics</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-on-surface/50">No thesis conditions tracked for this plan.</p>
      ) : (
        rows.map((c, i) => (
          <div key={`${revisions[i] ?? 0}-${i}-${c.label}`} className="flex items-center justify-between rounded-xl bg-surface-container-low p-3">
            <div>
              <p className="text-sm text-on-surface">{c.label}</p>
              <p className="text-xs text-on-surface/50">needs {c.target}</p>
            </div>
            <input
              defaultValue={c.currentValue}
              onBlur={(e) => handleBlur(i, e.target.value)}
              className="w-24 rounded-lg bg-surface-container-highest px-2 py-1 text-right text-sm font-mono"
            />
          </div>
        ))
      )}
      {error && <p className="text-xs text-status-red">{error}</p>}
      {warningText && (
        <div className="rounded-xl bg-primary-container px-4 py-3 text-sm text-primary">
          <span className="font-display text-xs uppercase">Invalidation</span>
          <p className="mt-1">{warningText}</p>
        </div>
      )}
    </div>
  );
}
