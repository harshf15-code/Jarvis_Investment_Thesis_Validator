import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { PATCH } from "../route";

let updated: Record<string, unknown> | null = null;

function buildMock(opts: { found?: boolean } = {}) {
  const found = opts.found ?? true;
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table !== "scratchpad_notes") throw new Error(`unexpected table ${table}`);
      return {
        update: (row: Record<string, unknown>) => {
          updated = row;
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: found ? { id: "n-1", ...row } : null,
                  error: null,
                }),
              }),
            }),
          };
        },
      };
    }),
  };
}

const params = Promise.resolve({ id: "n-1" });
const patch = (body: unknown) =>
  new Request("http://test/api/scratchpad/notes/n-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  updated = null;
  vi.mocked(createClient).mockResolvedValue(buildMock() as never);
});

describe("PATCH /api/scratchpad/notes/[id]", () => {
  it("edits the text and stamps updated_at", async () => {
    const res = await PATCH(patch({ body: "Sharper now." }), { params });
    expect(res.status).toBe(200);
    expect(updated).toMatchObject({ body: "Sharper now." });
    expect(updated?.updated_at).toEqual(expect.any(String));
  });

  it("archives instead of deleting", async () => {
    // A note is a record of what the trader was thinking, and "I stopped
    // believing this" is part of that record.
    const res = await PATCH(patch({ archived: true }), { params });
    expect(res.status).toBe(200);
    expect(updated?.archived_at).toEqual(expect.any(String));
    expect(updated).not.toHaveProperty("archived");
  });

  it("puts an archived note back", async () => {
    await PATCH(patch({ archived: false }), { params });
    expect(updated).toMatchObject({ archived_at: null });
  });

  it("clears a ticker when given an empty one", async () => {
    await PATCH(patch({ ticker: "" }), { params });
    expect(updated).toMatchObject({ ticker: null });
  });

  it("answers 404 for a note that is not yours, the same as one that is gone", async () => {
    // RLS makes someone else's note invisible rather than forbidden, and that
    // is the answer that leaks the least.
    vi.mocked(createClient).mockResolvedValue(buildMock({ found: false }) as never);
    const res = await PATCH(patch({ body: "x" }), { params });
    expect(res.status).toBe(404);
  });

  it("refuses an empty body rather than blanking the note", async () => {
    const res = await PATCH(patch({ body: "   " }), { params });
    expect(res.status).toBe(400);
    expect(updated).toBeNull();
  });

  it("refuses a field it does not recognise", async () => {
    const res = await PATCH(patch({ user_id: "someone-else" }), { params });
    expect(res.status).toBe(400);
    expect(updated).toBeNull();
  });

  it("refuses a request that changes nothing", async () => {
    const res = await PATCH(patch({}), { params });
    expect(res.status).toBe(400);
    expect(updated).toBeNull();
  });
});
