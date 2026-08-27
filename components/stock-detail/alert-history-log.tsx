import { formatExchangeTime } from "@/lib/format";
import type { AlertLog, ExchangeCode, Json, TriggerType } from "@/lib/types";

/**
 * Not "use client": this only reads already-fetched props and renders
 * static markup, no interactivity, so it stays a plain server-renderable
 * component (same reasoning as `components/dashboard/stock-card.tsx`).
 */

const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  entry_zone_reached: "Entry zone reached",
  stop_loss_breached: "Stop loss breached",
  trim_target_reached: "Trim target reached",
  earnings_approaching: "Earnings approaching",
  reassess_due: "Reassessment due",
  data_stale: "Data stale",
};

function humanizeTriggerType(raw: TriggerType): string {
  return TRIGGER_TYPE_LABELS[raw] ?? raw;
}

function formatTriggeredAt(iso: string, exchange: ExchangeCode): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return formatExchangeTime(date, exchange, { year: "numeric" });
}

/**
 * Renders `alert_log.details` (an arbitrary `jsonb` blob) as one compact
 * line: `key=value` pairs for a plain object, otherwise a plain
 * `JSON.stringify`. Never throws — this is display-only, best-effort
 * summarization of a column with no fixed shape enforced at the DB level.
 */
function renderDetails(details: Json): string {
  if (
    details !== null &&
    typeof details === "object" &&
    !Array.isArray(details)
  ) {
    const entries = Object.entries(details).filter(
      ([, value]) => value !== undefined,
    );
    if (entries.length === 0) {
      return "";
    }
    return entries
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" · ");
  }
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

/**
 * `alert_log` rows for one stock, newest first, in the "terminal feed"
 * style: `surface-container-lowest` background, small `Inter` text, one
 * line per alert. Empty state is a quiet "No alerts yet" line, not an
 * error — an empty `alert_log` is the normal, expected state for any stock
 * that hasn't triggered an alert yet.
 */
export function AlertHistoryLog({
  alerts,
  exchange,
}: {
  alerts: AlertLog[];
  exchange: ExchangeCode;
}) {
  const sorted = [...alerts].sort(
    (a, b) =>
      new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime(),
  );

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-container-lowest p-4">
      <h3 className="text-sm font-semibold text-on-surface/80">
        Alert history
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-on-surface/40">No alerts yet</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map((alert) => {
            const detailsLine = renderDetails(alert.details);
            return (
              <li
                key={alert.id}
                className="flex flex-col gap-0.5 text-xs"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-on-surface/40">
                    {formatTriggeredAt(alert.triggered_at, exchange)}
                  </span>
                  <span className="font-medium text-on-surface/85">
                    {humanizeTriggerType(alert.trigger_type)}
                  </span>
                </div>
                {detailsLine ? (
                  <span className="text-on-surface/50">{detailsLine}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
