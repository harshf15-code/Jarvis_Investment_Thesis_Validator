import { describe, expect, it } from "vitest";

import { AddTickerInputSchema, UpdateStockInputSchema } from "@/lib/validation/schemas";

describe("AddTickerInputSchema", () => {
  it("passes for a valid watchlist input", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "AAPL",
      exchange: "US",
      type: "watchlist",
    });

    expect(result.success).toBe(true);
  });

  it("passes for a valid holding input with all holding fields", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "RELIANCE",
      exchange: "NSE",
      type: "holding",
      shares: 10,
      cost_basis: 2500.5,
      date_acquired: "2024-01-15",
    });

    expect(result.success).toBe(true);
  });

  it("fails for a holding input missing shares", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "RELIANCE",
      exchange: "NSE",
      type: "holding",
      cost_basis: 2500.5,
      date_acquired: "2024-01-15",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("shares");
    }
  });

  it("fails for a holding input missing cost_basis", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "RELIANCE",
      exchange: "NSE",
      type: "holding",
      shares: 10,
      date_acquired: "2024-01-15",
    });

    expect(result.success).toBe(false);
  });

  it("fails for a holding input missing date_acquired", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "RELIANCE",
      exchange: "NSE",
      type: "holding",
      shares: 10,
      cost_basis: 2500.5,
    });

    expect(result.success).toBe(false);
  });

  it("fails for an invalid exchange value", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "AAPL",
      exchange: "NYSE",
      type: "watchlist",
    });

    expect(result.success).toBe(false);
  });

  it("fails for a non-positive shares value on a holding", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "AAPL",
      exchange: "US",
      type: "holding",
      shares: 0,
      cost_basis: 100,
      date_acquired: "2024-01-15",
    });

    expect(result.success).toBe(false);
  });

  it("fails for an empty ticker", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "   ",
      exchange: "US",
      type: "watchlist",
    });

    expect(result.success).toBe(false);
  });

  it("fails for a malformed date_acquired", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "AAPL",
      exchange: "US",
      type: "holding",
      shares: 1,
      cost_basis: 1,
      date_acquired: "not-a-date",
    });

    expect(result.success).toBe(false);
  });

  it("fails for an unrecognized type value", () => {
    const result = AddTickerInputSchema.safeParse({
      ticker: "AAPL",
      exchange: "US",
      type: "portfolio",
    });

    expect(result.success).toBe(false);
  });
});

describe("UpdateStockInputSchema", () => {
  it("passes for an empty object (no-op partial update)", () => {
    const result = UpdateStockInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("passes when only switching type to watchlist", () => {
    const result = UpdateStockInputSchema.safeParse({ type: "watchlist" });
    expect(result.success).toBe(true);
  });

  it("passes when switching type to holding with all holding fields present", () => {
    const result = UpdateStockInputSchema.safeParse({
      type: "holding",
      shares: 5,
      cost_basis: 120,
      date_acquired: "2024-06-01",
    });
    expect(result.success).toBe(true);
  });

  it("fails when switching type to holding without the holding fields", () => {
    const result = UpdateStockInputSchema.safeParse({ type: "holding" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toEqual(
        expect.arrayContaining(["shares", "cost_basis", "date_acquired"]),
      );
    }
  });

  it("passes when only updating holding fields, without a type", () => {
    const result = UpdateStockInputSchema.safeParse({ shares: 8 });
    expect(result.success).toBe(true);
  });

  it("fails for an invalid type value", () => {
    const result = UpdateStockInputSchema.safeParse({ type: "portfolio" });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit deleted_at ISO datetime string", () => {
    const result = UpdateStockInputSchema.safeParse({
      deleted_at: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts deleted_at: null", () => {
    const result = UpdateStockInputSchema.safeParse({ deleted_at: null });
    expect(result.success).toBe(true);
  });
});
