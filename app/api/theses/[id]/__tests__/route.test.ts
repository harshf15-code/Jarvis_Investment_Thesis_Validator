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

describe("PATCH /api/theses/[id] — title (0028)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renames a thesis and marks the name as the trader's", async () => {
    const supabase = buildSupabase({});
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await PATCH(patch({ title: "Defence capex cycle" }), { params });

    expect(res.status).toBe(200);
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Defence capex cycle", title_edited: true }),
    );
  });

  it("sets title_edited server-side, ignoring what the request said", async () => {
    // The flag means "a human chose this". A client that could set it could
    // also CLEAR it, which would let a later re-run overwrite a chosen name —
    // so the schema drops the key and the route sets the value itself.
    const supabase = buildSupabase({});
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await PATCH(patch({ title: "X", title_edited: false }), { params });

    expect(res.status).toBe(200);
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "X", title_edited: true }),
    );
  });

  it("renames a JARVIS thesis, unlike input_text", async () => {
    // The opposite reasoning to the `input_text` guard above: `input_text` is
    // what every downstream artefact was generated from, so rewriting it would
    // leave them describing a thesis that no longer exists. A title is a label
    // and nothing is derived from it.
    const supabase = buildSupabase({ sourceRow: { source: "jarvis" } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    expect((await PATCH(patch({ title: "Mine now" }), { params })).status).toBe(200);
  });

  it("refuses a blank or over-long name", async () => {
    vi.mocked(createClient).mockResolvedValue(buildSupabase({}) as never);
    expect((await PATCH(patch({ title: "   " }), { params })).status).toBe(400);
    expect((await PATCH(patch({ title: "x".repeat(81) }), { params })).status).toBe(400);
  });

  it("leaves title_edited alone on a patch that does not touch the title", async () => {
    const supabase = buildSupabase({});
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    await PATCH(patch({ status: "closed" }), { params });

    expect(supabase.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ title_edited: expect.anything() }),
    );
  });
});
