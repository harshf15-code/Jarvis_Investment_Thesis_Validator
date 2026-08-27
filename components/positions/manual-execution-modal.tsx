"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TradePlanSummary = {
  id: string;
  thesis_id: string;
  stock_id: string;
  ticker: string;
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
};

const CHECKLIST_ITEMS = [
  "Is entry in or near the zone?",
  "Is my stop set?",
  "Is my position size within the planned %?",
  "Is this thesis still valid (not invalidated)?",
];

/** Spec US-13/US-14: no broker integration — this logs a buy the user already made. Checklist is a reminder only, never a gate. */
export function ManualExecutionModal({
  tradePlan,
  jarvisRecommendationId,
  onClose,
}: {
  tradePlan: TradePlanSummary;
  jarvisRecommendationId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST_ITEMS.map(() => false));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [tranche, setTranche] = useState<"T1" | "T2" | "add">("T1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceNum = Number(price);
  const outsideZone =
    price !== "" &&
    tradePlan.entry_zone_low !== null &&
    tradePlan.entry_zone_high !== null &&
    (priceNum < tradePlan.entry_zone_low || priceNum > tradePlan.entry_zone_high);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade_plan_id: tradePlan.id,
          thesis_id: tradePlan.thesis_id,
          stock_id: tradePlan.stock_id,
          ticker: tradePlan.ticker,
          date,
          quantity: Number(quantity),
          price: priceNum,
          tranche,
          jarvis_recommendation_id: jarvisRecommendationId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to log buy");
      onClose();
      router.push(`/positions/${body.position.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log buy");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-1 font-display text-lg text-on-surface">Log My Buy — {tradePlan.ticker}</h2>
        <p className="mb-4 text-xs text-on-surface/50">
          Entry Zone {tradePlan.entry_zone_low}–{tradePlan.entry_zone_high} · Stop {tradePlan.stop_loss} · T1{" "}
          {tradePlan.target_1} · T2 {tradePlan.target_2}
        </p>

        <div className="mb-4 flex flex-col gap-2">
          {CHECKLIST_ITEMS.map((item, i) => (
            <label key={item} className="flex items-center gap-2 text-sm text-on-surface/80">
              <input
                type="checkbox"
                checked={checked[i]}
                onChange={(e) => setChecked((c) => c.map((v, idx) => (idx === i ? e.target.checked : v)))}
              />
              {item}
            </label>
          ))}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <select value={tranche} onChange={(e) => setTranche(e.target.value as typeof tranche)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
            <option value="T1">First buy</option>
            <option value="T2">Second buy</option>
            <option value="add">Adding to position</option>
          </select>
          <input type="number" placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input type="number" placeholder="Avg price paid" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
        </div>

        {outsideZone && (
          <p className="mb-4 rounded-lg bg-primary-container px-3 py-2 text-xs text-primary">
            You entered at {price} — outside your planned zone of {tradePlan.entry_zone_low}–{tradePlan.entry_zone_high}.
            Your actual risk/reward will be recalculated. Proceeding.
          </p>
        )}

        {error && <p className="mb-4 text-xs text-status-red">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !quantity || !price}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
          >
            Log My Buy
          </button>
        </div>
      </div>
    </div>
  );
}
