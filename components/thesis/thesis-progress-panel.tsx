"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import {
  THESIS_STEPS,
  THESIS_STEP_LABELS,
  type ThesisStep,
} from "@/lib/thesis-progress";
import { cn } from "@/lib/utils";

export type StepState = { status: "pending" | "active" | "done"; detail: string | null };

/** Every step pending — the state a run starts from. */
export function initialSteps(): Record<ThesisStep, StepState> {
  return Object.fromEntries(
    THESIS_STEPS.map((s) => [s, { status: "pending", detail: null } as StepState]),
  ) as Record<ThesisStep, StepState>;
}

/**
 * Seconds since `startedAt`, ticking once a second.
 *
 * The one number here the server does not send, and the only one it does not
 * need to: elapsed time is a fact the browser already holds. It is deliberately
 * NOT an estimate, a remaining time, or a fraction of anything — the model call
 * is most of the wait and nothing knows how long it will take.
 */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // The clamp is what makes a stale `now` harmless when a second run starts:
  // `startedAt` jumps ahead of it, the difference goes negative, and the clock
  // reads 0:00 — which is the truth — until the first tick a second later.
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * What the route is actually doing, one line per step.
 *
 * A stepper rather than a bar, because a bar would have to invent the thing it
 * is measuring. Each row lights when the server says that step began and ticks
 * when it says it finished; `detail` is the step's own evidence, which is the
 * part worth reading — "HAL on NSE · ₹4,512" tells the trader the run is
 * anchored to the listing they meant, before the thesis exists to check.
 *
 * The elapsed clock sits on the active row only. On the long step that is the
 * honest answer to "is this stuck?", and on the short ones it would just be
 * noise.
 */
export function ThesisProgressPanel({
  steps,
  startedAt,
}: {
  steps: Record<ThesisStep, StepState>;
  startedAt: number | null;
}) {
  const elapsed = useElapsed(startedAt);

  return (
    <ol className="flex flex-col gap-2" aria-live="polite">
      {THESIS_STEPS.map((id) => {
        const { status, detail } = steps[id];
        return (
          <li key={id} className="flex items-baseline gap-2.5 text-xs">
            <span className="flex size-3.5 shrink-0 translate-y-0.5 items-center justify-center">
              {status === "done" ? (
                <Check className="size-3.5 text-primary" aria-hidden />
              ) : status === "active" ? (
                <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
              ) : (
                <span className="size-1.5 rounded-full bg-on-surface-variant/30" aria-hidden />
              )}
            </span>

            <span
              className={cn(
                "flex-1",
                status === "pending" && "text-on-surface-variant/50",
                status === "active" && "text-on-surface",
                status === "done" && "text-on-surface-variant",
              )}
            >
              {THESIS_STEP_LABELS[id]}
              {detail && (
                <span className="ml-2 font-mono text-[11px] text-on-surface-variant">{detail}</span>
              )}
            </span>

            {status === "active" && startedAt !== null && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-on-surface-variant">
                {clock(elapsed)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
