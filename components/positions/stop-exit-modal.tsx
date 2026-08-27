"use client";

import { useState } from "react";

/** Spec US-17. Override reason must be ≥40 chars — enforced client-side for immediate feedback and again server-side (Task 22) as the source of truth. */
export function StopExitModal({
  positionId,
  remainingQuantity,
  onClose,
  onSaved,
}: {
  positionId: string;
  remainingQuantity: number;
  onClose: () => void;
  onSaved: (promptJournal: boolean) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOverride = overrideReason.trim().length > 0;
  const overrideTooShort = isOverride && overrideReason.trim().length < 40;

  async function handleSubmit() {
    if (overrideTooShort) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${positionId}/exits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          quantity: remainingQuantity,
          price: Number(price),
          type: "stop_hit",
          override: isOverride,
          override_reason: isOverride ? overrideReason : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to log exit");
      onSaved(body.promptJournal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-4 font-display text-lg text-on-surface">Exit — Stop Hit</h2>
        <div className="mb-4 flex flex-col gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <p className="text-xs text-on-surface/50">Quantity (full remaining): {remainingQuantity}</p>
          <input type="number" placeholder="Price Sold At" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <textarea
            placeholder="Override reason (optional — leave blank to exit per plan)"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            rows={3}
            className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
          />
          {overrideTooShort && (
            <p className="text-xs text-status-red">Override reason must be at least 40 characters ({overrideReason.trim().length}/40).</p>
          )}
        </div>
        {error && <p className="mb-3 text-sm text-status-red">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !price || overrideTooShort}
            className="rounded-xl bg-status-red px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
          >
            {isOverride ? "Override & Exit" : "Exit Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
