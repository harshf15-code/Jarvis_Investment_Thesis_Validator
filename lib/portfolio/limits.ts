/**
 * How many books one trader may keep.
 *
 * Mirrored by the `portfolios_cap` trigger in 0027, which is where the
 * invariant actually lives — the same split as `COUNCIL_ROSTER_MAX` and
 * `enforce_council_roster_cap()`. This copy exists so the app can refuse with a
 * sentence instead of surfacing a Postgres error, and raising the cap later is
 * a one-line change in exactly these two places.
 *
 * Five is a product decision. It is small enough that lifecycle management —
 * archiving, a read-only historical view — can wait, which is why 0027 has no
 * `archived_at`.
 */
export const MAX_PORTFOLIOS = 5;

export const PORTFOLIO_CAP_MESSAGE = `You already have ${MAX_PORTFOLIOS} portfolios. Delete one before adding another.`;
