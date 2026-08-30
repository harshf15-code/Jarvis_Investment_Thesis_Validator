import { CouncilRoster } from "@/components/council/council-roster";
import { UsagePanel } from "@/components/settings/usage-panel";
import { getUsageSummary } from "@/lib/queries";
import { listCouncilMembers } from "@/lib/queries";

export const metadata = { title: "Settings · Jarvis" };

/**
 * Settings. Today it holds exactly one thing — the Investment Council roster —
 * but it is the app's first settings surface, so it is laid out to take more.
 *
 * Reads through `listCouncilMembers()` rather than fetching its own route: see
 * the header comment on `lib/queries.ts` for why a Server Component making an
 * HTTP request to its own API is an anti-pattern that has already broken this
 * app in production once.
 */
export default async function SettingsPage() {
  const [members, usage] = await Promise.all([listCouncilMembers(), getUsageSummary()]);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tighter text-on-surface">
          Settings
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          How Jarvis behaves for this account.
        </p>
      </header>

      <UsagePanel summary={usage} />

      <CouncilRoster initialMembers={members} />
    </div>
  );
}
