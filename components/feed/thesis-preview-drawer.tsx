// components/feed/thesis-preview-drawer.tsx
"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";

type ThesisPreview = { ticker: string | null; market_view: string | null; invalidation_condition: string | null };

/** Spec US-08's "Link to Thesis" slide-out — shows the linked thesis with the signal highlighted as supporting/contrary evidence. */
export function ThesisPreviewDrawer({ thesisId, headline, onClose }: { thesisId: string; headline: string; onClose: () => void }) {
  const [thesis, setThesis] = useState<ThesisPreview | null>(null);

  useEffect(() => {
    fetch(`/api/theses/${thesisId}`).then((res) => res.json()).then((body) => setThesis(body.thesis));
  }, [thesisId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-surface-container-low p-6 shadow-ambient">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-on-surface/60 hover:text-on-surface" aria-label="Close">
          <X className="size-5" />
        </button>
        {!thesis ? (
          <SkeletonLoader lines={4} />
        ) : (
          <>
            <h2 className="font-display text-lg text-on-surface">{thesis.ticker ?? "Macro Thesis"}</h2>
            <div className="rounded-xl bg-primary-container p-4">
              <p className="text-xs uppercase text-primary">This signal</p>
              <p className="mt-1 text-sm text-primary">{headline}</p>
            </div>
            <div className="rounded-xl bg-surface-container-highest p-4">
              <p className="text-xs text-on-surface/50">Market View</p>
              <p className="mt-1 text-sm text-on-surface">{thesis.market_view ?? "—"}</p>
            </div>
            <div className="rounded-xl bg-surface-container-highest p-4">
              <p className="text-xs text-on-surface/50">Invalidation</p>
              <p className="mt-1 text-sm text-on-surface">{thesis.invalidation_condition ?? "—"}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
