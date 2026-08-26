import { describe, expect, it } from "vitest";

import {
  buildJarvisUserContext,
  JARVIS_SYSTEM_PROMPT,
} from "@/lib/jarvis-prompt";

describe("JARVIS_SYSTEM_PROMPT", () => {
  it("contains all 5 exact section headers in order", () => {
    const headers = [
      "## Thesis Structuring",
      "## Stress Test",
      "## Trade Plan",
      "## Risk Awareness",
      "## Exit Discipline",
    ];
    let searchFrom = 0;
    for (const header of headers) {
      const idx = JARVIS_SYSTEM_PROMPT.indexOf(header, searchFrom);
      expect(idx).toBeGreaterThanOrEqual(0);
      searchFrom = idx + header.length;
    }
  });

  it("instructs a single trailing ```json fenced block", () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain("```json");
  });
});

describe("buildJarvisUserContext", () => {
  const baseInput = {
    yahooSymbol: "RELIANCE.NS",
    exchange: "NSE",
    price: 2500.5,
    priceAsOf: new Date("2026-08-27T10:00:00.000Z"),
    ohlcv: Array.from({ length: 35 }, (_, i) => ({
      time: `2026-07-${String(i + 1).padStart(2, "0")}`,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000 + i,
    })),
    fundamentals: { trailingPE: 22.5, marketCap: 1000000 },
  };

  it("includes the ticker/exchange header and current price + as-of", () => {
    const result = buildJarvisUserContext(baseInput);
    expect(result).toContain("RELIANCE.NS");
    expect(result).toContain("NSE");
    expect(result).toContain("2500.5");
    expect(result).toContain("2026-08-27T10:00:00.000Z");
  });

  it("includes only the last 30 OHLCV entries as a plain text table", () => {
    const result = buildJarvisUserContext(baseInput);

    // Oldest 5 bars (indices 0-4, days 01-05) should be dropped.
    expect(result).not.toContain("2026-07-01: O=100");
    expect(result).not.toContain("2026-07-05: O=104");

    // The most recent 30 bars (days 06-35) should be present.
    expect(result).toContain(
      "2026-07-06: O=105 H=110 L=100 C=107 V=1005",
    );
    const last = baseInput.ohlcv[baseInput.ohlcv.length - 1];
    expect(result).toContain(
      `${last.time}: O=${last.open} H=${last.high} L=${last.low} C=${last.close} V=${last.volume}`,
    );

    const lineCount = result
      .split("\n")
      .filter((line) => /^2026-07-\d{2}: O=/.test(line)).length;
    expect(lineCount).toBe(30);
  });

  it("lists each fundamentals key/value under a Fundamentals: section", () => {
    const result = buildJarvisUserContext(baseInput);
    expect(result).toContain("Fundamentals:");
    expect(result).toContain("trailingPE: 22.5");
    expect(result).toContain("marketCap: 1000000");
  });

  it("omits the User-tracked metrics section when customFundamentals is absent or empty", () => {
    const resultAbsent = buildJarvisUserContext(baseInput);
    expect(resultAbsent).not.toContain("User-tracked metrics:");

    const resultEmpty = buildJarvisUserContext({
      ...baseInput,
      customFundamentals: {},
    });
    expect(resultEmpty).not.toContain("User-tracked metrics:");
  });

  it("appends a User-tracked metrics section when customFundamentals is non-empty", () => {
    const result = buildJarvisUserContext({
      ...baseInput,
      customFundamentals: { "my custom moat score": "8/10" },
    });
    expect(result).toContain("User-tracked metrics:");
    expect(result).toContain("my custom moat score: 8/10");
  });

  it("ends with the exact closing instruction sentence", () => {
    const result = buildJarvisUserContext(baseInput);
    expect(result).toContain(
      "Analyze this stock following your standard workflow. This is either a fresh " +
        "idea or a re-assessment of an existing position -- treat the current price/fundamentals as " +
        "your starting point for the thesis.",
    );
  });

  it("handles an empty ohlcv array without throwing", () => {
    expect(() =>
      buildJarvisUserContext({ ...baseInput, ohlcv: [] }),
    ).not.toThrow();
    const result = buildJarvisUserContext({ ...baseInput, ohlcv: [] });
    expect(result).toContain("(no price history available)");
  });

  it("handles empty fundamentals without throwing", () => {
    const result = buildJarvisUserContext({ ...baseInput, fundamentals: {} });
    expect(result).toContain("(none available)");
  });
});
