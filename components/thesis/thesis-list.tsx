"use client";

import Link from "next/link";
import { ConvictionBadge } from "./conviction-badge";
import { thesisTitle } from "@/lib/thesis-title";
import type { ConvictionTier, ThesisStatus } from "@/lib/types";

type Row = {
  id: string;
  title: string | null;
  ticker: string | null;
  status: ThesisStatus;
  conviction_tier: ConvictionTier | null;
  market_view: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<ThesisStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  macro: "Macro",
};

/** Screen HUB-3's thesis list — the canonical "view any thesis" entry point (see Task 21's Produces note). */
export function ThesisList({ rows }: { rows: Row[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((t) => (
        <Link
          key={t.id}
          href={`/thesis/${t.id}`}
          className="flex items-center justify-between rounded-xl bg-surface-container-low p-4 hover:bg-surface-container-high"
        >
          <div>
            <p className="font-display text-sm text-on-surface">{thesisTitle(t)}</p>
            <p className="mt-1 line-clamp-1 text-xs text-on-surface/60">{t.market_view ?? "—"}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-on-surface/50">{STATUS_LABEL[t.status]}</span>
            {t.conviction_tier && <ConvictionBadge tier={t.conviction_tier} />}
          </div>
        </Link>
      ))}
    </div>
  );
}
