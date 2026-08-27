"use client";

import { useState } from "react";

/** Spec US-16. On save, `promptJournal` in the response (Task 22) drives navigation to Screen 7 if this was the final exit. */
export function LogTrimModal({
  positionId,
  tier,
  onClose,
  onSaved,
}: {
  positionId: string;
  tier: "trim_t1" | "trim_t2" | "manual";
  onClose: () => void;
  onSaved: (promptJournal: boolean) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${positionId}/exits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, quantity: Number(quantity), price: Number(price), type: tier }),
      });
      const body = await res.json();
      // Surfaced rather than thrown: `POST /api/positions/:id/exits` rejects a
      // quantity above the shares remaining, and that message is the whole
      // point of the guard — a silent no-op would look like a saved trim.
      if (!res.ok) throw new Error(body.error ?? "Failed to log trim");
      onSaved(body.promptJournal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log trim");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-4 font-display text-lg text-on-surface">Log Trim</h2>
        <div className="mb-4 flex flex-col gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input type="number" placeholder="Quantity Sold" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input type="number" placeholder="Price Sold At" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
        </div>
        {error && <p className="mb-3 text-sm text-status-red">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !quantity || !price}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
