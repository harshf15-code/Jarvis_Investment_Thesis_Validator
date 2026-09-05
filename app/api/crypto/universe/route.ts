import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { fetchTopCoins } from "@/lib/crypto-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Refreshes the top-ten crypto universe. Called by pg_cron, weekly.
 *
 * Weekly is ample: market-cap rank does not churn, and this table only governs
 * what can be ADDED. A coin that falls out of the top ten keeps its positions,
 * its history and its alerts — it simply stops being offered for new holdings,
 * so a stale table is harmless in a way a stale price would not be.
 *
 * Guarded by the same bearer secret as the holding watch. Both are "a scheduled
 * job may call this and nobody else may", the secret is already in Supabase
 * Vault, and a second one would be a second thing to rotate for no extra
 * isolation.
 */
export const dynamic = "force-dynamic";

const UNIVERSE_SIZE = 10;

/** Byte-identical to the holding watch's guard, deliberately — see above. */
function authorized(request: Request): boolean {
  const expected = process.env.HOLDING_WATCH_SECRET;
  // No secret configured means the job is not deployed. Refuse rather than
  // run: an unauthenticated route that spends a metered third-party quota is
  // not something to fail open on.
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
  // one bit; compare lengths first and always run the comparison.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  let coins;
  try {
    coins = await fetchTopCoins(UNIVERSE_SIZE);
  } catch (err) {
    // 502, not 500: their outage, not ours. The distinction is what stops an
    // hour of CoinGecko downtime reading as a bug in this app.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach CoinGecko." },
      { status: 502 },
    );
  }

  const refreshed_at = new Date().toISOString();
  // Shared reference data: service-role writes, `authenticated` only reads.
  const { error } = await createAdminClient()
    .from("crypto_universe")
    .upsert(coins.map((c) => ({ ...c, refreshed_at })));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ refreshed: coins.length });
}
