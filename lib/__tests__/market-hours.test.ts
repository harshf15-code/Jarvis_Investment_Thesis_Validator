import { describe, expect, it } from "vitest";

import { isMarketOpen } from "@/lib/market-hours";

/**
 * All timestamps below are constructed as ISO 8601 strings with an explicit
 * UTC offset, so these tests are independent of the host machine's local
 * timezone (Node parses an offset-qualified ISO string into the correct
 * absolute instant regardless of `TZ`).
 */
describe("isMarketOpen", () => {
  describe("NSE (Asia/Kolkata, no DST)", () => {
    // 2024-01-16 is a Tuesday.
    it("is closed at 09:14 IST (one minute before open)", () => {
      expect(isMarketOpen("NSE", new Date("2024-01-16T09:14:00+05:30"))).toBe(
        false,
      );
    });

    it("is open at 09:16 IST (one minute after open)", () => {
      expect(isMarketOpen("NSE", new Date("2024-01-16T09:16:00+05:30"))).toBe(
        true,
      );
    });

    it("is open at the exact open boundary, 09:15 IST", () => {
      expect(isMarketOpen("NSE", new Date("2024-01-16T09:15:00+05:30"))).toBe(
        true,
      );
    });

    it("is open at the exact close boundary, 15:30 IST", () => {
      expect(isMarketOpen("NSE", new Date("2024-01-16T15:30:00+05:30"))).toBe(
        true,
      );
    });

    it("is closed at 15:31 IST (one minute after close)", () => {
      expect(isMarketOpen("NSE", new Date("2024-01-16T15:31:00+05:30"))).toBe(
        false,
      );
    });

    it("is closed on a Sunday during would-be trading hours", () => {
      // 2024-01-14 is a Sunday.
      expect(isMarketOpen("NSE", new Date("2024-01-14T10:00:00+05:30"))).toBe(
        false,
      );
    });
  });

  describe("US (America/New_York, observes DST)", () => {
    // 2024-01-19 is a Friday; the US is on EST (UTC-05:00) in January.
    it("is closed at 16:01 ET on Friday (one minute after close)", () => {
      expect(isMarketOpen("US", new Date("2024-01-19T16:01:00-05:00"))).toBe(
        false,
      );
    });

    it("is closed on Saturday at any time", () => {
      // 2024-01-20 is the Saturday immediately following that Friday.
      expect(isMarketOpen("US", new Date("2024-01-20T00:00:01-05:00"))).toBe(
        false,
      );
      expect(isMarketOpen("US", new Date("2024-01-20T12:00:00-05:00"))).toBe(
        false,
      );
      expect(isMarketOpen("US", new Date("2024-01-20T23:59:00-05:00"))).toBe(
        false,
      );
    });

    it("is open during Friday midday trading hours (EST)", () => {
      expect(isMarketOpen("US", new Date("2024-01-19T12:00:00-05:00"))).toBe(
        true,
      );
    });

    // 2024-07-19 is a Friday in July, when the US is on EDT (UTC-04:00).
    // This exercises the actual DST-crossing behavior of the timezone
    // conversion, not just a fixed UTC-offset assumption: the wall-clock
    // 09:30 boundary must land correctly even though the UTC offset
    // differs from the January cases above.
    it("correctly resolves the open boundary during EDT (summer)", () => {
      expect(isMarketOpen("US", new Date("2024-07-19T09:29:00-04:00"))).toBe(
        false,
      );
      expect(isMarketOpen("US", new Date("2024-07-19T09:31:00-04:00"))).toBe(
        true,
      );
    });
  });
});
