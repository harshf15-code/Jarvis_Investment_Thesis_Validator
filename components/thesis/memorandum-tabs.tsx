"use client";

import { AlertTriangle, Check, Clock, Flag, ShieldAlert, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Memorandum } from "@/lib/jarvis-memorandum";

/* --- shared primitives ---------------------------------------------------- */

/** Section eyebrow — the memo's structural rhythm. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary">
      {children}
    </p>
  );
}

/**
 * A labelled prose block. The left accent rule is the one place the design
 * system's No-Line Rule gives way — it is an accent, not a boundary, and it is
 * what makes a wall of memo text scannable.
 */
function Block({
  label,
  tone = "primary",
  children,
}: {
  label: string;
  tone?: "primary" | "error" | "secondary";
  children: React.ReactNode;
}) {
  const accent =
    tone === "error" ? "bg-error" : tone === "secondary" ? "bg-secondary" : "bg-primary";
  const labelColor =
    tone === "error" ? "text-error" : tone === "secondary" ? "text-secondary" : "text-primary";
  return (
    <div className="glass-panel relative overflow-hidden rounded-lg p-5 pl-6">
      <div className={cn("absolute inset-y-0 left-0 w-0.5", accent)} />
      <p className={cn("mb-2 text-[10px] font-extrabold uppercase tracking-widest", labelColor)}>
        {label}
      </p>
      <div className="text-sm leading-relaxed text-on-surface/85">{children}</div>
    </div>
  );
}

/** Big-number cell used by both the trade grid and the verdict grid. */
function DataCell({
  label,
  value,
  sub,
  tone = "default",
  highlight = false,
}: {
  label: string;
  value: string | null;
  sub: string | null;
  tone?: "default" | "primary" | "error";
  highlight?: boolean;
}) {
  const valueColor =
    tone === "primary" ? "text-primary" : tone === "error" ? "text-error" : "text-on-surface";
  return (
    <div
      className={cn(
        "glass-panel rounded-lg p-4",
        highlight && "ring-1 ring-primary/20",
      )}
    >
      <p className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/60">
        {label}
      </p>
      <p className={cn("mt-1.5 font-display text-lg font-extrabold tracking-tight", valueColor)}>
        {value ?? "—"}
      </p>
      {sub && <p className="mt-1 text-[10px] leading-snug text-on-surface-variant/60">{sub}</p>}
    </div>
  );
}

/** Callout for a secondary/parallel idea — purple, the system's "AI aside" colour. */
function AsideNote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-secondary-container/25 p-5 pl-6">
      <div className="absolute inset-y-0 left-0 w-0.5 bg-secondary" />
      <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-secondary">
        {label}
      </p>
      <div className="text-sm leading-relaxed text-on-surface/85">{children}</div>
    </div>
  );
}

function Warning({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-primary/[0.06] p-5 pl-6">
      <div className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-primary">
        <AlertTriangle className="size-3" strokeWidth={2.5} />
        {label}
      </p>
      <div className="text-sm leading-relaxed text-on-surface/85">{children}</div>
    </div>
  );
}

/* --- Tab 1: Thesis -------------------------------------------------------- */

const PEER_TONE = {
  negative: "text-error",
  positive: "text-primary",
  neutral: "text-status-blue",
} as const;

