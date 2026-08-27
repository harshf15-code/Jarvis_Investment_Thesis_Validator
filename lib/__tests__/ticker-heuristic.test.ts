import { describe, expect, it } from "vitest";
import { extractPossibleTicker } from "@/lib/ticker-heuristic";

describe("extractPossibleTicker", () => {
  it("finds a plain all-caps ticker token", () => {
    expect(extractPossibleTicker("AAPL looks cheap here")).toBe("AAPL");
  });

  it("finds a hyphenated ticker token", () => {
    expect(extractPossibleTicker("BAJAJ-AUTO — EV buyback at 26x looks cheap")).toBe(
      "BAJAJ-AUTO",
    );
  });

  it("returns null for pure macro text with no ticker-shaped token", () => {
    expect(
      extractPossibleTicker("I think Indian IT is bottoming due to AI tailwinds"),
    ).toBe(null);
  });

  it("ignores common short all-caps words that are not tickers", () => {
    expect(extractPossibleTicker("I think EV demand in the US is rising")).toBe(null);
  });

  it("returns null for empty input", () => {
    expect(extractPossibleTicker("")).toBe(null);
  });
});
