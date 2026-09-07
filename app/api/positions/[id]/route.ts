import { NextResponse } from "next/server";

import { readPositionDetail } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Screens 5-6's single read, for the BROWSER.
 *
 * The page reads through `readPositionDetail` on the server — see
 * `lib/queries.ts`. This route is what the client calls back through after
 * logging a trim, recording an exit or saving an exit plan.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const detail = await readPositionDetail(supabase, id);
  if (!detail) return NextResponse.json({ error: "Position not found" }, { status: 404 });

  return NextResponse.json(detail);
}
