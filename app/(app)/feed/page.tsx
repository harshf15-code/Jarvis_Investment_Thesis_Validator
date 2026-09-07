import { FeedScreen } from "@/components/feed/feed-screen";
import { readSignalFeed } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Screen 4 — the Jarvis Intelligence Feed (US-08).
 *
 * Reads its own rows rather than shipping a skeleton and asking the browser to
 * fetch them back: this render is already on the server with a Supabase client
 * open, which is the argument `lib/queries.ts` makes in full.
 */
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const supabase = await createClient();
  const { signals, agenda } = await readSignalFeed(supabase);

  return <FeedScreen signals={signals} agenda={agenda} />;
}
