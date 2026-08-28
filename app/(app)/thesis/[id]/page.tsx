"use client";

import { use } from "react";

import { MemorandumView } from "@/components/thesis/memorandum-view";

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
  return <MemorandumView thesisId={id} />;
}
