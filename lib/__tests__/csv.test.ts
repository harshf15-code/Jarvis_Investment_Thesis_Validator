import { describe, expect, it } from "vitest";

import { parseCsv, parseNumber } from "@/lib/csv";

describe("parseCsv", () => {
  it("reads a plain header and rows", () => {
    const { headers, rows } = parseCsv("Symbol,Qty,Price\nINFY,10,1500\nTCS,5,3200\n");
    expect(headers).toEqual(["Symbol", "Qty", "Price"]);
    expect(rows).toEqual([
      ["INFY", "10", "1500"],
      ["TCS", "5", "3200"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    // The case that makes split(",") wrong: nearly every broker export has a
    // company-name column, and company names contain commas.
    const { rows } = parseCsv('Symbol,Name\nMMM,"3M Company, Inc."\n');
    expect(rows[0]).toEqual(["MMM", "3M Company, Inc."]);
  });

  it('reads "" inside a quoted field as one literal quote', () => {
    const { rows } = parseCsv('Symbol,Name\nX,"The ""Big"" One"\n');
    expect(rows[0]).toEqual(["X", 'The "Big" One']);
  });

  it("keeps a newline inside a quoted field", () => {
    const { rows } = parseCsv('Symbol,Note\nA,"line one\nline two"\nB,plain\n');
    expect(rows).toEqual([
      ["A", "line one\nline two"],
      ["B", "plain"],
    ]);
  });

  it("handles CRLF line endings", () => {
    const { headers, rows } = parseCsv("Symbol,Qty\r\nINFY,10\r\nTCS,5\r\n");
    expect(headers).toEqual(["Symbol", "Qty"]);
    expect(rows).toEqual([
      ["INFY", "10"],
      ["TCS", "5"],
    ]);
  });

  it("strips a UTF-8 BOM from the first header", () => {
    // Excel writes one. Without stripping it the first column never matches a
    // header synonym and the mapping silently comes up empty.
    const { headers } = parseCsv("﻿Symbol,Qty\nINFY,10\n");
    expect(headers[0]).toBe("Symbol");
  });

  it("does not invent a trailing row for a file that ends in a newline", () => {
    expect(parseCsv("A,B\n1,2\n").rows).toHaveLength(1);
  });

  it("keeps the last row of a file with no trailing newline", () => {
    expect(parseCsv("A,B\n1,2").rows).toEqual([["1", "2"]]);
  });

  it("preserves a ragged row rather than padding it", () => {
    // Padding would turn a missing price into an empty string, which parses as
    // "no number" anyway -- but the caller can say WHICH column is missing
    // only if the row's real length survives.
    expect(parseCsv("A,B,C\n1,2\n").rows).toEqual([["1", "2"]]);
  });

  it("keeps an empty quoted field", () => {
    expect(parseCsv('A,B\n"",2\n').rows).toEqual([["", "2"]]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("A,B\n\n1,2\n\n").rows).toEqual([["1", "2"]]);
  });

  it("returns empty headers for an empty file", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("parseNumber", () => {
  it("reads a plain number", () => {
    expect(parseNumber("1500")).toBe(1500);
    expect(parseNumber("1500.25")).toBe(1500.25);
  });

  it("strips thousands separators in both western and Indian grouping", () => {
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("12,34,567")).toBe(1234567);
  });

  it("strips currency symbols and whitespace", () => {
    expect(parseNumber(" ₹1,00,000.50 ")).toBe(100000.5);
    expect(parseNumber("$1,234")).toBe(1234);
  });

  it("returns null for anything that is not a number", () => {
    expect(parseNumber("")).toBe(null);
    expect(parseNumber("   ")).toBe(null);
    expect(parseNumber("-")).toBe(null);
    expect(parseNumber("N/A")).toBe(null);
    expect(parseNumber(undefined)).toBe(null);
  });

  it("keeps a negative sign", () => {
    expect(parseNumber("-12.5")).toBe(-12.5);
  });
});
