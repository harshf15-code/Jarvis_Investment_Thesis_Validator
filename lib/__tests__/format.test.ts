import { describe, expect, it } from "vitest";

import { formatCurrency } from "@/lib/format";

describe("formatCurrency", () => {
  it("formats a US-exchange value as USD", () => {
    expect(formatCurrency(190.5, "US")).toBe("$190.50");
  });

  it("formats an NSE-exchange value as INR", () => {
    expect(formatCurrency(2500, "NSE")).toBe("₹2,500.00");
  });

  it("formats a BSE-exchange value as INR", () => {
    expect(formatCurrency(1234.567, "BSE")).toBe("₹1,234.57");
  });

  it("rounds to a maximum of two fraction digits", () => {
    expect(formatCurrency(99.999, "US")).toBe("$100.00");
  });
});
