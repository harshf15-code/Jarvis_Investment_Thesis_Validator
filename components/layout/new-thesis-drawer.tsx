"use client";

import { X } from "lucide-react";
import { useNewThesisDrawer } from "./new-thesis-context";
import { ThesisInputForm } from "@/components/thesis/thesis-input-form";

/** Slide-out from the right, per spec's recommended pattern — renders Screen 1 inline so the user never loses their current page context. */
export function NewThesisDrawer() {
  const { isOpen, close, prefillTicker } = useNewThesisDrawer();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-surface-container-low p-6 shadow-ambient">
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 rounded-full p-1.5 text-on-surface/60 hover:text-on-surface"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
        <ThesisInputForm prefillTicker={prefillTicker} onSaved={close} />
      </div>
    </div>
  );
}
