"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";

import { Logo } from "./logo";
import { LogoutButton } from "./logout-button";
import { activeNavItem } from "./nav-items";
import { useNewThesisDrawer } from "./new-thesis-context";
import { PortfolioSwitcher } from "./portfolio-switcher";

/**
 * Fixed top chrome — the Stitch mock's `<header class="h-16">`. Carries the
 * wordmark, the current section's name (so the icon rail never leaves you
 * guessing where you are), WHICH BOOK is on screen, the one global action, and
 * who you are signed in as — which matters now that the same URL serves more
 * than one account.
 *
 * The portfolio switcher sits here rather than on any one screen because it
 * governs four of them. On mobile the section label gives way to it: "which
 * book" is worth more than "which screen" when the icon rail already answers
 * the second.
 */
export function AppHeader({ email }: { email: string | null }) {
  const pathname = usePathname();
  const { open } = useNewThesisDrawer();
  const active = activeNavItem(pathname);

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between bg-surface-dim px-4 shadow-[0_1px_0_0_rgba(255,255,255,0.05)] sm:px-6">
      <div className="flex items-baseline gap-4 sm:gap-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Logo className="size-7 shrink-0 sm:size-8" />
          <span className="font-display text-xl font-extrabold tracking-tighter text-on-surface sm:text-2xl">
            JARVIS
          </span>
        </Link>
        {active && (
          <span className="hidden font-display text-xs font-bold uppercase tracking-widest text-on-surface-variant sm:inline">
            {active.label}
          </span>
        )}
        <PortfolioSwitcher />
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => open()}
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-bold tracking-tight text-on-primary transition-all hover:bg-primary-dim active:scale-[0.97] sm:px-5 sm:text-sm"
        >
          <Plus className="size-4" strokeWidth={2.5} />
          New Thesis
        </button>
        {email ? (
          <span
            title={email}
            className="hidden max-w-[16ch] truncate text-xs text-on-surface-variant sm:inline"
          >
            {email}
          </span>
        ) : null}
        <LogoutButton />
      </div>
    </header>
  );
}
