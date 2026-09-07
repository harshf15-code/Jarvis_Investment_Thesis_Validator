import { describe, expect, it } from "vitest";

import {
  assignColumn,
  buildDraftRows,
  buildTypedRows,
  detectColumns,
  latestAllowedDate,
  localToday,
  normalizeTicker,
  parseImportDate,
  repeatedTickerIndices,
  rowValidationError,
  type DraftImportRow,
  type TypedHoldingEntry,
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

  it("refuses a day that does not exist", () => {
    // A shape check alone lets these through, and a date Postgres will refuse
    // is one the preview has to refuse first — otherwise the row looks
    // importable right up until it 500s the commit.
    expect(parseImportDate("2026-02-31")).toBe(null);
    expect(parseImportDate("31-Apr-2026")).toBe(null);
    expect(parseImportDate("2026-13-01")).toBe(null);
  });

  it("accepts a real leap day and refuses a fake one", () => {
    expect(parseImportDate("2024-02-29")).toBe("2024-02-29");
    expect(parseImportDate("2026-02-29")).toBe(null);
  });
});

describe("localToday", () => {
  it("answers in the viewer's calendar, not UTC", () => {
    // 8:30pm on 31 Aug in New York is already 1 Sep in UTC. Defaulting the
    // "held since" field to UTC would stamp a cost basis with tomorrow's date.
    const evening = new Date(2026, 7, 31, 20, 30);
    expect(localToday(evening)).toBe("2026-08-31");
  });

  it("pads single-digit months and days", () => {
    expect(localToday(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("assignColumn", () => {
  const base = { ticker: 0, quantity: 1, averagePrice: 2, date: null };

  it("takes a column away from the field that held it", () => {
    // Otherwise a trader can point both quantity and average cost at the same
    // column and import a cost basis equal to the share count — a row that
    // passes every validation and is simply wrong.
    const next = assignColumn(base, "averagePrice", 1);
    expect(next.averagePrice).toBe(1);
    expect(next.quantity).toBe(null);
  });

  it("clears a field without disturbing the others", () => {
    expect(assignColumn(base, "quantity", null)).toEqual({ ...base, quantity: null });
  });

  it("is a no-op when a field is reassigned to the column it already had", () => {
    expect(assignColumn(base, "ticker", 0)).toEqual(base);
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

  it("rejects a purchase date past the allowed bound", () => {
    // A cost basis dated in the future makes every return on the Cockpit
    // nonsense, and the typed form puts next year one click away.
    const past = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect(rowValidationError(draft({ date: past }))).toMatch(/future/);
  });

  it("accepts today, and the one day of slack the bound allows", () => {
    // The browser sends the trader's LOCAL calendar date and this runs in UTC.
    // In Auckland those are routinely different days, and that gap is not the
    // mistake the check is for.
    expect(rowValidationError(draft({ date: localToday() }))).toBe(null);
    expect(rowValidationError(draft({ date: latestAllowedDate() }))).toBe(null);
  });

  it("accepts a row with no date at all", () => {
    expect(rowValidationError(draft({ date: null }))).toBe(null);
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


describe("buildTypedRows", () => {
  const typed = (over: Partial<TypedHoldingEntry> = {}): TypedHoldingEntry => ({
    ticker: "",
    quantity: "",
    averagePrice: "",
    date: "",
    ...over,
  });

  it("drops a row only when every field is blank", () => {
    const rows = buildTypedRows([
      typed({ ticker: "INFY", quantity: "10", averagePrice: "1500" }),
      typed(),
      typed({ ticker: "TCS", quantity: "5", averagePrice: "3800" }),
    ]);
    expect(rows.map((r) => r.ticker)).toEqual(["INFY", "TCS"]);
  });

  it("keeps a row that has numbers but no ticker, so it can be told what is missing", () => {
    // The CSV builder drops these — in a broker file they are a total line. A
    // typed one is a person who tabbed past a field, and silently discarding
    // their row is the one outcome they cannot debug.
    const rows = buildTypedRows([typed({ quantity: "10", averagePrice: "1500" })]);
    expect(rows).toHaveLength(1);
    expect(rowValidationError(rows[0])).toMatch(/No ticker/);
  });

  it("keeps the index of the row the trader is looking at, gaps and all", () => {
    const rows = buildTypedRows([
      typed(),
      typed({ ticker: "INFY", quantity: "10", averagePrice: "1500" }),
    ]);
    expect(rows[0].index).toBe(1);
  });

  it("normalises a pasted ticker exactly as the CSV path does", () => {
    const rows = buildTypedRows([
      typed({ ticker: " nse:infy ", quantity: "1", averagePrice: "1" }),
      typed({ ticker: "INFY.NS", quantity: "1", averagePrice: "1" }),
    ]);
    expect(rows.map((r) => r.ticker)).toEqual(["INFY", "INFY"]);
  });

  it("reads an unambiguous date and refuses an ambiguous one", () => {
    const [iso, named, slashed] = buildTypedRows([
      typed({ ticker: "A", date: "2026-03-04" }),
      typed({ ticker: "B", date: "4 March 2026" }),
      // March 4th to an American export, April 3rd to an Indian one.
      typed({ ticker: "C", date: "03/04/2026" }),
    ]);
    expect(iso.date).toBe("2026-03-04");
    expect(named.date).toBe("2026-03-04");
    expect(slashed.date).toBe(null);
  });

  it("reports an unparseable quantity rather than dropping the row", () => {
    const [row] = buildTypedRows([typed({ ticker: "INFY", quantity: "ten", averagePrice: "1500" })]);
    expect(rowValidationError(row)).toMatch(/not a number/);
  });
});
