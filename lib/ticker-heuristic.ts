/**
 * Words that match the ticker-shaped regex below but are near-certainly NOT
 * a ticker in this app's actual usage (common short macro/finance
 * abbreviations the spec's own examples use in plain prose: "Indian IT",
 * "AI tailwinds", "US demand", "EV buyback" naming a theme rather than the
 * literal ticker "EV"). Deliberately short and conservative — a false
 * negative here just means the model runs without live price context, which
 * degrades gracefully; a false positive would attempt (and fail) a live
 * Yahoo lookup on every mention of a macro theme.
 */
const NOT_A_TICKER = new Set([
  "I", "A", "IT", "AI", "US", "EV", "PE", "IPO", "GDP", "CPI", "FED", "RBI",
]);

/**
 * Best-effort, regex-only guess at a ticker-shaped token in free text:
 * 2-10 uppercase letters, optionally with a single hyphenated suffix (e.g.
 * `BAJAJ-AUTO`). Returns the FIRST such token found that isn't in
 * `NOT_A_TICKER`, or `null` if none. This is a context-fetching heuristic
 * only, never validated against a real ticker database here — the caller
 * (Task 9's route) is responsible for confirming it resolves via
 * `lib/market-data.ts` before treating it as real.
 */
export function extractPossibleTicker(inputText: string): string | null {
  const matches = inputText.match(/\b[A-Z]{2,10}(?:-[A-Z]{2,10})?\b/g);
  if (!matches) return null;

  for (const match of matches) {
    if (!NOT_A_TICKER.has(match)) {
      return match;
    }
  }
  return null;
}
