// Deno Edge Function module — NOT part of the Next.js build.
//
// Deliberate, documented divergence from `lib/market-hours.ts` (Task 4):
// that version uses `date-fns-tz`'s `toZonedTime`, a Node package whose
// resolution via Deno's npm compatibility layer isn't guaranteed reliable
// inside an Edge Function's constrained runtime. This version uses the
// platform-native `Intl.DateTimeFormat` with a `timeZone` option instead —
// available in Deno without any import — to get the same "what's the
// wall-clock time in this IANA timezone right now" answer. The two
// implementations must stay semantically equivalent (same sessions, same
// day-of-week/inclusive-bounds rules); if Task 4's version changes, mirror
// the change here too.

/**
 * Regular trading-session hours, as minutes-since-midnight local wall-clock
 * time in the exchange's own timezone. Both bounds inclusive. Same known
 * gap as `lib/market-hours.ts`: exchange holidays are not accounted for.
 */
const MARKET_SESSIONS: Record<
  "NSE" | "US",
  { timeZone: string; openMinutes: number; closeMinutes: number }
> = {
  // NSE (India): Asia/Kolkata, Mon-Fri, 09:15-15:30 local. No DST in India.
  NSE: {
    timeZone: "Asia/Kolkata",
    openMinutes: 9 * 60 + 15,
    closeMinutes: 15 * 60 + 30,
  },
  // US: America/New_York, Mon-Fri, 09:30-16:00 local. Observes DST
  // (EST/EDT) — `Intl.DateTimeFormat`'s `timeZone` option resolves the
  // correct offset for `now`'s date via the host ICU/IANA tz database, so
  // this is correct across the DST boundary without any manual offset math.
  US: {
    timeZone: "America/New_York",
    openMinutes: 9 * 60 + 30,
    closeMinutes: 16 * 60,
  },
};

const WEEKEND_DAYS = new Set(["Sat", "Sun"]);

/**
 * Whether `market` is in its regular trading session at instant `now`.
 *
 * Uses `Intl.DateTimeFormat(..., { timeZone }).formatToParts(now)` to read
 * `now`'s weekday/hour/minute as they read on a wall clock in the market's
 * timezone, so this is correct regardless of the host machine's own
 * timezone (same guarantee `lib/market-hours.ts` makes via `date-fns-tz`).
 */
export function isMarketOpen(market: "NSE" | "US", now: Date): boolean {
  const session = MARKET_SESSIONS[market];

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: session.timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23", // 0-23, so midnight reads as "0" not "24"
  }).formatToParts(now);

  const partValue = (type: string) =>
    parts.find((p) => p.type === type)?.value;

  const weekday = partValue("weekday");
  if (weekday === undefined || WEEKEND_DAYS.has(weekday)) {
    return false;
  }

  const hour = Number(partValue("hour"));
  const minute = Number(partValue("minute"));
  const minutesSinceMidnight = hour * 60 + minute;

  return (
    minutesSinceMidnight >= session.openMinutes &&
    minutesSinceMidnight <= session.closeMinutes
  );
}
