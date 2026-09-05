import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/crypto-data", () => ({ fetchTopCoins: vi.fn() }));

import { currentUser } from "@/lib/auth/user";
import { fetchTopCoins } from "@/lib/crypto-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { GET, POST } from "../route";

let upserted: Record<string, unknown>[] | null = null;
/** The `not(... in ...)` filter the prune deletes by, or null if it never ran. */
let pruneFilter: string | null = null;

function mockAdmin(
  error: { message: string } | null = null,
  pruneError: { message: string } | null = null,
) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table !== "crypto_universe") throw new Error(`unexpected table ${table}`);
      return {
        upsert: async (rows: Record<string, unknown>[]) => {
          upserted = rows;
          return { error };
        },
        delete: () => ({
          not: async (_col: string, _op: string, value: string) => {
            pruneFilter = value;
            return { error: pruneError };
          },
        }),
      };
    }),
  };
}

const post = (secret = "s3cret") =>
  new Request("http://test/api/crypto/universe", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });

beforeEach(() => {
  vi.clearAllMocks();
  upserted = null;
  pruneFilter = null;
  vi.stubEnv("HOLDING_WATCH_SECRET", "s3cret");
  vi.mocked(createAdminClient).mockReturnValue(mockAdmin() as never);
  vi.mocked(fetchTopCoins).mockResolvedValue([
    { coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 },
  ] as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/crypto/universe", () => {
  it("stores the ranked top ten", async () => {
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect((await res.json()).refreshed).toBe(1);
    expect(upserted).toEqual([
      expect.objectContaining({ coingecko_id: "bitcoin", symbol: "BTC", market_cap_rank: 1 }),
    ]);
  });

  it("stamps refreshed_at so staleness is visible", async () => {
    await POST(post());
    expect(upserted![0].refreshed_at).toEqual(expect.any(String));
  });

  it("removes coins that have fallen out of the ranking", async () => {
    // The upsert only ever ADDS. Without this the tracked "top ten" grows
    // every time the ranking churns, and this route goes on offering a coin it
    // no longer tracks -- the opposite of the rule it states.
    await POST(post());
    expect(pruneFilter).toBe('("bitcoin")');
  });

  it("does not prune when the ranking came back empty", async () => {
    // The filter inverts the fetched set, so an empty list would not prune
    // nothing -- it would delete every coin and block every add until the next
    // refresh a week later.
    vi.mocked(fetchTopCoins).mockResolvedValue([] as never);
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(pruneFilter).toBeNull();
  });

  it("reports a failed prune rather than claiming a clean refresh", async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(null, { message: "nope" }) as never);
    expect((await POST(post())).status).toBe(500);
  });

  it("refuses a request with the wrong secret", async () => {
    const res = await POST(post("wrong-but-same-len"));
    expect(res.status).toBe(401);
    expect(fetchTopCoins).not.toHaveBeenCalled();
  });

  it("refuses every request while the secret is unset, rather than failing open", async () => {
    // An unauthenticated route that spends someone else's API quota is not
    // something to fail open on. Same rule as the holding watch.
    vi.stubEnv("HOLDING_WATCH_SECRET", "");
    expect((await POST(post())).status).toBe(401);
    expect(fetchTopCoins).not.toHaveBeenCalled();
  });

  it("502s when CoinGecko is unreachable, distinguishing it from our own failure", async () => {
    vi.mocked(fetchTopCoins).mockRejectedValue(new Error("boom"));
    expect((await POST(post())).status).toBe(502);
  });

  it("500s when the write fails, so a silent no-op cannot look like a refresh", async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin({ message: "boom" }) as never);
    expect((await POST(post())).status).toBe(500);
  });
});

describe("GET /api/crypto/universe", () => {
  /** Reads through the caller's own session: 0030 grants `authenticated`
   *  select on this table, so no service-role client is involved. */
  function buildReadMock(error: { message: string } | null = null) {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table !== "crypto_universe") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            order: async () => ({
              data: error
                ? null
                : [{ coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 }],
              error,
            }),
          }),
        };
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(createClient).mockResolvedValue(buildReadMock() as never);
  });

  it("lists the coins a trader may add", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).coins).toEqual([
      { coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 },
    ]);
  });

  it("does not answer an anonymous caller", async () => {
    // Reading the list is not privileged, but it is not public either -- and
    // the bearer secret guarding POST is for a cron job, not for a person.
    vi.mocked(currentUser).mockResolvedValue(null as never);
    expect((await GET()).status).toBe(401);
  });

  it("reports a failed read rather than an empty universe", async () => {
    // An empty list renders as "there are no coins", which is a very different
    // thing to tell someone than "we could not reach the list".
    vi.mocked(createClient).mockResolvedValue(buildReadMock({ message: "boom" }) as never);
    expect((await GET()).status).toBe(500);
  });

  it("never spends CoinGecko quota on a read", async () => {
    await GET();
    expect(fetchTopCoins).not.toHaveBeenCalled();
  });
});
