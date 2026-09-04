import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { GET, POST } from "../route";

const NOTES = [
  { id: "n-1", body: "Look at power transmission.", ticker: "POWERGRID", archived_at: null },
  { id: "n-2", body: "An old idea.", ticker: null, archived_at: "2026-08-01T00:00:00Z" },
];

let inserted: Record<string, unknown> | null = null;

function buildMock() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table !== "scratchpad_notes") throw new Error(`unexpected table ${table}`);
      return {
        // `.eq("portfolio_id", …)` is applied only in single-book mode, so the
        // builder has to be chainable rather than a fixed two-call shape.
        select: () => {
          const chain: Record<string, unknown> = {
            eq: () => chain,
            order: () => chain,
            limit: async () => ({ data: NOTES, error: null }),
          };
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return {
            select: () => ({ single: async () => ({ data: { id: "n-3", ...row }, error: null }) }),
          };
        },
      };
    }),
  };
}

/** The book every fixture note belongs to. Uuid-shaped: the route parses it. */
const PF1 = "11111111-1111-4111-8111-111111111111";

const post = (body: Record<string, unknown>) =>
  new Request("http://test/api/scratchpad/notes", {
    method: "POST",
    body: JSON.stringify({ portfolio_id: PF1, ...body }),
  });

/** Reads are scoped to one book, or to `all` for the roll-up. */
const get = (scope: string = PF1) =>
  new Request(`http://test/api/scratchpad/notes?portfolio=${scope}`);

beforeEach(() => {
  vi.clearAllMocks();
  inserted = null;
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(createClient).mockResolvedValue(buildMock() as never);
});

describe("GET /api/scratchpad/notes", () => {
  it("returns archived notes alongside live ones, in one request", async () => {
    // The archive view and the ticker filter are views onto the same small
    // list; making either cost a round trip would be paying for nothing.
    const res = await GET(get());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notes).toHaveLength(2);
    expect(body.notes[1].archived_at).not.toBeNull();
  });

  it("refuses a read that does not say which portfolio", async () => {
    const res = await GET(new Request("http://test/api/scratchpad/notes"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/scratchpad/notes", () => {
  it("saves a note with its ticker upper-cased", async () => {
    const res = await POST(post({ body: "Watch the order book.", ticker: " hal " }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.note.body).toBe("Watch the order book.");
    // The note is filed against the book it was written in, not inferred.
    expect(inserted?.portfolio_id).toBe(PF1);
    expect(inserted).toEqual({
      portfolio_id: PF1,
      body: "Watch the order book.",
      ticker: "HAL",
    });
  });

  it("saves a note with no ticker at all", async () => {
    // The point of a scratchpad is that an idea can be written down before it
    // resolves to anything.
    const res = await POST(post({ body: "Something is off about lenders." }));
    expect(res.status).toBe(201);
    expect(inserted).toMatchObject({ ticker: null });
  });

  it("treats an empty ticker string as no ticker", async () => {
    await POST(post({ body: "x", ticker: "  " }));
    expect(inserted).toMatchObject({ ticker: null });
  });

  it("refuses an empty note rather than storing a blank row", async () => {
    const res = await POST(post({ body: "   " }));
    expect(res.status).toBe(400);
    expect(inserted).toBeNull();
  });

  it("refuses when not signed in", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    const res = await POST(post({ body: "x" }));
    expect(res.status).toBe(401);
    expect(inserted).toBeNull();
  });

  it("rejects a body it cannot parse before touching the database", async () => {
    const res = await POST(
      new Request("http://test/api/scratchpad/notes", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
    expect(inserted).toBeNull();
  });
});
