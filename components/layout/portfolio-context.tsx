"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ALL_PORTFOLIOS } from "@/lib/portfolio/scope";
import type { Portfolio } from "@/lib/types";

/**
 * Which book the app is showing, and the list to switch between.
 *
 * THE URL IS THE STATE. `?portfolio=<uuid>` (or `?portfolio=all`) is read from
 * `useSearchParams`, and switching books pushes a new URL rather than setting a
 * variable. Nothing is remembered in `localStorage` and nothing is stored in a
 * cookie.
 *
 * That is a deliberate choice and not a shortcut. Three screens — `/positions`,
 * `/positions/council` and `/scratchpad` — are server components that query
 * Supabase directly (see `lib/queries.ts` for why they must not self-fetch), so
 * they can only learn the active book from something the server can read. A
 * remembered "last portfolio" would also be exactly the ambient state this
 * feature exists to remove: a mis-scoped read here shows one person's money as
 * another's, and the address bar naming the book is the cheapest possible
 * defence against that going unnoticed.
 *
 * The list itself is fetched once. It is at most five short rows, and every
 * screen's header needs it.
 */

type PortfolioContextValue = {
  portfolios: Portfolio[];
  /** The book on screen, or null in the roll-up and while the list is loading. */
  active: Portfolio | null;
  mode: "one" | "all";
  loading: boolean;
  error: string | null;
  /** Re-reads the list after a create, rename or delete. */
  refresh: () => Promise<void>;
  /** Navigates to the same page showing a different book. */
  select: (id: string) => void;
};

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const param = searchParams.get("portfolio");

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to re-read the list after a create, rename or delete. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/portfolios");
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Could not load your portfolios.");
        setPortfolios(body.portfolios ?? []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Async so callers can `await` it and carry on in order. It resolves when the
  // re-read has been REQUESTED, not when it has landed — which is all a caller
  // needs: the list re-renders on its own when the rows arrive.
  const refresh = useCallback(async () => {
    setReloadKey((k) => k + 1);
  }, []);

  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("portfolio", id);
      // Cursors and filters belong to the book that was on screen; carrying
      // them into a different one would page through the wrong history.
      next.delete("before");
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const value = useMemo<PortfolioContextValue>(() => {
    const mode = param === ALL_PORTFOLIOS ? "all" : "one";
    return {
      portfolios,
      active: mode === "all" ? null : (portfolios.find((p) => p.id === param) ?? null),
      mode,
      loading,
      error,
      refresh,
      select,
    };
  }, [portfolios, param, loading, error, refresh, select]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

/**
 * Consumed by the header switcher and by every write that has to ask which book.
 *
 * Throws outside the provider rather than defaulting to "no portfolios": a
 * silent empty list here would render a picker with nothing in it and no
 * explanation, which is worse than a stack trace in development.
 */
export function usePortfolios(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error("usePortfolios must be used within PortfolioProvider");
  }
  return ctx;
}
