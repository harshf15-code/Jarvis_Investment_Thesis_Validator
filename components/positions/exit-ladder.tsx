"use client";

import type { Exit, TradePlan } from "@/lib/types";

type LadderRow = { key: string; label: string; status: "PENDING" | "HIT" | "DONE" };

/** Spec US-15: 5-row exit ladder — T1 Trim (40%) / T2 Trim (40%) / Runner Hold (20%) / Stop Exit / Time Exit. */
export function ExitLadder({
  tradePlan,
  exits,
  currentPrice,
  onLogTrim,
  onLogStop,
}: {
  tradePlan: TradePlan;
  exits: Exit[];
  currentPrice: number | null;
  onLogTrim: (tier: "trim_t1" | "trim_t2") => void;
  onLogStop: () => void;
}) {
  const hasExit = (type: Exit["type"]) => exits.some((e) => e.type === type);

  const rows: LadderRow[] = [
    {
      key: "trim_t1",
      label: "T1 Trim (40%)",
      status: hasExit("trim_t1")
        ? "DONE"
        : currentPrice !== null && tradePlan.target_1 !== null && currentPrice >= tradePlan.target_1
          ? "HIT"
          : "PENDING",
    },
    {
      key: "trim_t2",
      label: "T2 Trim (40%)",
      status: hasExit("trim_t2")
        ? "DONE"
        : currentPrice !== null && tradePlan.target_2 !== null && currentPrice >= tradePlan.target_2
          ? "HIT"
          : "PENDING",
    },
    {
      key: "runner",
      label: "Runner Hold (20%)",
      status: hasExit("trim_t1") && hasExit("trim_t2") ? "DONE" : "PENDING",
    },
    {
      key: "stop_hit",
      label: "Stop Exit",
      status: hasExit("stop_hit")
        ? "DONE"
        : currentPrice !== null && tradePlan.stop_loss !== null && currentPrice <= tradePlan.stop_loss
          ? "HIT"
          : "PENDING",
    },
    { key: "time_exit", label: "Time Exit", status: hasExit("time_exit") ? "DONE" : "PENDING" },
  ];

  const STATUS_STYLE: Record<LadderRow["status"], string> = {
    PENDING: "text-on-surface/40",
    HIT: "text-primary",
    DONE: "text-status-green",
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-4">
      <h3 className="mb-1 font-display text-sm uppercase text-on-surface/50">Exit Ladder</h3>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between py-2">
          <span className="text-sm text-on-surface">{row.label}</span>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium ${STATUS_STYLE[row.status]}`}>{row.status}</span>
            {row.key === "trim_t1" && row.status !== "DONE" && (
              <button type="button" onClick={() => onLogTrim("trim_t1")} className="text-xs text-primary underline">
                Log Trim
              </button>
            )}
            {row.key === "trim_t2" && row.status !== "DONE" && (
              <button type="button" onClick={() => onLogTrim("trim_t2")} className="text-xs text-primary underline">
                Log Trim
              </button>
            )}
            {row.key === "stop_hit" && row.status !== "DONE" && (
              <button type="button" onClick={onLogStop} className="text-xs text-status-red underline">
                Exit — Stop Hit
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
