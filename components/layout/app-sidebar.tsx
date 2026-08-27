"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Wallet,
  FlaskConical,
  Radio,
  BookOpen,
  Compass,
  ListChecks,
  Plus,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useNewThesisDrawer } from "./new-thesis-context";

const NAV_ITEMS = [
  { href: "/", label: "Cockpit", icon: LayoutDashboard },
  { href: "/positions", label: "Active Positions", icon: Wallet },
  { href: "/thesis", label: "Stress Test & Plan", icon: FlaskConical },
  { href: "/feed", label: "Intelligence Feed", icon: Radio },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/discovery", label: "Discovery", icon: Compass },
  { href: "/recommendations", label: "Recommendation Tracker", icon: ListChecks },
] as const;

/** Persistent left sidebar, ≥1280px (spec Navigation rule). Hidden below that width — no mobile nav is in scope. */
export function AppSidebar() {
  const pathname = usePathname();
  const { open } = useNewThesisDrawer();

  return (
    <nav className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-1 bg-surface-container-lowest px-3 py-6 xl:flex">
      <div className="mb-6 px-3 font-display text-lg font-semibold text-on-surface">
        Jarvis
      </div>

      <button
        type="button"
        onClick={() => open()}
        className="mb-4 flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
      >
        <Plus className="size-4" />
        New Thesis
      </button>

      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
              active
                ? "bg-surface-container-high text-primary"
                : "text-on-surface/70 hover:bg-surface-container-low hover:text-on-surface",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
