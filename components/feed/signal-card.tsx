// components/feed/signal-card.tsx
"use client";

import type { IntelligenceSignal } from "@/lib/types";

const PRIORITY_STYLE: Record<IntelligenceSignal["priority"], string> = {
  red: "bg-status-red-container text-status-red",
  amber: "bg-primary-container text-primary",
  blue: "bg-status-blue-container text-status-blue",
  grey: "bg-surface-container-highest text-on-surface/60",
};

export function SignalCard({
  signal,
  onLinkToThesis,
  onArchive,
}: {
  signal: IntelligenceSignal;
  onLinkToThesis: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-surface-container-low p-4">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_STYLE[signal.priority]}`}>
            {signal.priority}
          </span>
          {signal.ticker && <span className="text-xs font-medium text-on-surface">{signal.ticker}</span>}
          {signal.theme && <span className="text-xs text-on-surface/50">{signal.theme}</span>}
        </div>
        <p className="text-sm text-on-surface">{signal.headline}</p>
        <p className="mt-1 text-xs text-on-surface/40">{new Date(signal.created_at).toLocaleString()}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {signal.thesis_id && (
          <button type="button" onClick={onLinkToThesis} className="text-xs text-primary underline">Link to Thesis</button>
        )}
        <button type="button" onClick={onArchive} className="text-xs text-on-surface/40 underline">Archive</button>
      </div>
    </div>
  );
}
