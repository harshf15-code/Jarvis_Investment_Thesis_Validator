import { toZonedTime } from "date-fns-tz";

/**
 * Regular trading-session hours for the markets this app tracks, expressed
 * as minutes-since-midnight local wall-clock time in the exchange's own
 * timezone. Both bounds are inclusive.
 *
 * Known gap (documented, matches the architecture plan): this does not
 * account for exchange holidays. A holiday will read as "open" if it falls
 * within these day-of-week/time bounds.
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
  // (EST/EDT); `toZonedTime` resolves the correct offset for `now`'s date
  // via the IANA tz database, so this is correct across the DST boundary.
  US: {
    timeZone: "America/New_York",
    openMinutes: 9 * 60 + 30,
    closeMinutes: 16 * 60,
  },
};

/**
 * Whether `market` is in its regular trading session at instant `now`.
 *
 * `now` is converted into the market's local timezone with `date-fns-tz`'s
 * `toZonedTime` before any day-of-week/time comparison is made, so this is
 * correct regardless of the host machine's timezone.
 */
export function isMarketOpen(market: "NSE" | "US", now: Date): boolean {
  const session = MARKET_SESSIONS[market];
  const zoned = toZonedTime(now, session.timeZone);

  const dayOfWeek = zoned.getDay(); // 0 = Sunday, 6 = Saturday
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  const minutesSinceMidnight = zoned.getHours() * 60 + zoned.getMinutes();
  return (
    minutesSinceMidnight >= session.openMinutes &&
    minutesSinceMidnight <= session.closeMinutes
  );
}
