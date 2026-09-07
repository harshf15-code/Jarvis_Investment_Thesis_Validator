import { notFound } from "next/navigation";

import { PositionDetailScreen } from "@/components/positions/position-detail-screen";
import { readPositionDetail } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Screens 5-6 — one position, and the exit discipline around it.
 *
 * Reads the position on the server rather than shipping a skeleton and asking
 * the browser for it. This was the app's slowest screen: it fetched the
 * position after hydrating, then — only once that had landed — fetched a fresh
 * quote, two round trips in series on top of the page load itself.
 */
export const dynamic = "force-dynamic";

export default async function PositionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const detail = await readPositionDetail(supabase, id);
  if (!detail) notFound();

  return <PositionDetailScreen detail={detail} />;
}
