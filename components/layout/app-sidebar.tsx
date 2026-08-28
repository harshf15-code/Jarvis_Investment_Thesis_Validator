"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NAV_ITEMS, activeNavItem } from "./nav-items";

/**
 * Left icon rail — the Stitch mock's `<aside class="w-20">`.
 *
 * Visible from `sm` (640px) up rather than the old `xl` (1280px): the previous
 * breakpoint meant a normal laptop window rendered the app with no navigation
 * at all. Below `sm`, `MobileNavBar` takes over.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const active = activeNavItem(pathname);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center gap-2 bg-surface-dim pt-20 pb-6 sm:flex">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive = active?.href === href;
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group relative flex size-12 items-center justify-center rounded-xl transition-all",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-on-surface-variant/70 hover:bg-white/5 hover:text-on-surface",
            )}
          >
            <Icon className="size-5" strokeWidth={2} />
            {/*
             * CSS-only tooltip. A rail of bare icons is unusable without labels,
             * and a JS popover library would be a dependency for one hover state.
             */}
            <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md bg-surface-container-highest px-2.5 py-1.5 text-xs font-medium text-on-surface shadow-panel group-hover:block">
              {label}
            </span>
          </Link>
        );
      })}
    </aside>
  );
}

/** Bottom bar for widths below `sm`, where the rail is hidden. */
export function MobileNavBar() {
  const pathname = usePathname();
  const active = activeNavItem(pathname);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto bg-surface-dim px-1 pt-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_0_rgba(255,255,255,0.05)] sm:hidden">
      {NAV_ITEMS.map(({ href, short, icon: Icon }) => {
        const isActive = active?.href === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-w-[4.25rem] flex-1 flex-col items-center gap-1 rounded-lg px-1 py-2 transition-colors",
              isActive ? "text-primary" : "text-on-surface-variant/60",
            )}
          >
            <Icon className="size-5" strokeWidth={2} />
            <span className="text-[9px] font-bold uppercase tracking-wide">{short}</span>
          </Link>
        );
      })}
    </nav>
  );
}
