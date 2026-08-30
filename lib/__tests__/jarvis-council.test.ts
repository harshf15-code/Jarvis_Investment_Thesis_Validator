import { describe, expect, it } from "vitest";

import {
  CouncilMemberInputSchema,
  councilTally,
  normalizeCouncilReport,
  parseCouncilOpinion,
  parseCouncilSynthesis,
  type CouncilOpinion,
  type CouncilReport,
} from "@/lib/jarvis-council";

function fenced(obj: unknown): string {
  return "Here you go.\n\n```json\n" + JSON.stringify(obj) + "\n```";
}

const OPINION: CouncilOpinion = {
  verdict: "AVOID",
  preferred_ticker: "ROK",
  headline: "Right theme, wrong price.",
  reasoning: "34x on cycle-peak margins is not a margin of safety.",
  biggest_risk: "Multiple compression.",
};

function report(overrides: Partial<CouncilReport> = {}): CouncilReport {
  return {
    jarvis_pick: "MKSI",
    opinions: [
      {
        member_id: "m1",
        member_name: "Warren Buffett",
        source: "builtin",
        opinion: { ...OPINION },
        error: null,
      },
    ],
    synthesis: null,
    generated_at: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseCouncilOpinion", () => {
  it("reads the trailing fenced block", () => {
    const parsed = parseCouncilOpinion(fenced(OPINION));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.preferred_ticker).toBe("ROK");
  });

  it("fails cleanly with no fence rather than throwing", () => {
    const parsed = parseCouncilOpinion("I'd rather not say.");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("No valid");
  });

  it("degrades a thin opinion field-by-field instead of rejecting it", () => {
    // A member who declines to name a risk should still get a card.
    const parsed = parseCouncilOpinion(
      fenced({ ...OPINION, biggest_risk: null, headline: null }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.biggest_risk).toBeNull();
      expect(parsed.data.reasoning).toBe(OPINION.reasoning);
    }
  });

  it("falls back to WATCH for a verdict outside the enum", () => {
    const parsed = parseCouncilOpinion(fenced({ ...OPINION, verdict: "STRONG BUY" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.verdict).toBe("WATCH");
  });
});

describe("parseCouncilSynthesis", () => {
  it("defaults the arrays when the model omits them", () => {
    const parsed = parseCouncilSynthesis(
      fenced({ combined_verdict: "WATCH", summary: "Split panel." }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.where_they_agree).toEqual([]);
      expect(parsed.data.where_they_diverge).toEqual([]);
    }
  });
});

describe("normalizeCouncilReport", () => {
  it("keeps a preferred ticker that is in the priced field", () => {
    const out = normalizeCouncilReport(report(), ["MKSI", "ROK", "AAON"]);
    expect(out.opinions[0].opinion?.preferred_ticker).toBe("ROK");
  });

  it("matches case-insensitively and trims", () => {
    const r = report();
    r.opinions[0].opinion!.preferred_ticker = "  rok ";
    const out = normalizeCouncilReport(r, ["MKSI", "ROK"]);
    expect(out.opinions[0].opinion?.preferred_ticker).toBe("ROK");
  });

  it("drops a ticker outside the field but keeps the argument", () => {
    // The 0016 defect arriving through a new door: a persona nominating a name
    // nobody priced would render a buy-shaped recommendation for a stock that
    // cannot be entered, sized or exited.
    const r = report();
    r.opinions[0].opinion!.preferred_ticker = "FANUY";
    const out = normalizeCouncilReport(r, ["MKSI", "ROK"]);
    expect(out.opinions[0].opinion?.preferred_ticker).toBeNull();
    expect(out.opinions[0].opinion?.reasoning).toBe(OPINION.reasoning);
    expect(out.opinions[0].opinion?.verdict).toBe("AVOID");
  });

  it("leaves a failed member's card untouched", () => {
    const r = report({
      opinions: [
        {
          member_id: "m1",
          member_name: "Howard Marks",
          source: "builtin",
          opinion: null,
          error: "Model call failed: 503",
        },
      ],
    });
    const out = normalizeCouncilReport(r, ["MKSI"]);
    expect(out.opinions[0].error).toBe("Model call failed: 503");
    expect(out.opinions[0].opinion).toBeNull();
  });
});

describe("councilTally", () => {
  const many = report({
    jarvis_pick: "MKSI",
    opinions: [
      { member_id: "1", member_name: "A", source: "builtin", error: null,
        opinion: { ...OPINION, verdict: "BUY", preferred_ticker: "MKSI" } },
      { member_id: "2", member_name: "B", source: "builtin", error: null,
        opinion: { ...OPINION, verdict: "AVOID", preferred_ticker: null } },
      { member_id: "3", member_name: "C", source: "custom", error: null,
        opinion: { ...OPINION, verdict: "WATCH", preferred_ticker: "ROK" } },
      { member_id: "4", member_name: "D", source: "custom", opinion: null, error: "boom" },
    ],
  });

  it("counts verdicts and failures", () => {
    const t = councilTally(many);
    expect(t).toMatchObject({ answered: 3, failed: 1, buy: 1, watch: 1, avoid: 1 });
  });

  it("counts a dissent as anything that is not Jarvis's pick, including none", () => {
    // Arithmetic over the visible cards, never a number the model supplied — a
    // stored count that disagreed with the cards would be worse than no count.
    expect(councilTally(many).dissenting).toBe(2);
  });

  it("reports unanimity when every answer lands on the pick", () => {
    const t = councilTally(
      report({
        opinions: [
          { member_id: "1", member_name: "A", source: "builtin", error: null,
            opinion: { ...OPINION, preferred_ticker: "MKSI" } },
          { member_id: "2", member_name: "B", source: "builtin", error: null,
            opinion: { ...OPINION, preferred_ticker: "mksi" } },
        ],
      }),
    );
    expect(t.dissenting).toBe(0);
    expect(t.answered).toBe(2);
  });
});

describe("CouncilMemberInputSchema", () => {
  it("rejects a philosophy too short to ground a persona", () => {
    // A bare name gives the model nothing to imitate, which is the whole reason
    // the column has a floor rather than just a ceiling.
    const r = CouncilMemberInputSchema.safeParse({ name: "The Short Seller", philosophy: "Bearish." });
    expect(r.success).toBe(false);
  });

  it("accepts a real 2-4 sentence description", () => {
    const r = CouncilMemberInputSchema.safeParse({
      name: "The Short Seller",
      philosophy:
        "Looks for accounting that flatters reality and promoters who need the stock to stay up. Assumes the sell side is late.",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(
      CouncilMemberInputSchema.safeParse({ name: "  ", philosophy: "x".repeat(50) }).success,
    ).toBe(false);
  });
});
