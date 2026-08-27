// app/(app)/feed/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { SignalCard } from "@/components/feed/signal-card";
import { AgendaSidebar } from "@/components/feed/agenda-sidebar";
import { AddSignalModal } from "@/components/feed/add-signal-modal";
import { ThesisPreviewDrawer } from "@/components/feed/thesis-preview-drawer";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import type { IntelligenceSignal } from "@/lib/types";

export default function FeedPage() {
  const [signals, setSignals] = useState<IntelligenceSignal[] | null>(null);
  const [agenda, setAgenda] = useState<{ ticker: string; timeExitDate: string | null }[]>([]);
  const [tab, setTab] = useState<"active" | "reviewed">("active");
  const [addOpen, setAddOpen] = useState(false);
  const [previewSignal, setPreviewSignal] = useState<IntelligenceSignal | null>(null);

  async function load() {
    const res = await fetch("/api/signals");
    const body = await res.json();
    setSignals(body.signals ?? []);
    setAgenda(body.agenda ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/signals");
      const body = await res.json();
      if (cancelled) return;
      setSignals(body.signals ?? []);
      setAgenda(body.agenda ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleArchive(id: string) {
    await fetch(`/api/signals/${id}`, { method: "PATCH" });
    load();
  }

  if (!signals) return <SkeletonLoader lines={6} />;

  const visible = signals.filter((s) => (tab === "active" ? !s.archived_at : !!s.archived_at));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl text-on-surface">Jarvis Intelligence Feed</h1>
          <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-on-primary">
            <Plus className="size-4" /> Add Signal
          </button>
        </div>

        <div className="mb-4 flex gap-4 text-sm">
          <button type="button" onClick={() => setTab("active")} className={tab === "active" ? "text-primary" : "text-on-surface/50"}>Active</button>
          <button type="button" onClick={() => setTab("reviewed")} className={tab === "reviewed" ? "text-primary" : "text-on-surface/50"}>Reviewed</button>
        </div>

        {visible.length === 0 ? (
          <EmptyState title="No signals yet." description="Add a signal to start tracking thesis-relevant news →" />
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((s) => (
              <SignalCard
                key={s.id}
                signal={s}
                onLinkToThesis={() => setPreviewSignal(s)}
                onArchive={() => handleArchive(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AgendaSidebar agenda={agenda} />

      {addOpen && <AddSignalModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />}
      {previewSignal?.thesis_id && (
        <ThesisPreviewDrawer thesisId={previewSignal.thesis_id} headline={previewSignal.headline} onClose={() => setPreviewSignal(null)} />
      )}
    </div>
  );
}
