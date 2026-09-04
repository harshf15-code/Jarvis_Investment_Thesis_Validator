import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { isLiveMarket } from "@/lib/markets";
import { MAX_IMPORT_ROWS, RESOLVE_CHUNK } from "@/lib/portfolio-import";
import { requireVisibleBook } from "@/lib/portfolio/active";
import { resolveImportRows } from "@/lib/portfolio/resolve";
import { createClient } from "@/lib/supabase/server";
import type { MarketCode } from "@/lib/types";

/**
 * Prices one chunk of a CSV import and flags anything the trader needs to see
 * before committing. WRITES NOTHING — this is the preview step, and its whole
 * value is that a bad row surfaces here rather than as a failed insert after
 * the trader has already hit confirm.
 *
 * Chunked because each row costs up to one Yahoo quote per exchange in the
 * chosen market; a 200-row book resolved in one request would outlive the
 * function timeout. The client sends `RESOLVE_CHUNK` at a time and shows
 * progress.
 */
export const maxDuration = 60;

const DraftRowSchema = z.object({
  index: z.number().int().min(0),
  ticker: z.string().trim().max(40),
  quantity: z.number().nullable(),
  averagePrice: z.number().nullable(),
  date: z.iso.date().nullable(),
});

const ResolveInputSchema = z.object({
  /** The book being imported into — duplicate detection is per-book (0027). */
  portfolio_id: z.uuid("Choose which portfolio these holdings belong to."),
  market: z.string(),
  rows: z.array(DraftRowSchema).min(1).max(RESOLVE_CHUNK),
  /** Row indices the client knows are repeats from elsewhere in the same file —
   *  see `resolveImportRows`. A warning only; the commit route recomputes. */
  repeatedIndices: z.array(z.number().int().min(0)).max(MAX_IMPORT_ROWS).optional(),
});

export async function POST(request: Request) {
  // No budget guard: this feature never calls the model. The session check is
  // still here because resolving costs outbound market-data requests, and
  // because duplicate detection reads the caller's own positions.
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ResolveInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { portfolio_id, market, rows, repeatedIndices } = parsed.data;

  if (!isLiveMarket(market)) {
    return NextResponse.json(
      { error: `Market "${market}" is not available yet.` },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // Before anything is priced. `resolveImportRows` asks this book what it
  // already holds, so a book that is not this trader's would come back empty
  // and every row would preview as clean — the preview's whole job is to flag
  // a re-upload, and silently finding nothing is worse than refusing.
  const refusal = await requireVisibleBook(supabase, portfolio_id);
  if (refusal) return refusal;

  try {
    const resolved = await resolveImportRows(
      supabase,
      rows,
      market as MarketCode,
      portfolio_id,
      repeatedIndices ?? [],
    );
    return NextResponse.json({ rows: resolved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
