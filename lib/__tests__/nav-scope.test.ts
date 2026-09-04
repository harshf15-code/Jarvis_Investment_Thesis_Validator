import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isPortfolioAware, withPortfolio } from "@/components/layout/nav-items";

const PF1 = "11111111-1111-4111-8111-111111111111";

/**
 * The nav has to carry the active book, because `pageScope` redirects a bare
 * portfolio-aware URL to the DEFAULT one. Without this, choosing "Mom" and then
 * clicking any nav icon silently put you back in your own money with nothing on
 * screen having said so — the exact confusion portfolios exist to remove.
 */
describe("withPortfolio", () => {
  it("scopes the screens that render one book", () => {
    expect(withPortfolio("/positions", PF1)).toBe(`/positions?portfolio=${PF1}`);
    expect(withPortfolio("/dashboard", PF1)).toBe(`/dashboard?portfolio=${PF1}`);
    expect(withPortfolio("/scratchpad", PF1)).toBe(`/scratchpad?portfolio=${PF1}`);
  });

  it("carries the roll-up too, not just a single book", () => {
    // `all` is a scope like any other, and losing it on a nav click would
    // silently narrow the view back to one book.
    expect(withPortfolio("/positions", "all")).toBe("/positions?portfolio=all");
  });

  it("leaves the screens that have no book alone", () => {
    for (const href of ["/thesis", "/feed", "/journal", "/discovery", "/settings"]) {
      expect(withPortfolio(href, PF1)).toBe(href);
    }
  });

  it("is a no-op when nothing is scoped yet", () => {
    // An unscoped page, or a link built before the URL has said anything.
    expect(withPortfolio("/positions", null)).toBe("/positions");
  });

  it("covers the sub-screens of a portfolio-aware path", () => {
    // /positions/council and /positions/import both call `pageScope`.
    expect(isPortfolioAware("/positions/council")).toBe(true);
    expect(isPortfolioAware("/positions/import")).toBe(true);
    // But not a path that merely starts with the same letters.
    expect(isPortfolioAware("/positions-archive")).toBe(false);
  });

  it("names only hrefs the nav actually has", () => {
    // Guards against a rename drifting the two lists apart: every aware path
    // that is a nav destination must still be in NAV_ITEMS.
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    for (const href of ["/dashboard", "/positions", "/scratchpad"]) {
      expect(hrefs.has(href)).toBe(true);
    }
  });
});
