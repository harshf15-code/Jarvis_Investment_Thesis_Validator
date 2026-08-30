import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ listCouncilMembers: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";
import { DELETE, PATCH } from "../[id]/route";

let inserted: Record<string, unknown> | null = null;
let updated: Record<string, unknown> | null = null;
let deletedId: string | null = null;

function buildSupabaseMock(opts: { count?: number; found?: boolean } = {}) {
  const found = opts.found ?? true;
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table !== "council_members") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ count: opts.count ?? 3, error: null }),
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return {
            select: () => ({ single: async () => ({ data: { id: "new-1", ...row }, error: null }) }),
          };
        },
        update: (row: Record<string, unknown>) => {
          updated = row;
          return {
            eq: (_c: string, id: string) => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: found ? { id, ...row } : null,
                  error: null,
                }),
              }),
            }),
          };
        },
        delete: () => ({
          eq: (_c: string, id: string) => {
            deletedId = id;
            return {
              select: () => ({
                maybeSingle: async () => ({ data: found ? { id } : null, error: null }),
              }),
            };
          },
        }),
      };
    }),
  };
}

function body(o: unknown) {
  return new Request("http://test/api/council/members", {
    method: "POST",
    body: JSON.stringify(o),
  }) as never;
}

const GOOD = {
  name: "The Short Seller",
  philosophy:
    "Looks for accounting that flatters reality and promoters who need the stock to stay up. Assumes the sell side is late.",
};

beforeEach(() => {
  vi.clearAllMocks();
  inserted = null;
  updated = null;
  deletedId = null;
  vi.mocked(createClient).mockResolvedValue(buildSupabaseMock() as never);
});

describe("POST /api/council/members", () => {
  it("adds a custom member", async () => {
    const res = await POST(body(GOOD));
    expect(res.status).toBe(201);
    expect(inserted).toMatchObject({ name: GOOD.name });
  });

  it("rejects a philosophy too thin to ground a persona", async () => {
    const res = await POST(body({ name: "X", philosophy: "Bearish." }));
    expect(res.status).toBe(400);
    expect(inserted).toBeNull();
  });

  it("refuses to exceed the 7-member roster cap", async () => {
    vi.mocked(createClient).mockResolvedValue(buildSupabaseMock({ count: 7 }) as never);
    const res = await POST(body(GOOD));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/full/i);
    expect(inserted).toBeNull();
  });

  it("still allows the seventh member", async () => {
    vi.mocked(createClient).mockResolvedValue(buildSupabaseMock({ count: 6 }) as never);
    expect((await POST(body(GOOD))).status).toBe(201);
  });
});

describe("PATCH/DELETE /api/council/members/[id]", () => {
  const params = Promise.resolve({ id: "m1" });

  it("edits a member", async () => {
    const req = new Request("http://test", { method: "PATCH", body: JSON.stringify({ name: "New" }) });
    const res = await PATCH(req as never, { params });
    expect(res.status).toBe(200);
    expect(updated).toEqual({ name: "New" });
  });

  it("rejects an empty patch", async () => {
    const req = new Request("http://test", { method: "PATCH", body: JSON.stringify({}) });
    expect((await PATCH(req as never, { params })).status).toBe(400);
  });

  it("deletes a built-in like any other row", async () => {
    // The roster caps at 7 TOTAL, so a trader who wants four voices of their
    // own has to be able to free the slot.
    const res = await DELETE(new Request("http://test") as never, { params });
    expect(res.status).toBe(200);
    expect(deletedId).toBe("m1");
  });

  it("404s on a member that is not the caller's", async () => {
    vi.mocked(createClient).mockResolvedValue(buildSupabaseMock({ found: false }) as never);
    const res = await DELETE(new Request("http://test") as never, { params });
    expect(res.status).toBe(404);
  });
});
