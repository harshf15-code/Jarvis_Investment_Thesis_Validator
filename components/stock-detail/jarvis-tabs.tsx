"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";

import { AnalysisVersionPicker } from "@/components/stock-detail/analysis-version-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { JarvisAnalysis, Json } from "@/lib/types";

/**
 * Reads `{ narrative: "<markdown>" }` off `thesis_json`/`stress_test_json`/
 * `trade_plan_json`. Never throws on an unexpected shape (a hand-written
 * `jsonb` column has no schema enforcement at the DB level) — falls back to
 * an empty string, which `Narrative` below renders as "No content yet."
 */
function getNarrative(json: Json): string {
  if (
    json !== null &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    typeof json.narrative === "string"
  ) {
    return json.narrative;
  }
  return "";
}

/**
 * Reads one of the two keys off `exit_json`'s `{ riskAwareness,
 * exitDiscipline }` shape (see `lib/jarvis-run.ts`'s column-mapping note —
 * there is no `risk_awareness_json` column; both the Risk Awareness and
 * Exit Discipline tabs read from this single `exit_json` column instead).
 */
function getExitField(
  json: Json,
  key: "riskAwareness" | "exitDiscipline",
): string {
  if (
    json !== null &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    typeof json[key] === "string"
  ) {
    return json[key];
  }
  return "";
}

/**
 * Markdown -> JSX element overrides, styled per the Neon Velocity tokens
 * instead of react-markdown's unstyled default HTML output.
 */
const markdownComponents: Components = {
  h1: ({ children }) => (
    <h3 className="font-display text-base font-semibold text-on-surface">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="font-display text-base font-semibold text-on-surface">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="font-display text-sm font-semibold text-on-surface">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="text-sm leading-relaxed text-on-surface/85">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-on-surface/85">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm leading-relaxed text-on-surface/85">
      {children}
    </ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-on-surface">{children}</strong>
  ),
  em: ({ children }) => <em className="text-on-surface/90">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-surface-container-highest px-1 py-0.5 text-xs">
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    // No-Line Rule: a tonal background fill instead of a border to mark the
    // blockquote's edge, not a border line.
    <blockquote className="rounded-lg bg-surface-container-low px-3 py-2 text-on-surface/70 italic">
      {children}
    </blockquote>
  ),
};

function Narrative({ text }: { text: string }) {
  if (!text.trim()) {
    return (
      <p className="text-sm text-on-surface/50">
        No content for this section.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Markdown components={markdownComponents}>{text}</Markdown>
    </div>
  );
}

const TAB_CONFIG = [
  { key: "thesis", label: "Thesis" },
  { key: "stressTest", label: "Stress Test" },
  { key: "tradePlan", label: "Trade Plan" },
  { key: "riskAwareness", label: "Risk Awareness" },
  { key: "exitDiscipline", label: "Exit Discipline" },
] as const;

/**
 * Restyled shadcn `Tabs` per the No-Line Rule: active tab is a
 * background/text-color shift plus a primary-colored underline accent
 * (`data-[state=active]:after:opacity-100`), never a bordered tab strip.
 * The installed `components/ui/tabs.tsx` primitive's own baked-in active
 * styling targets a `data-active` attribute Radix never actually sets
 * (Radix only ever sets `data-state="active"|"inactive"`), so it's
 * effectively inert here — these `data-[state=active]:` overrides are what
 * actually drives the active look.
 */
const tabsTriggerClassName = cn(
  "relative h-9 flex-none rounded-lg px-3 text-sm font-medium text-on-surface/60 transition-colors",
  "hover:text-on-surface",
  "data-[state=active]:bg-surface-container-high data-[state=active]:text-on-surface",
  // The base `TabsTrigger` (`components/ui/tabs.tsx`) already positions an
  // `after:` pseudo-element via `group-data-horizontal/tabs:after:inset-x-0
  // group-data-horizontal/tabs:after:bottom-[-5px]
  // group-data-horizontal/tabs:after:h-0.5` — these overrides repeat that
  // exact `group-data-horizontal/tabs:` variant chain (not a bare
  // `after:inset-x-*`) so `cn`'s `tailwind-merge` recognizes them as the
  // same conflict group and drops the base values, rather than both rules
  // coexisting at the mercy of Tailwind's internal stylesheet ordering.
  "group-data-horizontal/tabs:after:inset-x-3 group-data-horizontal/tabs:after:-bottom-[3px] group-data-horizontal/tabs:after:h-0.5",
  "after:absolute after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity",
  "data-[state=active]:after:opacity-100",
);

/**
 * Owns "which `jarvis_analyses` version is currently displayed" as
 * client-side state over the full, already-fetched list of versions (the
 * parent server component fetches every version up front, so switching
 * versions here never triggers a refetch). Composes
 * `AnalysisVersionPicker` for the version switcher and shadcn `Tabs` for
 * the five narrative sections.
 *
 * Callers must not render this with an empty `analyses` array — the page
 * component shows a "Run Jarvis" empty state instead in that case, since
 * there is no version to select or display.
 */
export function JarvisTabs({ analyses }: { analyses: JarvisAnalysis[] }) {
  const sorted = useMemo(
    () => [...analyses].sort((a, b) => b.version - a.version),
    [analyses],
  );

  const [selectedId, setSelectedId] = useState<string | undefined>(
    sorted[0]?.id,
  );

  const selected =
    sorted.find((analysis) => analysis.id === selectedId) ?? sorted[0];

  if (!selected) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-on-surface">
          Jarvis Analysis
        </h2>
        {sorted.length > 1 ? (
          <AnalysisVersionPicker
            analyses={sorted}
            selectedId={selected.id}
            onChange={setSelectedId}
          />
        ) : null}
      </div>

      {!selected.extraction_ok ? (
        <div
          role="alert"
          className="rounded-xl bg-error-container/40 px-4 py-3 text-sm text-error"
        >
          Criteria extraction failed for this run — alert monitoring is
          using the previous analysis&apos;s criteria. Review this response
          manually.
        </div>
      ) : null}

      <Tabs defaultValue="thesis">
        <TabsList
          variant="line"
          className="h-auto w-full justify-start gap-1 bg-transparent p-0"
        >
          {TAB_CONFIG.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className={tabsTriggerClassName}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="thesis" className="pt-4">
          <Narrative text={getNarrative(selected.thesis_json)} />
        </TabsContent>
        <TabsContent value="stressTest" className="pt-4">
          <Narrative text={getNarrative(selected.stress_test_json)} />
        </TabsContent>
        <TabsContent value="tradePlan" className="pt-4">
          <Narrative text={getNarrative(selected.trade_plan_json)} />
        </TabsContent>
        <TabsContent value="riskAwareness" className="pt-4">
          <Narrative
            text={getExitField(selected.exit_json, "riskAwareness")}
          />
        </TabsContent>
        <TabsContent value="exitDiscipline" className="pt-4">
          <Narrative
            text={getExitField(selected.exit_json, "exitDiscipline")}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
