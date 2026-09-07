"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { SignalCard } from "@/components/feed/signal-card";
import { AgendaSidebar } from "@/components/feed/agenda-sidebar";
import { AddSignalModal } from "@/components/feed/add-signal-modal";
import { ThesisPreviewDrawer } from "@/components/feed/thesis-preview-drawer";
import { EmptyState } from "@/components/shared/empty-state";
import type { IntelligenceSignal } from "@/lib/types";

export type AgendaItem = { ticker: string; timeExitDate: string | null };

/**
 * The interactive half of `/feed`: tabs, the archive button, the add modal and
 * the thesis preview drawer.
 *
 * `signals` and `agenda` are read on the SERVER by `readSignalFeed` and arrive
 * in the HTML. This used to mount, render a skeleton and then fetch
 * `/api/signals` — a browser round trip that could not start until React had
 * hydrated. Every mutation now calls `router.refresh()`, which re-runs the
 * server read and leaves the current list on screen while it does, instead of
 * blanking to a skeleton on every archive.
 */
export function FeedScreen({
  signals,
  agenda,
}: {
  signals: IntelligenceSignal[];
  agenda: AgendaItem[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "reviewed">("active");
  const [addOpen, setAddOpen] = useState(false);
  const [previewSignal, setPreviewSignal] = useState<IntelligenceSignal | null>(null);

  async function handleArchive(id: string) {
    await fetch(`/api/signals/${id}`, { method: "PATCH" });
    router.refresh();
  }

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

      {addOpen && (
        <AddSignalModal
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            router.refresh();
          }}
        />
      )}
      {previewSignal?.thesis_id && (
        <ThesisPreviewDrawer thesisId={previewSignal.thesis_id} headline={previewSignal.headline} onClose={() => setPreviewSignal(null)} />
      )}
    </div>
  );
}
