"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";

import { COUNCIL_CONSULT_MIN, COUNCIL_ROSTER_MAX } from "@/lib/jarvis-council";
import { cn } from "@/lib/utils";
import type { CouncilMember } from "@/lib/types";
import { CouncilDisclaimer } from "./disclaimer";

type Draft = { name: string; philosophy: string };

const EMPTY: Draft = { name: "", philosophy: "" };

/**
 * The Investment Council roster — the one place members are managed, so adding
 * a voice never means interrupting a thesis that is mid-analysis.
 *
 * Built-ins are ordinary rows the trader owns: editable, and deletable. The cap
 * is 7 TOTAL, so anything else would mean a trader who wants four voices of
 * their own is stuck with three they did not choose.
 */
export function CouncilRoster({ initialMembers }: { initialMembers: CouncilMember[] }) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  /** `"new"` while adding, a member id while editing, null when neither. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const full = members.length >= COUNCIL_ROSTER_MAX;

  function openAdd() {
    setEditing("new");
    setDraft(EMPTY);
    setError(null);
  }

  function openEdit(m: CouncilMember) {
    setEditing(m.id);
    setDraft({ name: m.name, philosophy: m.philosophy });
    setError(null);
  }

  function close() {
    setEditing(null);
    setDraft(EMPTY);
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const isNew = editing === "new";
      const res = await fetch(isNew ? "/api/council/members" : `/api/council/members/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save this member.");
      setMembers((prev) =>
        isNew
          ? [...prev, body.member]
          : prev.map((m) => (m.id === body.member.id ? body.member : m)),
      );
      close();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: CouncilMember) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/council/members/${m.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not remove this member.");
      }
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
      if (editing === m.id) close();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const valid = draft.name.trim().length > 0 && draft.philosophy.trim().length >= 40;

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
          Investment Council
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-on-surface-variant">
          A panel you convene on a finished memorandum to pressure-test it. Keep up to{" "}
          {COUNCIL_ROSTER_MAX} members here and pick at least {COUNCIL_CONSULT_MIN} of them at
          consult time.
        </p>
        <CouncilDisclaimer className="mt-2 max-w-2xl" />
      </div>

      {error && (
        <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>
      )}

      <ul className="flex flex-col gap-3">
        {members.map((m) => (
          <li key={m.id} className="glass-panel rounded-lg p-4">
            {editing === m.id ? (
              <MemberForm
                draft={draft}
                setDraft={setDraft}
                onSave={save}
                onCancel={close}
                busy={busy}
                valid={valid}
                saveLabel="Save changes"
              />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-display text-sm font-extrabold tracking-tight text-on-surface">
                    {m.name}
                    {m.source === "builtin" && (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[9px] tracking-widest text-on-surface-variant/60 uppercase">
                        Built-in
                      </span>
                    )}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">
                    {m.philosophy}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(m)}
                    disabled={busy}
                    aria-label={`Edit ${m.name}`}
                    className="rounded-full bg-white/5 p-2 text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(m)}
                    disabled={busy}
                    aria-label={`Remove ${m.name}`}
                    className="rounded-full bg-white/5 p-2 text-on-surface-variant transition-colors hover:bg-error-container hover:text-error disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editing === "new" ? (
        <div className="glass-panel rounded-lg p-4">
          <MemberForm
            draft={draft}
            setDraft={setDraft}
            onSave={save}
            onCancel={close}
            busy={busy}
            valid={valid}
            saveLabel="Add member"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={openAdd}
            disabled={full || busy}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-display text-xs font-extrabold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
          >
            <Plus className="size-3.5" strokeWidth={3} />
            Add member
          </button>
          <span className="text-xs text-on-surface-variant">
            {full
              ? `Roster full at ${COUNCIL_ROSTER_MAX} — remove a member to add another.`
              : `${members.length} of ${COUNCIL_ROSTER_MAX} used.`}
          </span>
        </div>
      )}

      {members.length < COUNCIL_CONSULT_MIN && (
        <p className="rounded-lg bg-status-blue-container px-4 py-3 text-xs text-status-blue">
          A consult needs at least {COUNCIL_CONSULT_MIN} members. Add{" "}
          {COUNCIL_CONSULT_MIN - members.length} more to be able to convene the Council.
        </p>
      )}
    </section>
  );
}

function MemberForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  busy,
  valid,
  saveLabel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  valid: boolean;
  saveLabel: string;
}) {
  const chars = draft.philosophy.trim().length;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
          Name *
        </span>
        <input
          type="text"
          value={draft.name}
          maxLength={60}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. The Short Seller"
          className="sunken rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
          Investing philosophy *
        </span>
        <textarea
          value={draft.philosophy}
          rows={4}
          maxLength={600}
          onChange={(e) => setDraft({ ...draft, philosophy: e.target.value })}
          placeholder="2–4 sentences on how this member thinks: what they look for, what they refuse to own, what makes them cut."
          className="sunken resize-none rounded-lg px-3 py-2.5 text-sm leading-relaxed text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        {/*
         * A name alone gives the model nothing to imitate, which is why the
         * floor is a real constraint rather than a nicety — and why it is shown
         * before the save is attempted rather than as a server error after.
         */}
        <span
          className={cn(
            "font-mono text-[10px]",
            chars < 40 ? "text-on-surface-variant/50" : "text-on-surface-variant/70",
          )}
        >
          {chars < 40 ? `${40 - chars} more characters needed` : `${chars}/600`}
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!valid || busy}
          className="rounded-full bg-primary px-5 py-2 font-display text-xs font-extrabold tracking-tight text-on-primary transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40"
        >
          {busy ? "Saving…" : saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-full bg-white/5 px-4 py-2 text-xs font-bold text-on-surface/80 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          <X className="size-3" />
          Cancel
        </button>
      </div>
    </div>
  );
}
