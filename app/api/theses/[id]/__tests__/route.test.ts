import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { PATCH } from "../route";

function patch(body: Record<string, unknown>) {
  return new Request("http://test/api/theses/t1", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as never;
}

const params = Promise.resolve({ id: "t1" });

/**
 * `source` drives the guard; `updated` is what the final update returns.
 * `sourceRow` of `null` stands for "RLS answered with nothing", which is what
 * someone else's thesis looks like through the user client.
 */
function buildSupabase(opts: { sourceRow?: { source: string } | null }) {
  const update = vi.fn().mockReturnValue({
    eq: () => ({
      select: () => ({
        single: async () => ({ data: { id: "t1", status: "active" }, error: null }),
      }),
    }),
  });
  const client = {
    from: vi.fn().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: opts.sourceRow === undefined ? { source: "imported" } : opts.sourceRow,
            error: null,
          }),
        }),
      }),
      update,
    })),
    update,
  };
  return client;
}

describe("PATCH /api/theses/[id] — input_text", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a reason on an imported holding", async () => {
    const supabase = buildSupabase({ sourceRow: { source: "imported" } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await PATCH(patch({ input_text: "Defence order book re-rating." }), { params });
    expect(res.status).toBe(200);
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ input_text: "Defence order book re-rating." }),
    );
  });

  it("refuses to rewrite a Jarvis thesis, because the memorandum was built from it", async () => {
    const supabase = buildSupabase({ sourceRow: { source: "jarvis" } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await PATCH(patch({ input_text: "something else entirely" }), { params });
    expect(res.status).toBe(400);
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("404s when RLS hides the thesis, without saying whether it exists", async () => {
    const supabase = buildSupabase({ sourceRow: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await PATCH(patch({ input_text: "not mine" }), { params });
    expect(res.status).toBe(404);
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("rejects an empty reason at the schema, before any read", async () => {
    const supabase = buildSupabase({ sourceRow: { source: "imported" } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await PATCH(patch({ input_text: "   " }), { params });
    expect(res.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("does not run the imported-only check for edits that are not input_text", async () => {
    // The guard costs a round trip; a status change must not pay for it.
    const supabase = buildSupabase({ sourceRow: { source: "jarvis" } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await PATCH(patch({ status: "closed" }), { params });
    expect(res.status).toBe(200);
    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({ status: "closed" }));
  });
});
