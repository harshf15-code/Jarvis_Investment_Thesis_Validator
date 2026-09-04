import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { GET, POST } from "../route";
import { DELETE, PATCH } from "../[id]/route";

const PF1 = "11111111-1111-4111-8111-111111111111";
const PF2 = "22222222-2222-4222-8222-222222222222";

const BOOK = {
  id: PF1,
  user_id: "u1",
  created_at: "2026-01-01T00:00:00.000Z",
  name: "My Portfolio",
  ownership: "owned",
  beneficiary_name: null,
  base_currency: "INR",
  is_default: true,
};

type Opts = {
  /** Rows returned by the list read, in order across successive calls. */
  lists?: Record<string, unknown>[][];
  count?: number;
  /** The row `.eq().maybeSingle()` finds, for the [id] route. */
  found?: Record<string, unknown> | null;
  positionCount?: number;
  noteCount?: number;
  insertFails?: boolean;
};

function buildMock(opts: Opts = {}) {
  const lists = opts.lists ? [...opts.lists] : [[BOOK]];
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  let deleted = false;

  function portfolios() {
    const chain: Record<string, unknown> = {
      // `select("id", { count: "exact", head: true })` — the cap check.
      select: (_cols?: string, options?: { head?: boolean }) => {
        if (options?.head) {
          return Promise.resolve({ data: null, error: null, count: opts.count ?? 0 });
        }
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      maybeSingle: async () => ({
        data: opts.found === undefined ? BOOK : opts.found,
        error: null,
      }),
      single: async () => ({ data: inserted[inserted.length - 1] ?? BOOK, error: null }),
      // Insert has two shapes in this route: awaited directly for its `error`
      // (the lazy default), and `.select().single()` (create). It must not
      // consume a queued list read either way.
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        const error = opts.insertFails ? { message: "dup" } : null;
        return {
          select: () => ({ single: async () => ({ data: error ? null : row, error }) }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(resolve),
        };
      },
      update: (patch: Record<string, unknown>) => {
        updated.push(patch);
        return chain;
      },
      delete: () => {
        deleted = true;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: lists.shift() ?? [], error: null }).then(resolve),
    };
    return chain;
  }

  function counted(count: number) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => Promise.resolve({ data: null, error: null, count }),
    };
    return chain;
  }

  return {
    _inserted: inserted,
    _updated: updated,
    get _deleted() {
      return deleted;
    },
    from: vi.fn((table: string) => {
      if (table === "portfolios") return portfolios();
      if (table === "positions") return counted(opts.positionCount ?? 0);
      if (table === "scratchpad_notes") return counted(opts.noteCount ?? 0);
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const create = (body: Record<string, unknown>) =>
  new Request("http://test/api/portfolios", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUser).mockResolvedValue({ id: "u1" } as never);
});

describe("GET /api/portfolios", () => {
  it("requires a session", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    expect((await GET()).status).toBe(401);
  });

  it("returns the books that already exist without creating another", async () => {
    const mock = buildMock({ lists: [[BOOK]] });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const body = await (await GET()).json();

    expect(body.portfolios).toHaveLength(1);
    expect(mock._inserted).toHaveLength(0);
  });

  it("creates the default book for an account that has none", async () => {
    // There is no `after insert on auth.users` trigger — the one this app had
    // was dropped in 0015 — so without this a new account would have somewhere
    // to look and nowhere to put anything.
    const mock = buildMock({ lists: [[], [BOOK]] });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const body = await (await GET()).json();

    expect(mock._inserted).toHaveLength(1);
    expect(mock._inserted[0]).toMatchObject({ name: "My Portfolio", is_default: true });
    expect(body.portfolios).toHaveLength(1);
  });

  it("re-reads rather than failing when the default insert loses a race", async () => {
    // Two concurrent first requests: `idx_portfolios_one_default` lets only one
    // win, and the loser's answer is the winner's row, not an error.
    const mock = buildMock({ lists: [[], [BOOK]], insertFails: true });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).portfolios).toHaveLength(1);
  });
});

