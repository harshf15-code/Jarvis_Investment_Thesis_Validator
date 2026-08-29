import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/lib/supabase/server";
import { PATCH } from "../route";

/**
 * Builds a Supabase mock whose `.update(...)` call is captured by
 * `updateSpy` and whose eventual `.single()` resolves using whatever patch
 * object was actually passed to `.update(...)` — never a pre-baked value —
 * so a test asserting on the mocked *response* is really asserting on what
 * the route computed and sent to Postgres, including its `edited_fields`
 * diffing logic.
 */
function buildSupabaseMock(existing: Record<string, unknown>) {
  const updateSpy = vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { ...existing, ...patch },
          error: null,
        }),
      }),
    }),
  }));

  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: existing, error: null }),
        }),
      }),
      update: updateSpy,
    }),
  };

  return { supabase, updateSpy };
}

describe("PATCH /api/trade-plans/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks a field as edited when its new value differs from ai_suggested", async () => {
    const { supabase, updateSpy } = buildSupabaseMock({
      id: "tp1",
      stop_loss: 90,
      ai_suggested: { stop_loss: 90 },
      edited_fields: [],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const req = new Request("http://test", { method: "PATCH", body: JSON.stringify({ stop_loss: 95 }) });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: "tp1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stop_loss: 95, edited_fields: ["stop_loss"] }),
    );
    expect(body.tradePlan.edited_fields).toContain("stop_loss");
  });

  it("reverts a field to un-edited when it matches ai_suggested again, while a genuinely diverging field in the same patch is still tracked", async () => {
    // Worked example from the design: stop_loss was previously edited, but
    // this patch sets it back to the AI-suggested value (should be removed
    // from edited_fields), while target_1 diverges from its AI-suggested
    // value in this same patch (should be added).
    const { supabase, updateSpy } = buildSupabaseMock({
      id: "tp1",
      stop_loss: 90,
      target_1: 120,
      ai_suggested: { stop_loss: 90, target_1: 120 },
      edited_fields: ["stop_loss"],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const req = new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ stop_loss: 90, target_1: 125 }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: "tp1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ edited_fields: ["target_1"] }),
    );
    expect(body.tradePlan.edited_fields).toEqual(["target_1"]);
  });

  // Task 23 / US-15: `thesis_conditions` is user-owned data with no
  // `ai_suggested` counterpart, so it must reach the update untouched while
  // staying out of the amber "edited from AI's suggestion" diff entirely.
  it("updates thesis_conditions without adding it to edited_fields", async () => {
    const { supabase, updateSpy } = buildSupabaseMock({
      id: "tp1",
      thesis_conditions: [],
      ai_suggested: {},
      edited_fields: [],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const req = new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({
        thesis_conditions: [{ label: "Chetak share", target: ">=18%", currentValue: "16%" }],
      }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: "tp1" }) });

    expect(res.status).toBe(200);
    const updateArg = updateSpy.mock.calls[0][0];
    expect(updateArg.thesis_conditions).toHaveLength(1);
    expect(updateArg.edited_fields).not.toContain("thesis_conditions");
  });
});
