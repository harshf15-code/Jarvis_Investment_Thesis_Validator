import { describe, expect, it } from "vitest";

import { formatCurrency } from "@/lib/format";

describe("formatCurrency", () => {
  it("formats USD", () => {
    expect(formatCurrency(190.5, "USD")).toBe("$190.50");
  });

  it("formats INR, grouped the Indian way", () => {
    // The reason locale is looked up per currency rather than hardcoded:
    // en-US would render this 1,000,000.00.
    expect(formatCurrency(1000000, "INR")).toBe("₹10,00,000.00");
  });

  it("rounds to a maximum of two fraction digits", () => {
    expect(formatCurrency(99.999, "USD")).toBe("$100.00");
  });

  it("renders a currency whose market is not selectable yet", () => {
    // CN is `live: false`, but its locale is still in MARKETS, so a `stocks`
    // row carrying CNY formats the way China would write it (¥, not CN¥).
    expect(formatCurrency(6052, "CNY")).toBe("¥6,052.00");
  });

  it("renders a currency no market claims at all", () => {
    // The fallback is en-US digit grouping, NOT a fallback currency: the
    // symbol and minor units still come from the code itself, so an
    // unrecognised currency is never silently relabelled as dollars.
    // `Intl` separates a code-style symbol with a NON-BREAKING space, so this
    // normalises rather than pasting an invisible character into the assertion.
    expect(formatCurrency(6052, "SGD").replace(/\u00a0/g, " ")).toBe("SGD 6,052.00");
  });

  it("is case-insensitive about the currency code", () => {
    expect(formatCurrency(2500, "inr")).toBe("₹2,500.00");
  });
});
