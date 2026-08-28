"use client";

import { useState } from "react";
import { computeRecommendationStatus, computePctChangeSinceRec } from "@/lib/recommendation-status";
import { ManualExecutionModal } from "@/components/positions/manual-execution-modal";
import type { ConvictionTier, ExchangeCode } from "@/lib/types";

type Row = {
  recommendation: {
    id: string;
    trade_plan_id: string | null;
    thesis_id: string;
    stock_id: string;
    ticker: string;
    recommended_at: string;
    recommended_entry_low: number | null;
    recommended_entry_high: number | null;
    recommended_stop: number | null;
    recommended_target_1: number | null;
    recommended_target_2: number | null;
    conviction_tier: ConvictionTier;
    price_at_recommendation: number;
    converted_to_position: boolean;
    position_id: string | null;
  };
  stock: { last_price: number | null; exchange: ExchangeCode } | undefined;
};

const STATUS_STYLE: Record<string, string> = {
  open: "text-primary",
  t1_hit: "text-status-green",
  t2_hit: "text-status-green",
  stop_hit: "text-status-red",
  time_expired: "text-on-surface/50",
};

export function RecommendationsTable({ rows }: { rows: Row[] }) {
  const [buyModalRow, setBuyModalRow] = useState<Row | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-xl bg-surface-container-low">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-on-surface/50">
              <th className="p-3">Date</th>
              <th className="p-3">Ticker</th>
              <th className="p-3">Tier</th>
              <th className="p-3">Entry Zone</th>
              <th className="p-3">Price at Rec</th>
              <th className="p-3">Current</th>
              <th className="p-3">% Change</th>
              <th className="p-3">Status</th>
              <th className="p-3">Acted?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ recommendation: rec, stock }) => {
              const price = stock?.last_price;
              const status = price != null ? computeRecommendationStatus(rec, price) : null;
              const pctChange = price != null ? computePctChangeSinceRec(rec, price) : null;
              const missedWin = !rec.converted_to_position && (status === "t1_hit" || status === "t2_hit");
              const missedLoss = !rec.converted_to_position && status === "stop_hit";

              return (
                <tr
                  key={rec.id}
                  className={
                    "even:bg-surface-container-lowest hover:bg-surface-container-high " +
                    (missedWin ? "bg-status-green-container/30" : missedLoss ? "bg-surface-container-highest/60" : "")
                  }
                >
                  <td className="p-3 text-on-surface/70">{rec.recommended_at.slice(0, 10)}</td>
                  <td className="p-3 font-medium">{rec.ticker}</td>
                  <td className="p-3">{rec.conviction_tier}</td>
                  <td className="p-3 font-mono">{rec.recommended_entry_low}–{rec.recommended_entry_high}</td>
                  <td className="p-3 font-mono">{rec.price_at_recommendation}</td>
                  <td className="p-3 font-mono">{price ?? "Price unavailable"}</td>
                  <td className={`p-3 font-mono ${pctChange !== null && pctChange >= 0 ? "text-status-green" : "text-status-red"}`}>
                    {pctChange !== null ? `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%` : "—"}
                  </td>
                  <td className={`p-3 ${status ? STATUS_STYLE[status] : ""}`}>
                    {status === "t1_hit" ? "T1 Hit ✓" : status === "t2_hit" ? "T2 Hit ✓" : status === "stop_hit" ? "Stop Hit ✗" : status === "open" ? "Open" : "—"}
                    {missedWin && <div className="text-xs text-status-green/80">Jarvis was right — you didn&apos;t take this one</div>}
                    {missedLoss && <div className="text-xs text-on-surface/50">Missed bullet — stop would have hit</div>}
                  </td>
                  <td className="p-3">
                    {rec.converted_to_position ? (
                      <a href={`/positions/${rec.position_id}`} className="text-primary underline">Yes</a>
                    ) : (
                      <button type="button" onClick={() => setBuyModalRow({ recommendation: rec, stock })} className="text-on-surface/70 underline">
                        No — I Bought This
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {buyModalRow && (
        <ManualExecutionModal
          tradePlan={{
            id: buyModalRow.recommendation.trade_plan_id ?? "",
            thesis_id: buyModalRow.recommendation.thesis_id,
            stock_id: buyModalRow.recommendation.stock_id,
            ticker: buyModalRow.recommendation.ticker,
            entry_zone_low: buyModalRow.recommendation.recommended_entry_low,
            entry_zone_high: buyModalRow.recommendation.recommended_entry_high,
            stop_loss: buyModalRow.recommendation.recommended_stop,
            target_1: buyModalRow.recommendation.recommended_target_1,
            target_2: buyModalRow.recommendation.recommended_target_2,
          }}
          jarvisRecommendationId={buyModalRow.recommendation.id}
          onClose={() => setBuyModalRow(null)}
        />
      )}
    </>
  );
}
