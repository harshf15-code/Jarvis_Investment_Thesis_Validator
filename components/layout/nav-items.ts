import {
  BookOpen,
  Compass,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  NotebookPen,
  Radio,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  /** Full name — icon-rail tooltip, mobile sheet, and the header's page title. */
  label: string;
  /** Terse form for the mobile bottom bar, where ~9 chars is the budget. */
  short: string;
  icon: LucideIcon;
};

/**
 * Single source of truth for navigation, shared by the icon rail, the header's
 * page title, and the mobile bar — previously each would have had to re-declare
 * the list and drift apart.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Cockpit", short: "Cockpit", icon: LayoutDashboard },
  { href: "/positions", label: "Active Positions", short: "Positions", icon: Wallet },
  { href: "/thesis", label: "Stress Test & Plan", short: "Thesis", icon: FlaskConical },
  { href: "/feed", label: "Intelligence Feed", short: "Feed", icon: Radio },
  { href: "/journal", label: "Journal", short: "Journal", icon: BookOpen },
  { href: "/discovery", label: "Discovery", short: "Discover", icon: Compass },
  { href: "/recommendations", label: "Recommendation Tracker", short: "Tracker", icon: ListChecks },
  { href: "/scratchpad", label: "Scratchpad", short: "Notes", icon: NotebookPen },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings },
];

/** Longest-prefix match, so `/thesis/<id>/plan` still highlights "Stress Test & Plan". */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}
