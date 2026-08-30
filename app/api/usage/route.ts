import { NextResponse } from "next/server";

import { getUsageSummary } from "@/lib/queries";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * This account's spend. Read-only — there is no PATCH, because a limit the user
 * can raise is not a limit. Overrides are written by hand in SQL.
 *
 * Used by the Settings usage panel and by the Council picker, which prices a
 * consult from the trader's own recent calls rather than from a guess.
 */
export async function GET() {
  try {
    return NextResponse.json(await getUsageSummary());
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
