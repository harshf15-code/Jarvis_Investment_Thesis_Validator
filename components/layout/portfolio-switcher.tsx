"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Layers, Settings2 } from "lucide-react";

import { ManagePortfoliosDialog } from "@/components/portfolio/manage-portfolios-dialog";
import { OwnershipBadge } from "@/components/portfolio/ownership-badge";
import { usePortfolios } from "@/components/layout/portfolio-context";
import { ALL_PORTFOLIOS } from "@/lib/portfolio/scope";

/**
 * Which book you are looking at, and how to look at another.
 *
 * In the header rather than the sidebar because it governs the Cockpit,
 * Positions, the Scratchpad and the Council alike — a control that changes four
 * screens belongs to the chrome they share, not to any one of them.
 */
export function PortfolioSwitcher() {
  const { portfolios, active, mode, loading, select } = usePortfolios();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Nothing to switch between, and nothing to say. Rendering a disabled control
  // that reads "loading" on every page load would be noise on the one piece of
  // chrome that has to stay readable.
  if (loading && portfolios.length === 0) return null;

  const label = mode === "all" ? "All portfolios" : (active?.name ?? "Portfolio");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-[46vw] items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-on-surface transition-colors hover:bg-white/10 sm:max-w-none"
      >
        {mode === "all" && <Layers className="size-3.5 shrink-0 text-on-surface-variant" aria-hidden />}
        <span className="truncate font-medium">{label}</span>
        {active && <OwnershipBadge portfolio={active} />}
        <ChevronDown className="size-3.5 shrink-0 text-on-surface-variant" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl bg-surface-container-low py-1 shadow-ambient"
        >
          {portfolios.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={active?.id === p.id}
              onClick={() => {
                setOpen(false);
                select(p.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
            >
              <Check
                className={`size-3.5 shrink-0 ${active?.id === p.id ? "text-primary" : "invisible"}`}
                aria-hidden
              />
              <span className="flex-1 truncate text-on-surface">{p.name}</span>
              <OwnershipBadge portfolio={p} />
              <span className="shrink-0 font-mono text-[10px] text-on-surface-variant">
                {p.base_currency}
              </span>
            </button>
          ))}

          {/* Offered only when there is more than one book. A roll-up of one is
              the book itself, and a second way to see the same thing is a way
              to wonder whether it is the same thing. */}
          {portfolios.length > 1 && (
            <button
              type="button"
              role="option"
              aria-selected={mode === "all"}
              onClick={() => {
                setOpen(false);
                select(ALL_PORTFOLIOS);
              }}
              className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
            >
              <Check
                className={`size-3.5 shrink-0 ${mode === "all" ? "text-primary" : "invisible"}`}
                aria-hidden
              />
              <Layers className="size-3.5 shrink-0 text-on-surface-variant" aria-hidden />
              <span className="flex-1 text-on-surface">All portfolios</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setManaging(true);
            }}
            className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2 text-left text-xs text-on-surface-variant transition-colors hover:bg-white/5 hover:text-on-surface"
          >
            <Settings2 className="size-3.5 shrink-0" aria-hidden />
            Manage portfolios
          </button>
        </div>
      )}

      {managing && <ManagePortfoliosDialog onClose={() => setManaging(false)} />}
    </div>
  );
}
