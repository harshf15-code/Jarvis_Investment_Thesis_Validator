import { describe, expect, it } from "vitest";

import {
  deriveStatus,
  evaluateTriggers,
  isWithinDedupWindow,
  type TriggerAlertCriteriaInput,
} from "@/lib/trigger-logic";

function criteria(
  overrides: Partial<TriggerAlertCriteriaInput> = {},
): TriggerAlertCriteriaInput {
  return {
    entry_low: null,
    entry_high: null,
    stop_loss: null,
    trim_targets: [],
    earnings_date: null,
    reassessment_date: null,
    time_exit_date: null,
    ...overrides,
  };
}

const NOW = new Date("2026-08-27T12:00:00Z");

describe("evaluateTriggers", () => {
  it("fires entry_zone_reached when price is within [entry_low, entry_high] for a watchlist stock", () => {
    const events = evaluateTriggers(
      { type: "watchlist" },
      criteria({ entry_low: 100, entry_high: 110 }),
      105,
      NOW,
    );
    expect(events).toEqual([
      {
        type: "entry_zone_reached",
        details: { price: 105, entry_low: 100, entry_high: 110 },
      },
    ]);
  });

  it("fires entry_zone_reached at the inclusive boundaries", () => {
    const low = evaluateTriggers(
      { type: "watchlist" },
      criteria({ entry_low: 100, entry_high: 110 }),
      100,
      NOW,
    );
    const high = evaluateTriggers(
      { type: "watchlist" },
      criteria({ entry_low: 100, entry_high: 110 }),
      110,
      NOW,
    );
    expect(low.some((e) => e.type === "entry_zone_reached")).toBe(true);
    expect(high.some((e) => e.type === "entry_zone_reached")).toBe(true);
  });

  it("does not fire entry_zone_reached outside the zone or for a holding", () => {
    const outside = evaluateTriggers(
      { type: "watchlist" },
      criteria({ entry_low: 100, entry_high: 110 }),
      111,
      NOW,
    );
    expect(outside).toEqual([]);

    const wrongType = evaluateTriggers(
      { type: "holding" },
      criteria({ entry_low: 100, entry_high: 110 }),
      105,
      NOW,
    );
    expect(wrongType.some((e) => e.type === "entry_zone_reached")).toBe(
      false,
    );
  });

  it("fires stop_loss_breached when price is at the stop", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({ stop_loss: 90 }),
      90,
      NOW,
    );
    expect(events).toEqual([
      { type: "stop_loss_breached", details: { price: 90, stop_loss: 90 } },
    ]);
  });

  it("fires stop_loss_breached when price is above the stop... no, below it (price <= stop_loss)", () => {
    const above = evaluateTriggers(
      { type: "holding" },
      criteria({ stop_loss: 90 }),
      95,
      NOW,
    );
    expect(above).toEqual([]);

    const below = evaluateTriggers(
      { type: "holding" },
      criteria({ stop_loss: 90 }),
      85,
      NOW,
    );
    expect(below).toEqual([
      { type: "stop_loss_breached", details: { price: 85, stop_loss: 90 } },
    ]);
  });

  it("does not fire stop_loss_breached for a watchlist stock", () => {
    const events = evaluateTriggers(
      { type: "watchlist" },
      criteria({ stop_loss: 90 }),
      50,
      NOW,
    );
    expect(events).toEqual([]);
  });

  it("fires one trim_target_reached event when price crosses exactly one of two tiers", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({
        trim_targets: [
          { price: 150, pct_of_position: 25 },
          { price: 200, pct_of_position: 25 },
        ],
      }),
      160,
      NOW,
    );
    expect(events).toEqual([
      {
        type: "trim_target_reached",
        details: {
          price: 160,
          tier_price: 150,
          pct_of_position: 25,
          tier_index: 0,
        },
      },
    ]);
  });

  it("fires two trim_target_reached events when price crosses both tiers", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({
        trim_targets: [
          { price: 150, pct_of_position: 25 },
          { price: 200, pct_of_position: 25 },
        ],
      }),
      210,
      NOW,
    );
    const trimEvents = events.filter((e) => e.type === "trim_target_reached");
    expect(trimEvents).toHaveLength(2);
    expect(trimEvents.map((e) => e.details.tier_index)).toEqual([0, 1]);
  });

  it("fires zero trim_target_reached events when price is below every tier", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({
        trim_targets: [
          { price: 150, pct_of_position: 25 },
          { price: 200, pct_of_position: 25 },
        ],
      }),
      100,
      NOW,
    );
    expect(events.filter((e) => e.type === "trim_target_reached")).toEqual(
      [],
    );
  });

  it("fires earnings_approaching when earnings is 2 days out", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({ earnings_date: "2026-08-29" }), // NOW is 2026-08-27
      100,
      NOW,
    );
    expect(events).toEqual([
      {
        type: "earnings_approaching",
        details: { earnings_date: "2026-08-29", days_out: 2 },
      },
    ]);
  });

  it("does not fire earnings_approaching when earnings is 10 days out", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({ earnings_date: "2026-09-06" }), // NOW + 10 days
      100,
      NOW,
    );
    expect(events.filter((e) => e.type === "earnings_approaching")).toEqual(
      [],
    );
  });

  it("fires earnings_approaching when earnings is today (0 days out)", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({ earnings_date: "2026-08-27" }),
      100,
      NOW,
    );
    expect(events.filter((e) => e.type === "earnings_approaching")).toHaveLength(
      1,
    );
  });

  it("fires reassess_due when reassessment_date is today", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({ reassessment_date: "2026-08-27" }),
      100,
      NOW,
    );
    expect(events).toEqual([
      {
        type: "reassess_due",
        details: { reassess_date: "2026-08-27" },
      },
    ]);
  });

  it("does not fire reassess_due when reassessment_date is in the future", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({ reassessment_date: "2026-08-28" }),
      100,
      NOW,
    );
    expect(events).toEqual([]);
  });

  it("fires reassess_due for a past reassessment_date", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({ reassessment_date: "2026-08-01" }),
      100,
      NOW,
    );
    expect(events.filter((e) => e.type === "reassess_due")).toHaveLength(1);
  });

  it("falls back to time_exit_date for reassess_due when reassessment_date is null", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({ reassessment_date: null, time_exit_date: "2026-08-27" }),
      100,
      NOW,
    );
    expect(events).toEqual([
      { type: "reassess_due", details: { reassess_date: "2026-08-27" } },
    ]);
  });

  it("prefers reassessment_date over time_exit_date when both are set", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({
        reassessment_date: "2026-09-01", // future -> would not fire alone
        time_exit_date: "2026-08-01", // past -> would fire alone
      }),
      100,
      NOW,
    );
    // reassessment_date wins and is in the future, so nothing fires.
    expect(events).toEqual([]);
  });

  it("can fire multiple trigger types simultaneously for a holding", () => {
    const events = evaluateTriggers(
      { type: "holding" },
      criteria({
        stop_loss: 90,
        trim_targets: [{ price: 50, pct_of_position: 50 }],
        reassessment_date: "2026-08-27",
      }),
      80,
      NOW,
    );
    const types = events.map((e) => e.type).sort();
    expect(types).toEqual(
      ["reassess_due", "stop_loss_breached", "trim_target_reached"].sort(),
    );
  });
});