export function ThesisTab({ memo }: { memo: Memorandum }) {
  const t = memo.thesis;
  return (
    <div className="flex flex-col gap-3">
      {t.section_header && <SectionLabel>{t.section_header}</SectionLabel>}

      {t.market_view && <Block label="Market View">{t.market_view}</Block>}
      {t.mispricing && <Block label="Mispricing">{t.mispricing}</Block>}

      <div className="grid gap-3 lg:grid-cols-2">
        {t.catalysts.length > 0 && (
          <Block label="Catalysts">
            <ul className="flex flex-col gap-2">
              {t.catalysts.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}
        {t.peer_commentary.length > 0 && (
          <Block label="Why Not The Others">
            <div className="flex flex-col gap-3">
              {t.peer_commentary.map((p, i) => (
                <p key={i}>
                  <span className={cn("font-mono font-medium", PEER_TONE[p.tone])}>
                    {p.ticker}
                    {p.valuation ? ` (${p.valuation})` : ""}:
                  </span>{" "}
                  {p.note}
                </p>
              ))}
            </div>
          </Block>
        )}
      </div>

      {t.time_horizon_invalidation && (
        <Block label="Time Horizon & Invalidation" tone="error">
          {t.time_horizon_invalidation}
        </Block>
      )}

      {t.conviction_score != null && (
        <div className="px-1 py-2">
          <div className="mb-2 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/60">
            <span>Conviction Score</span>
            <span className="font-mono text-on-surface">
              {Math.round(t.conviction_score)} / 100
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary-dim to-primary"
              style={{ width: `${Math.min(100, Math.max(0, t.conviction_score))}%` }}
            />
          </div>
        </div>
      )}

      {t.secondary && (
        <AsideNote
          label={`Secondary: ${t.secondary.name ?? "—"}${t.secondary.tier ? ` (${t.secondary.tier})` : ""}`}
        >
          {t.secondary.note}
        </AsideNote>
      )}
    </div>
  );
}

/* --- Tab 2: Stress Test --------------------------------------------------- */

export function StressTab({ memo }: { memo: Memorandum }) {
  const s = memo.stress_test;
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Bear Cases — {s.failure_modes.length} Failure Modes</SectionLabel>

      {s.failure_modes.map((f, i) => (
        <div key={i} className="grid gap-3 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-lg bg-error-container/25 p-5 pl-6">
            <div className="absolute inset-y-0 left-0 w-0.5 bg-error" />
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-error">
              <ShieldAlert className="size-3.5 shrink-0" strokeWidth={2.5} />
              {f.title ?? `Failure mode ${i + 1}`}
            </p>
            <p className="text-sm leading-relaxed text-on-surface/80">{f.bear_case}</p>
          </div>
          <div className="relative overflow-hidden rounded-lg bg-primary/[0.06] p-5 pl-6">
            <div className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-primary">
              <Check className="size-3.5 shrink-0" strokeWidth={3} />
              Counter
            </p>
            <p className="text-sm leading-relaxed text-on-surface/80">{f.counter}</p>
          </div>
        </div>
      ))}

      {s.verdict && <Warning label="Jarvis Verdict on Stress Test">{s.verdict}</Warning>}
    </div>
  );
}

/* --- Tab 3: Trade Plan ---------------------------------------------------- */

const TRADE_CELLS: {
  key: keyof Memorandum["trade_plan"]["cells"];
  label: string;
  tone?: "primary" | "error";
  highlight?: boolean;
}[] = [
  { key: "cmp", label: "CMP" },
  { key: "entry_zone", label: "Entry Zone", tone: "primary", highlight: true },
  { key: "add_tranche", label: "Add Tranche", tone: "primary" },
  { key: "stop_loss", label: "Stop Loss", tone: "error" },
  { key: "target_1", label: "Target 1", tone: "primary", highlight: true },
  { key: "target_2", label: "Target 2", tone: "primary", highlight: true },
  { key: "position_size", label: "Position Size", tone: "primary" },
  { key: "time_horizon", label: "Time Horizon" },
  { key: "time_exit", label: "Time Exit", tone: "error" },
];

export function TradeTab({ memo }: { memo: Memorandum }) {
  const t = memo.trade_plan;
  return (
    <div className="flex flex-col gap-5">
      {t.section_header && <SectionLabel>{t.section_header}</SectionLabel>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TRADE_CELLS.map(({ key, label, tone, highlight }) => (
          <DataCell
            key={key}
            label={label}
            value={t.cells[key]?.value ?? null}
            sub={t.cells[key]?.sub ?? null}
            tone={tone}
            highlight={highlight}
          />
        ))}
      </div>

      {t.test_calendar.length > 0 && (
        <div>
          <SectionLabel>Thesis Test Calendar</SectionLabel>
          <div className="flex flex-col gap-3">
            {t.test_calendar.map((m, i) => (
              <div key={i} className="flex flex-col gap-1 sm:flex-row sm:gap-5">
                <p className="shrink-0 font-mono text-xs font-medium text-primary sm:w-24 sm:pt-0.5">
                  {m.timeframe ?? "—"}
                </p>
                <div>
                  <p className="text-sm font-medium text-on-surface">{m.event}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">{m.test}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {t.parallel_plan && (
        <AsideNote label={`${t.parallel_plan.name ?? "Parallel"} — Parallel Entry (Optional)`}>
          <p className="font-mono text-xs text-on-surface/80">
            Entry <span className="text-on-surface">{t.parallel_plan.entry ?? "—"}</span> · Stop{" "}
            <span className="text-on-surface">{t.parallel_plan.stop ?? "—"}</span> · Target{" "}
            <span className="text-on-surface">{t.parallel_plan.target ?? "—"}</span> · Size{" "}
            <span className="text-on-surface">{t.parallel_plan.size ?? "—"}</span> · Time{" "}
            <span className="text-on-surface">{t.parallel_plan.horizon ?? "—"}</span>
          </p>
          {t.parallel_plan.note && <p className="mt-3">{t.parallel_plan.note}</p>}
        </AsideNote>
      )}
    </div>
  );
}

/* --- Tab 4: Exit Discipline ----------------------------------------------- */

const RULE_ICON = {
  trim: TrendingUp,
  runner: Flag,
  stop: ShieldAlert,
  time: Clock,
} as const;

const RULE_TONE = {
  trim: "text-primary",
  runner: "text-status-blue",
  stop: "text-error",
  time: "text-status-amber",
} as const;

export function ExitTab({ memo }: { memo: Memorandum }) {
  const e = memo.exit;
  return (
    <div className="flex flex-col gap-5">
      {e.section_header && <SectionLabel>{e.section_header}</SectionLabel>}

      <div className="flex flex-col gap-4">
        {e.rules.map((r, i) => {
          const Icon = RULE_ICON[r.kind];
          return (
            <div key={i} className="flex gap-4">
              <Icon
                className={cn("mt-0.5 size-4 shrink-0", RULE_TONE[r.kind])}
                strokeWidth={2.5}
              />
              <div>
                <p className="text-sm font-bold text-on-surface">{r.headline}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-on-surface-variant">{r.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {e.warning && (
        <Warning label="Jarvis Warning">
          {e.warning.text}
          {e.warning.anchor_metric && (
            <p className="mt-3 text-xs">
              <span className="font-extrabold uppercase tracking-widest text-primary">
                Anchor metric:
              </span>{" "}
              <span className="font-mono text-on-surface">{e.warning.anchor_metric}</span>
            </p>
          )}
        </Warning>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DataCell
          label="Risk / Reward"
          value={e.verdict_cells.risk_reward?.value ?? null}
          sub={e.verdict_cells.risk_reward?.sub ?? null}
          tone="primary"
        />
        <DataCell
          label="Max Drawdown at Stop"
          value={e.verdict_cells.max_drawdown?.value ?? null}
          sub={e.verdict_cells.max_drawdown?.sub ?? null}
          tone="error"
        />
        <DataCell
          label="Tier"
          value={e.verdict_cells.tier?.value ?? null}
          sub={e.verdict_cells.tier?.sub ?? null}
          tone="primary"
        />
        <DataCell
          label="PEG / Valuation"
          value={e.verdict_cells.peg?.value ?? null}
          sub={e.verdict_cells.peg?.sub ?? null}
          tone="primary"
        />
      </div>
    </div>
  );
}
