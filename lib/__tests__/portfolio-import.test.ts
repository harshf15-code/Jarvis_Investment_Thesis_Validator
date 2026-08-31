import { describe, expect, it } from "vitest";

import {
  buildDraftRows,
  detectColumns,
  normalizeTicker,
  parseImportDate,
  repeatedTickerIndices,
  rowValidationError,
  type DraftImportRow,
} from "@/lib/portfolio-import";

const draft = (over: Partial<DraftImportRow> = {}): DraftImportRow => ({
  index: 0,
  ticker: "INFY",
  quantity: 10,
  averagePrice: 1500,
  date: null,
  ...over,
});

describe("detectColumns", () => {
  it("maps a Zerodha Kite Console holdings export", () => {
    const mapping = detectColumns(["Instrument", "Qty.", "Avg. cost", "LTP", "Cur. val", "P&L"]);
    expect(mapping).toEqual({ ticker: 0, quantity: 1, averagePrice: 2, date: null });
  });

  it("maps a Zerodha Console CSV with the longer column names", () => {
    const mapping = detectColumns([
      "Symbol", "ISIN", "Sector", "Quantity Available", "Quantity Pledged (Margin)",
      "Average Price", "Previous Closing Price", "Unrealized P&L",
    ]);
    expect(mapping.ticker).toBe(0);
    expect(mapping.quantity).toBe(3);
    expect(mapping.averagePrice).toBe(5);
  });

  it("does not mistake 'Previous Closing Price' for the average cost", () => {
    // The reason matching is exact rather than substring: a confidently wrong
    // mapping looks just as plausible in the preview as a right one.
    const mapping = detectColumns(["Symbol", "Quantity", "Previous Closing Price"]);
    expect(mapping.averagePrice).toBe(null);
  });

  it("leaves a header it does not recognise unmapped rather than guessing", () => {
    const mapping = detectColumns(["Col A", "Col B", "Col C"]);
    expect(mapping).toEqual({ ticker: null, quantity: null, averagePrice: null, date: null });
  });

  it("never claims one column for two fields", () => {
    // "Cost" is a synonym for average price, but if it were also reachable by
    // another key the trader would silently import quantity as a price.
    const mapping = detectColumns(["Symbol", "Cost"]);
    expect(mapping.ticker).toBe(0);
    expect(mapping.averagePrice).toBe(1);
    expect(mapping.quantity).toBe(null);
  });

  it("does not map a company-name column to the ticker", () => {
    // v1 has no name -> ticker resolver, so a name-only export must fail the
    // mapping step visibly instead of failing to resolve on every row.
    expect(detectColumns(["Stock Name", "Quantity", "Average buy price"]).ticker).toBe(null);
  });

  it("prefers a specific synonym over a loose one", () => {
    const mapping = detectColumns(["Ticker", "Qty", "Cost", "Average Price"]);
    expect(mapping.averagePrice).toBe(3);
  });
});

describe("normalizeTicker", () => {
  it("uppercases and trims", () => {
    expect(normalizeTicker("  infy ")).toBe("INFY");
  });
  it("strips an exchange prefix", () => {
    expect(normalizeTicker("NSE:INFY")).toBe("INFY");
    expect(normalizeTicker("nasdaq:aapl")).toBe("AAPL");
  });
  it("strips a Yahoo suffix", () => {
    expect(normalizeTicker("INFY.NS")).toBe("INFY");
    expect(normalizeTicker("500325.BO")).toBe("500325");
  });
  it("leaves a hyphenated ticker alone", () => {
    expect(normalizeTicker("BAJAJ-AUTO")).toBe("BAJAJ-AUTO");
  });
});

describe("parseImportDate", () => {
  it("reads an ISO date", () => {
    expect(parseImportDate("2026-03-04")).toBe("2026-03-04");
    expect(parseImportDate("2026-03-04T00:00:00Z")).toBe("2026-03-04");
  });

  it("reads a named month", () => {
    expect(parseImportDate("04-Mar-2026")).toBe("2026-03-04");
    expect(parseImportDate("4 March 2026")).toBe("2026-03-04");
  });

  it("refuses an ambiguous numeric date", () => {
    // 03/04/2026 is March 4th to a US export and April 3rd to an Indian one.
    // Falling back to the batch's stated "as of" date is honest; guessing is not.
    expect(parseImportDate("03/04/2026")).toBe(null);
    expect(parseImportDate("03-04-2026")).toBe(null);
  });

  it("returns null for junk", () => {
    expect(parseImportDate("")).toBe(null);
    expect(parseImportDate(undefined)).toBe(null);
    expect(parseImportDate("04-Xxx-2026")).toBe(null);
  });
});

describe("rowValidationError", () => {
  it("accepts a well-formed row", () => {
    expect(rowValidationError(draft())).toBe(null);
  });

  it("rejects a zero average cost, because the schema does", () => {
    // `entries` carries check (price > 0). Saying so here beats a failed
    // insert after the trader has already confirmed the batch.
    expect(rowValidationError(draft({ averagePrice: 0 }))).toMatch(/greater than zero/);
  });

  it("rejects a non-positive quantity", () => {
    expect(rowValidationError(draft({ quantity: 0 }))).toMatch(/greater than zero/);
    expect(rowValidationError(draft({ quantity: -5 }))).toMatch(/greater than zero/);
  });

  it("reports an unparseable number rather than treating it as zero", () => {
    expect(rowValidationError(draft({ quantity: null }))).toMatch(/not a number/);
    expect(rowValidationError(draft({ averagePrice: null }))).toMatch(/not a number/);
  });
});

describe("repeatedTickerIndices", () => {
  it("flags only the later occurrence", () => {
    expect([...repeatedTickerIndices(["INFY", "TCS", "INFY"])]).toEqual([2]);
  });
  it("is case-insensitive", () => {
    expect([...repeatedTickerIndices(["infy", "INFY"])]).toEqual([1]);
  });
  it("ignores empty tickers", () => {
    expect([...repeatedTickerIndices(["", "", "TCS"])]).toEqual([]);
  });
});

describe("buildDraftRows", () => {
  const mapping = { ticker: 0, quantity: 1, averagePrice: 2, date: null };

  it("reads the mapped columns and normalises the ticker", () => {
    expect(buildDraftRows([["nse:infy", "10", "1,500.25"]], mapping)).toEqual([
      { index: 0, ticker: "INFY", quantity: 10, averagePrice: 1500.25, date: null },
    ]);
  });

  it("drops a footer row with no ticker", () => {
    // Broker exports end with a totals line. It is not a holding the trader lost.
    const rows = [["INFY", "10", "1500"], ["", "", "15000"]];
    expect(buildDraftRows(rows, mapping)).toHaveLength(1);
  });

  it("keeps a row whose numbers do not parse, so the preview can explain why", () => {
    const [row] = buildDraftRows([["INFY", "N/A", "1500"]], mapping);
    expect(row.quantity).toBe(null);
    expect(rowValidationError(row)).toMatch(/not a number/);
  });

  it("tolerates a ragged row that is missing the price column", () => {
    const [row] = buildDraftRows([["INFY", "10"]], mapping);
    expect(row.averagePrice).toBe(null);
  });

  it("indexes rows by their position in the CSV body", () => {
    const rows = buildDraftRows([["A", "1", "1"], ["B", "1", "1"]], mapping);
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
  });
});