describe("deriveStatus", () => {
  it("orders Stop Hit above every other status", () => {
    expect(
      deriveStatus("holding", [
        "trim_target_reached",
        "reassess_due",
        "entry_zone_reached",
        "stop_loss_breached",
      ]),
    ).toBe("Stop Hit");
  });

  it("orders Trim Hit above Reassess Due and In Entry Zone", () => {
    expect(
      deriveStatus("holding", [
        "reassess_due",
        "entry_zone_reached",
        "trim_target_reached",
      ]),
    ).toBe("Trim Hit");
  });

  it("orders Reassess Due above In Entry Zone", () => {
    expect(deriveStatus("watchlist", ["entry_zone_reached", "reassess_due"])).toBe(
      "Reassess Due",
    );
  });

  it("falls back to In Entry Zone when only that trigger fired", () => {
    expect(deriveStatus("watchlist", ["entry_zone_reached"])).toBe(
      "In Entry Zone",
    );
  });

  it("falls back to Holding / Watching by stock type with no trigger active", () => {
    expect(deriveStatus("holding", [])).toBe("Holding");
    expect(deriveStatus("watchlist", [])).toBe("Watching");
  });

  it("ignores earnings_approaching entirely (alert-only, never a status)", () => {
    expect(deriveStatus("holding", ["earnings_approaching"])).toBe("Holding");
    expect(deriveStatus("watchlist", ["earnings_approaching"])).toBe(
      "Watching",
    );
  });
});

describe("isWithinDedupWindow", () => {
  it("returns true just under the 20-hour window", () => {
    const last = new Date(NOW.getTime() - 19 * 60 * 60 * 1000);
    expect(isWithinDedupWindow(last, NOW)).toBe(true);
  });

  it("returns false just over the 20-hour window", () => {
    const last = new Date(NOW.getTime() - 21 * 60 * 60 * 1000);
    expect(isWithinDedupWindow(last, NOW)).toBe(false);
  });

  it("accepts an ISO string for lastTriggeredAt", () => {
    const last = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(isWithinDedupWindow(last, NOW)).toBe(true);
  });

  it("respects a custom window", () => {
    const last = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    expect(isWithinDedupWindow(last, NOW, 1)).toBe(false);
    expect(isWithinDedupWindow(last, NOW, 3)).toBe(true);
  });
});
