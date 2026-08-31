"use client";

import { AlertTriangle } from "lucide-react";

import { CouncilDisclaimer } from "@/components/council/disclaimer";
import {
  callsByTicker,
  portfolioCouncilTally,
  type HoldingCall,
  type PortfolioCouncilReport,
} from "@/lib/jarvis-portfolio-council";

/**
 * The Council's read on the whole book.
 *
 * Every member card renders whether or not their call succeeded, and a
 * per-holding table shows who said what about each position — including the
 * positions NOBODY had a view on, which are rendered as "no view" rather than
 * omitted. Silence is a real answer here and hiding it would make a subset
 * look like a complete matrix.
 */

const CALL_STYLE: Record<HoldingCall, string> = {
  TRIM: "bg-primary-container text-primary",
  ADD: "bg-status-green-container text-status-green",
  HOLD: "bg-white/5 text-on-surface-variant",
};

export function PortfolioCouncilReportView({
  report,
  heldTickers,
  asOf,
  stale,
}: {
  report: PortfolioCouncilReport;
  /** Every open ticker, so positions with no view still appear. */
  heldTickers: string[];
  asOf: string | null;
  /** The book has changed since this report was written. */
  stale: boolean;
}) {
  const tally = portfolioCouncilTally(report);
  const grouped = callsByTicker(report);

  return (
    <div className="flex flex-col gap-6">
      {stale && (
        <div className="flex items-start gap-3 rounded-lg bg-status-blue-container px-4 py-3 text-sm text-status-blue">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Your positions have changed since this consult. It is still what the Council said about
            the book as it stood, not about the book you hold now.
          </span>
        </div>
      )}

      <CouncilDisclaimer />

      <section className="glass-panel flex flex-col gap-4 rounded-xl p-5">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
            The panel
          </p>
          <p className="mt-1 font-mono text-[11px] text-on-surface-variant">
            {tally.answered} answered
            {tally.failed > 0 && `, ${tally.failed} failed`} · {tally.withCalls} gave a view on at
            least one holding · {tally.trim} trim, {tally.add} add, {tally.hold} hold
            {asOf && ` · reviewed ${asOf.slice(0, 10)}`}
          </p>
        </div>

        {report.synthesis ? (
          <div className="flex flex-col gap-3">
            <Block label="Combined read" body={report.synthesis.summary} />
            <List label="Where they agree" items={report.synthesis.where_they_agree} />
            <List label="Where they diverge" items={report.synthesis.where_they_diverge} />
            {report.synthesis.loudest_calls.length > 0 && (
              <div>
                <p className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
                  More than one member said the same thing about
                </p>
                <p className="mt-1 font-mono text-sm text-on-surface">
                  {report.synthesis.loudest_calls.join(", ")}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant">
            No combined read — fewer than two members answered, and restating one card would be
            spend without information.
          </p>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {report.opinions.map((m) => (
          <div key={m.member_id} className="glass-panel flex flex-col gap-3 rounded-lg p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-sm font-extrabold tracking-tight text-on-surface">
                {m.member_name}
              </span>
              {m.opinion === null && (
                <span className="rounded-full bg-error-container px-2.5 py-0.5 font-display text-[10px] font-black tracking-widest text-error">
                  NO ANSWER
                </span>
              )}
            </div>

            {m.opinion === null ? (
              <p className="text-xs text-error">{m.error ?? "This member's call failed."}</p>
            ) : (
              <>
                <p className="text-sm text-on-surface">{m.opinion.headline ?? "—"}</p>
                <Small label="Concentration" body={m.opinion.structural_read.concentration} />
                <Small label="Diversification" body={m.opinion.structural_read.diversification} />
                <Small label="Sizing" body={m.opinion.structural_read.sizing} />
                <Small label="Cash" body={m.opinion.structural_read.cash} />
                <div className="mt-auto pt-1">
                  <p className="font-mono text-[10px] tracking-widest text-error uppercase">
                    Would fix first
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {m.opinion.biggest_risk ?? "—"}
                  </p>
                </div>
                <p className="font-mono text-[10px] text-on-surface-variant/60">
                  {m.opinion.holding_calls.length === 0
                    ? "No strong view on any individual holding."
                    : `Called ${m.opinion.holding_calls.length} of ${heldTickers.length} holdings.`}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <section className="glass-panel flex flex-col gap-3 rounded-xl p-5">
        <div>
          <p className="font-display text-sm font-extrabold tracking-tight text-primary">
            Holding by holding
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Members give a call only where they have a real view. A blank row means nobody did —
            which is an answer, not missing data.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-on-surface-variant/60">
                <th className="p-2 font-normal">Holding</th>
                <th className="p-2 font-normal">The panel</th>
              </tr>
            </thead>
            <tbody>
              {heldTickers.map((ticker) => {
                const calls = grouped.get(ticker) ?? [];
                return (
                  <tr key={ticker} className="align-top">
                    <td className="p-2 font-mono text-on-surface">{ticker}</td>
                    <td className="p-2">
                      {calls.length === 0 ? (
                        <span className="text-on-surface-variant/50">No view</span>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {calls.map((c, i) => (
                            <li key={i} className="flex flex-wrap items-baseline gap-2">
                              <span
                                className={`rounded-full px-2 py-0.5 font-display text-[9px] font-black tracking-widest ${CALL_STYLE[c.call]}`}
                              >
                                {c.call}
                              </span>
                              <span className="text-on-surface-variant">
                                <span className="text-on-surface">{c.member}</span>
                                {c.reason ? ` — ${c.reason}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Block({ label, body }: { label: string; body: string | null }) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm text-on-surface">{body ?? "—"}</p>
    </div>
  );
}

function Small({ label, body }: { label: string; body: string | null }) {
  if (!body) return null;
  return (
    <div>
      <p className="font-mono text-[10px] tracking-widest text-on-surface-variant/60 uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-xs text-on-surface-variant">{body}</p>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
        {label}
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-on-surface-variant">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
