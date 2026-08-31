"use client";

import {
  IMPORT_COLUMN_LABELS,
  type ColumnMapping,
  type ImportColumnKey,
} from "@/lib/portfolio-import";

const KEYS: ImportColumnKey[] = ["ticker", "quantity", "averagePrice", "date"];

/**
 * Step 1's mapping grid. Every auto-detected column is shown and every one is
 * editable — the detection is a head start, not a decision. A key that matched
 * nothing shows "Not in this file", which is the honest state for a header the
 * synonym table has never seen.
 */
export function ColumnMapper({
  headers,
  mapping,
  onChange,
}: {
  headers: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {KEYS.map((key) => {
        const required = key !== "date";
        const missing = required && mapping[key] === null;
        return (
          <label key={key} className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
              {IMPORT_COLUMN_LABELS[key]}
            </span>
            <select
              value={mapping[key] ?? ""}
              onChange={(e) =>
                onChange({ ...mapping, [key]: e.target.value === "" ? null : Number(e.target.value) })
              }
              className={`sunken rounded-lg px-3 py-2 text-sm text-on-surface focus:ring-1 focus:ring-primary/40 focus:outline-none ${
                missing ? "ring-1 ring-error/50" : ""
              }`}
            >
              <option value="">Not in this file</option>
              {headers.map((header, index) => (
                <option key={`${header}-${index}`} value={index}>
                  {header || `Column ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