describe("POST /api/portfolios", () => {
  it("requires a name", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock() as never);
    expect((await POST(create({ name: "  " }))).status).toBe(400);
  });

  it("creates a managed book with its beneficiary", async () => {
    const mock = buildMock({ count: 1 });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await POST(
      create({ name: "Mom", ownership: "managed", beneficiary_name: "Mom", base_currency: "inr" }),
    );

    expect(res.status).toBe(201);
    expect(mock._inserted[0]).toMatchObject({
      name: "Mom",
      ownership: "managed",
      beneficiary_name: "Mom",
      base_currency: "INR",
    });
  });

  it("drops a beneficiary on an owned book rather than storing a claim nothing renders", async () => {
    const mock = buildMock({ count: 1 });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    await POST(create({ name: "Mine", ownership: "owned", beneficiary_name: "Mom" }));

    expect(mock._inserted[0].beneficiary_name).toBeNull();
  });

  it("refuses a sixth book with a sentence rather than a Postgres error", async () => {
    const mock = buildMock({ count: 5 });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await POST(create({ name: "Six" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/already have 5 portfolios/i);
    expect(mock._inserted).toHaveLength(0);
  });

  it("refuses a currency that is not three letters", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock({ count: 0 }) as never);
    expect((await POST(create({ name: "X", base_currency: "rupees" }))).status).toBe(400);
  });
});

describe("PATCH /api/portfolios/[id]", () => {
  const patch = (body: Record<string, unknown>) =>
    new Request("http://test", { method: "PATCH", body: JSON.stringify(body) });

  it("renames a book", async () => {
    const mock = buildMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await PATCH(patch({ name: "Retirement" }), params(PF1));

    expect(res.status).toBe(200);
    expect(mock._updated[0]).toMatchObject({ name: "Retirement" });
  });

  it("clears the beneficiary when a book becomes the trader's own", async () => {
    const mock = buildMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);

    await PATCH(patch({ ownership: "owned" }), params(PF1));

    expect(mock._updated[0].beneficiary_name).toBeNull();
  });

  it("rejects an unknown field rather than ignoring it", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock() as never);
    expect((await PATCH(patch({ is_default: true }), params(PF1))).status).toBe(400);
  });

  it("404s for a book that is not this trader's", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock({ found: null }) as never);
    expect((await PATCH(patch({ name: "X" }), params(PF2))).status).toBe(404);
  });
});

describe("DELETE /api/portfolios/[id]", () => {
  const del = () => new Request("http://test", { method: "DELETE" });

  it("refuses to delete the default book", async () => {
    const mock = buildMock({ found: { id: PF1, is_default: true } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await DELETE(del(), params(PF1));

    expect(res.status).toBe(400);
    expect(mock._deleted).toBe(false);
  });

  it("refuses a book that still holds positions, and names how many", async () => {
    // The plain-English form of 0027's deferred foreign key, which would
    // otherwise refuse this as a constraint violation at commit.
    const mock = buildMock({ found: { id: PF2, is_default: false }, positionCount: 3 });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await DELETE(del(), params(PF2));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("3 positions");
    expect(mock._deleted).toBe(false);
  });

  it("names notes too, since they are the trader's own words", async () => {
    const mock = buildMock({ found: { id: PF2, is_default: false }, noteCount: 1 });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const body = await (await DELETE(del(), params(PF2))).json();

    expect(body.error).toContain("1 note");
  });

  it("deletes an empty, non-default book", async () => {
    const mock = buildMock({ found: { id: PF2, is_default: false } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await DELETE(del(), params(PF2));

    expect(res.status).toBe(200);
    expect(mock._deleted).toBe(true);
  });

  it("404s for a book that is not this trader's", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock({ found: null }) as never);
    expect((await DELETE(del(), params(PF2))).status).toBe(404);
  });
});
