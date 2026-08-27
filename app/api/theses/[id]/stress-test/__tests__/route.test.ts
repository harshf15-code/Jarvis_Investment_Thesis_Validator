import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { generateText } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

const RAW = `\`\`\`json
{"bear_cases":[
  {"reason":"r1","counter":"c1"},{"reason":"r2","counter":"c2"},
  {"reason":"r3","counter":"c3"},{"reason":"r4","counter":"c4"}
]}
\`\`\``;

/**
 * The `.update(...)` patch the route computes is echoed straight back as the
 * saved row (same convention as `app/api/trade-plans/[id]/__tests__`), so an
 * assertion on the response body is an assertion on what the route actually
 * parsed out of the model's text — never on a value pre-baked by this mock.
 */
function buildMock(thesis: Record<string, unknown> | null) {
  const update = vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { ...thesis, ...patch }, error: null }),
      }),
    }),
  }));
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: thesis, error: null }) }),
      }),
      update,
    }),
    _update: update,
  };
}

const THESIS = { id: "t1", market_view: "v", mispricing: "m", catalyst: "c", invalidation_condition: "i" };

describe("POST /api/theses/[id]/stress-test", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates 4 bear cases and persists them onto the thesis", async () => {
    const mock = buildMock(THESIS);
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    vi.mocked(generateText).mockResolvedValue({ text: RAW } as never);

    const res = await POST(new Request("http://test") as never, { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mock._update).toHaveBeenCalledWith(
      expect.objectContaining({ raw_llm_response: RAW }),
    );
    expect(body.thesis.bear_cases).toHaveLength(4);
    expect(body.thesis.bear_cases[0]).toEqual({ reason: "r1", counter: "c1", modified: false });
    expect(body.thesis.bear_cases[3].reason).toBe("r4");
  });

  it("returns 404 when the thesis doesn't exist", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildMock(null) as never);
    const res = await POST(new Request("http://test") as never, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("returns 502 without writing when the model call fails", async () => {
    const mock = buildMock(THESIS);
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    vi.mocked(generateText).mockRejectedValue(new Error("upstream down"));

    const res = await POST(new Request("http://test") as never, { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain("upstream down");
    expect(mock._update).not.toHaveBeenCalled();
  });

  it("returns 502 without writing when the response has no parsable JSON block", async () => {
    const mock = buildMock(THESIS);
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    vi.mocked(generateText).mockResolvedValue({ text: "I refuse to answer." } as never);

    const res = await POST(new Request("http://test") as never, { params: Promise.resolve({ id: "t1" }) });

    expect(res.status).toBe(502);
    expect(mock._update).not.toHaveBeenCalled();
  });
});
