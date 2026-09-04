"use client";

import { use } from "react";

import { MemorandumView } from "@/components/thesis/memorandum-view";
import { ThesisTitleBar } from "@/components/thesis/thesis-title-bar";

/**
 * A thesis IS its memorandum. Jarvis compares the field, picks a winner, and
 * lays out thesis / stress test / trade plan / exit in one screen; the only
 * decision left on it is whether to back the trade.
 *
 * This replaces the old three-screen wizard (review -> stress test -> 9-cell
 * grid), which made the user assemble by hand what the analysis already knew.
 */
export default function ThesisMemorandumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="flex flex-col gap-4">
      {/* The IDEA's name, above the memorandum's own headline. Renaming it here
          is what makes the thesis list readable — see `lib/thesis-title.ts`. */}
      <ThesisTitleBar thesisId={id} />
      <MemorandumView thesisId={id} />
    </div>
  );
}
