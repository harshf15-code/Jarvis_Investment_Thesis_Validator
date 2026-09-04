import type { Thesis } from "@/lib/types";

/**
 * What to call a thesis on screen.
 *
 * One function because there were three copies of `t.ticker ?? "Macro Thesis"`
 * — in the thesis list, the feed's preview drawer and the add-signal modal —
 * and three copies of a fallback chain is three chances for a screen to call
 * the same idea something different.
 *
 * The last resort changed with 0028. "Macro Thesis" was a CATEGORY wearing the
 * costume of a name: every macro thesis rendered it, so a list of six of them
 * was six identical rows, and the one string that was supposed to tell them
 * apart was the one thing they had in common. "Untitled thesis" is at least
 * true, and it should now be rare — a thesis run after 0028 carries a real name
 * from the same model call that produced its market view.
 */
export function thesisTitle(
  thesis: Pick<Thesis, "title" | "ticker"> & Partial<Pick<Thesis, "id">>,
): string {
  const title = thesis.title?.trim();
  if (title) return title;
  const ticker = thesis.ticker?.trim();
  if (ticker) return ticker;
  return "Untitled thesis";
}

/** The longest a title may be, mirrored by the check constraint in 0028. */
export const THESIS_TITLE_MAX = 80;
