import { cn } from "@/lib/utils";

type Summary = {
  daily_spent: number;
  monthly_spent: number;
  limits: { daily: number | null; monthly: number | null };
  byFeature: { feature: string; costUsd: number; calls: number }[];
  estimatedCalls: number;
};

const FEATURE_LABEL: Record<string, string> = {
  thesis: "Thesis structuring",
  memorandum: "Memorandum",
  council_opinion: "Council opinions",
  council_synthesis: "Council synthesis",
  journal: "Journal verdict",
};

function usd(n: number): string {
  // Sub-cent spend is real: a single cheap call can cost fractions of a cent,
  // and rendering a month of them as "$0.00" would read as free.
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function Meter({
  label,
  spent,
  limit,
  reset,
}: {
  label: string;
  spent: number;
  limit: number | null;
  reset: string;
}) {
  const pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
  const hot = limit !== null && pct >= 80;

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/60">
          {label}
        </p>
        <p className="font-mono text-[10px] text-on-surface-variant/50">resets {reset}</p>
      </div>
      <p className="mt-1.5 font-display text-lg font-extrabold tracking-tight text-on-surface">
        {usd(spent)}
        <span className="ml-1.5 font-mono text-xs font-normal text-on-surface-variant/60">
          {limit === null ? "· no limit" : `of ${usd(limit)}`}
        </span>
      </p>
      {limit !== null && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/5">
          <div
            className={cn("h-full rounded-full transition-all", hot ? "bg-error" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * What this account has spent on model calls, and against what limit.
 *
 * Read-only on purpose. The limits are not editable here — a cap its own
 * subject can raise is not a cap — so this reports rather than configures.
 */
export function UsagePanel({ summary }: { summary: Summary }) {
  const totalCalls = summary.byFeature.reduce((n, f) => n + f.calls, 0);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
          Analysis budget
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-on-surface-variant">
          Every thesis, memorandum and council consult costs a model call. This is what yours have
          cost.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Meter
          label="Today"
          spent={summary.daily_spent}
          limit={summary.limits.daily}
          reset="midnight UTC"
        />
        <Meter
          label="This month"
          spent={summary.monthly_spent}
          limit={summary.limits.monthly}
          reset="the 1st"
        />
      </div>

      {totalCalls > 0 ? (
        <div className="glass-panel rounded-lg p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/60">
            This month · {totalCalls} calls
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {summary.byFeature.map((f) => (
              <li key={f.feature} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-on-surface/85">
                  {FEATURE_LABEL[f.feature] ?? f.feature}
                  <span className="ml-1.5 text-on-surface-variant/50">×{f.calls}</span>
                </span>
                <span className="font-mono text-on-surface-variant">{usd(f.costUsd)}</span>
              </li>
            ))}
          </ul>
          {summary.estimatedCalls > 0 && (
            <p className="mt-3 text-[11px] leading-snug text-on-surface-variant/60">
              {summary.estimatedCalls} of these are estimated from token counts — the provider
              didn&apos;t report a price for them.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-on-surface-variant">No model calls yet this month.</p>
      )}
    </section>
  );
}
