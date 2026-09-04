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

/**
 * The screens that render one book, and therefore have to be told which.
 *
 * Every one of these calls `pageScope`, which redirects a URL with no
 * `?portfolio=` to the trader's DEFAULT book. That redirect is right for
 * someone arriving with no opinion and wrong for someone who has just chosen a
 * book — following a bare nav link out of "Mom" and back into your own money,
 * with no warning and nothing on screen having said so, is the exact confusion
 * this whole feature exists to remove. So the links carry the scope.
 *
 * Prefix-matched, so `/positions/council` and `/positions/import` are covered
 * by `/positions`.
 */
const PORTFOLIO_AWARE = ["/dashboard", "/positions", "/scratchpad"];

export function isPortfolioAware(href: string): boolean {
  return PORTFOLIO_AWARE.some((path) => href === path || href.startsWith(`${path}/`));
}

/**
 * `href` with the active scope on it, or unchanged when it does not take one.
 *
 * `param` is the raw `?portfolio=` value rather than a resolved book, so the
 * roll-up (`all`) survives a nav click too, and so a link built before the
 * portfolio list has loaded still carries what the URL already said.
 */
export function withPortfolio(href: string, param: string | null): string {
  if (!param || !isPortfolioAware(href)) return href;
  return `${href}?portfolio=${encodeURIComponent(param)}`;
}

/** Longest-prefix match, so `/thesis/<id>/plan` still highlights "Stress Test & Plan". */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}
