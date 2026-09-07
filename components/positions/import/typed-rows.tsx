"use client";

import { Plus, X } from "lucide-react";

import { localToday, MAX_IMPORT_ROWS, type TypedHoldingEntry } from "@/lib/portfolio-import";

/**
 * The holdings table for someone who has three stocks to add and no wish to
 * build a spreadsheet for the app to read back.
 *
 * It produces nothing new. `buildTypedRows` turns these fields into the same
 * `DraftImportRow[]` a CSV produces, and from there the wizard's existing path
 * prices them, checks the currency, flags a name already held and commits — so
 * a typed holding and an imported one are the same holding, resolved by the
 * same code, shown in the same preview before anything is written.
 *
 * NOTHING here is validated as you type. A red field under the cursor is a
 * scold; the preview step one click away already says what is wrong with a row
 * and says it beside the company name it resolved to, which is the context that
 * makes "check this row" actionable.
 */
export function TypedRowsEditor({
  rows,
  onChange,
  disabled = false,
}: {
  rows: TypedHoldingEntry[];
  onChange: (rows: TypedHoldingEntry[]) => void;
  /** Set while a resolve is in flight — see the wizard's `PortfolioPicker`. */
  disabled?: boolean;
}) {
  function update(index: number, field: keyof TypedHoldingEntry, value: string) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    if (rows.length >= MAX_IMPORT_ROWS) return;
    onChange([...rows, { ticker: "", quantity: "", averagePrice: "", date: "" }]);
  }

  function removeRow(index: number) {
    // Never down to nothing: an empty table offers no way back to a first row
    // except the "another row" button, which reads as a dead end on a form that
    // is supposed to be the quick path.
    if (rows.length === 1) {
      onChange([{ ticker: "", quantity: "", averagePrice: "", date: "" }]);
      return;
    }
    onChange(rows.filter((_, i) => i !== index));
  }

  const field =
    "sunken w-full rounded-lg px-2.5 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary/40 focus:outline-none disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left">
          <thead>
            <tr className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
              <th className="pb-2 pr-3 font-normal">Ticker</th>
              <th className="pb-2 pr-3 font-normal">Quantity</th>
              <th className="pb-2 pr-3 font-normal">Average cost</th>
              <th className="pb-2 pr-3 font-normal">Bought on</th>
              <th className="pb-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td className="pb-2 pr-3 align-top">
                  <input
                    value={row.ticker}
                    onChange={(e) => update(index, "ticker", e.target.value)}
                    disabled={disabled}
                    placeholder="INFY"
                    maxLength={40}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Ticker, row ${index + 1}`}
                    className={`${field} font-mono uppercase`}
                  />
                </td>
                <td className="pb-2 pr-3 align-top">
                  <input
                    type="number"
                    // `any`, not a fixed step: 0029 widened the quantity column
                    // so a satoshi-level lot survives, and a typed one must not
                    // be rounded to zero by the input before it is even sent.
                    step="any"
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => update(index, "quantity", e.target.value)}
                    disabled={disabled}
                    placeholder="50"
                    aria-label={`Quantity, row ${index + 1}`}
                    className={`${field} font-mono tabular-nums`}
                  />
                </td>
                <td className="pb-2 pr-3 align-top">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={row.averagePrice}
                    onChange={(e) => update(index, "averagePrice", e.target.value)}
                    disabled={disabled}
                    placeholder="1420"
                    aria-label={`Average cost, row ${index + 1}`}
                    className={`${field} font-mono tabular-nums`}
                  />
                </td>
                <td className="pb-2 pr-3 align-top">
                  <input
                    type="date"
                    value={row.date}
                    // The preview refuses a future date and so does the commit
                    // route. This only stops the trader reaching a refusal they
                    // could have been spared.
                    max={localToday()}
                    onChange={(e) => update(index, "date", e.target.value)}
                    disabled={disabled}
                    aria-label={`Bought on, row ${index + 1}`}
                    className={field}
                  />
                </td>
                <td className="pb-2 align-top">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    disabled={disabled}
                    aria-label={`Remove row ${index + 1}`}
                    className="rounded-full p-1.5 text-on-surface-variant/50 transition-colors hover:bg-white/5 hover:text-on-surface disabled:opacity-30"
                  >
                    <X className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          disabled={disabled || rows.length >= MAX_IMPORT_ROWS}
          className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-white/25 hover:text-on-surface disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Another row
        </button>
        <span className="text-[11px] text-on-surface-variant/70">
          Leave the date blank and the one you set on the next screen is used instead. Nothing is
          saved until you have seen what each ticker resolved to.
        </span>
      </div>
    </div>
  );
}
