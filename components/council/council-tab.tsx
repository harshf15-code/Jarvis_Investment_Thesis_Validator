"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

import { councilTally, type CouncilReport } from "@/lib/jarvis-council";
import { VERDICT_STYLE } from "@/components/thesis/comparative-grid";
import { Block, SectionLabel } from "@/components/thesis/memorandum-tabs";
import { cn } from "@/lib/utils";
import { CouncilDisclaimer } from "./disclaimer";

/**
 * The Council's report: the combined read first, then one card per member.
 *
 * The grid wraps rather than assuming a column count, because the panel is
 * anywhere from 3 to 7 members and a fixed three-column layout would break the
 * moment a trader used the roster they were given.
 */
export function CouncilTab({
  report,
  stale,
  running,
  onRerun,
}: {
  report: CouncilReport;
  /**
   * True when the memorandum has been re-run since this council read it. The
   * report is not wrong, it is answering an older question — which is worth
   * saying out loud rather than quietly presenting as current.
   */
  stale: boolean;
  running: boolean;
  onRerun: () => void;
}) {
  const tally = councilTally(report);
  const synthesis = report.synthesis;

  return (
    <div className="flex flex-col gap-6">
      {stale && (
        <p className="flex items-start gap-2 rounded-lg bg-status-blue-container px-4 py-3 text-xs text-status-blue">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.5} />
          <span>
            This Council read an earlier memorandum. The analysis has been re-run since — consult
            again for a verdict on the current one.
          </span>
        </p>
      )}

      <div>
        <SectionLabel>The Council</SectionLabel>

        <div className="flex flex-wrap items-center gap-3">
          {synthesis && (
            <span
              className={cn(
                "rounded-full px-3 py-1 font-display text-xs font-black tracking-widest",
                VERDICT_STYLE[synthesis.combined_verdict],
              )}
            >
              {synthesis.combined_verdict}
            </span>
          )}
          <span className="font-mono text-[11px] text-on-surface-variant">
            {tally.dissenting === 0
              ? `All ${tally.answered} back ${report.jarvis_pick}.`
              : `${tally.dissenting} of ${tally.answered} dissent from ${report.jarvis_pick}.`}
            {tally.failed > 0 &&
              ` ${tally.failed} member${tally.failed === 1 ? "" : "s"} did not answer.`}
          </span>
        </div>

        {synthesis ? (
          <div className="mt-4 flex flex-col gap-3">
            <Block label="Combined read">{synthesis.summary ?? "—"}</Block>
            {synthesis.where_they_agree.length > 0 && (
              <Block label="Where they agree">
                <ul className="flex flex-col gap-1.5">
                  {synthesis.where_they_agree.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </Block>
            )}
            {synthesis.where_they_diverge.length > 0 && (
              <Block label="Where they diverge" tone="secondary">
                <ul className="flex flex-col gap-1.5">
                  {synthesis.where_they_diverge.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </Block>
            )}
          </div>
        ) : (
          <p className="mt-4 text-xs text-on-surface-variant">
            {tally.answered === 1
              ? "Only one member answered, so there was nothing to reconcile — their card is below."
              : "The combined read could not be produced. The individual opinions below are unaffected."}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {report.opinions.map((m) => (
          <article key={m.member_id} className="glass-panel flex flex-col gap-3 rounded-lg p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-sm font-extrabold tracking-tight text-on-surface">
                {m.member_name}
              </h3>
              {m.opinion ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 font-display text-[10px] font-black tracking-widest",
                    VERDICT_STYLE[m.opinion.verdict],
                  )}
                >
                  {m.opinion.verdict}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-error-container px-2.5 py-0.5 font-display text-[10px] font-black tracking-widest text-error">
                  NO ANSWER
                </span>
              )}
            </div>

            {/*
             * A failed member is stated, never rendered as an empty card. With
             * seven members the odds that one call fails are real, and a blank
             * card would read as "this member had nothing to say".
             */}
            {!m.opinion ? (
              <p className="text-xs leading-relaxed text-error">
                {m.error ?? "This member's call failed."}
              </p>
            ) : (
              <>
                <p className="font-mono text-[10px] tracking-widest text-on-surface-variant/60 uppercase">
                  {m.opinion.preferred_ticker
                    ? m.opinion.preferred_ticker === report.jarvis_pick
                      ? `Would own ${m.opinion.preferred_ticker} · agrees`
                      : `Would own ${m.opinion.preferred_ticker} · differs`
                    : "Would own none of this field"}
                </p>
                {m.opinion.headline && (
                  <p className="font-display text-sm font-bold leading-snug tracking-tight text-on-surface">
                    {m.opinion.headline}
                  </p>
                )}
                {m.opinion.reasoning && (
                  <p className="text-xs leading-relaxed text-on-surface/80">
                    {m.opinion.reasoning}
                  </p>
                )}
                {m.opinion.biggest_risk && (
                  <div className="mt-auto pt-1">
                    <p className="text-[10px] font-extrabold uppercase tracking-widest text-error">
                      Biggest risk
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                      {m.opinion.biggest_risk}
                    </p>
                  </div>
                )}
              </>
            )}
          </article>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRerun}
          disabled={running}
          className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
        >
          <RefreshCw className={cn("size-3", running && "animate-spin")} strokeWidth={2.5} />
          {running ? "Deliberating" : "Consult again"}
        </button>
        <CouncilDisclaimer className="flex-1 basis-64" />
      </div>
    </div>
  );
}
