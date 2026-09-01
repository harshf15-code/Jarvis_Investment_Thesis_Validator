import type { Thesis } from "@/lib/types";

/**
 * The steps `POST /api/theses` reports while it runs, and the wire format it
 * reports them in.
 *
 * Shared by the route that emits them and the panel that draws them, so the two
 * cannot disagree about what a step is called or what order they come in — the
 * same reason `MIN_PATTERN_HOLDINGS` lives beside the code that enforces it
 * rather than being written out twice.
 *
 * WHAT THIS IS NOT: a progress bar. Nothing here interpolates between steps and
 * nothing predicts how long the next one takes. The model call is the large
 * majority of the wall clock and its duration is not knowable in advance — not
 * from the request, and not from history either, since `llm_usage` records what
 * a call cost but never how long it took. Every mark on screen is a report of
 * work the server has actually finished. A percentage would have to be invented,
 * so there isn't one.
 */

export const THESIS_STEPS = ["budget", "resolve", "generate", "parse", "save"] as const;

export type ThesisStep = (typeof THESIS_STEPS)[number];

/**
 * Present participles on purpose. The step's own state carries the tense — a
 * done step is ticked, so "Asking Jarvis" reads as asked — and a label that
 * changed wording between states would be a second thing to keep in sync.
 */
export const THESIS_STEP_LABELS: Record<ThesisStep, string> = {
  budget: "Checking your budget",
  resolve: "Resolving the name",
  generate: "Asking Jarvis",
  parse: "Reading the answer",
  save: "Saving your thesis",
};

export type ThesisCreated = {
  thesis: Thesis;
  stockSuggestions: unknown[];
  duplicateWarning: { existingThesisId: string; status: string; createdAt: string } | null;
};

/**
 * One line of the response body.
 *
 * `detail` is the step's own evidence — the symbol that actually priced, the
 * mode the answer parsed as — and is null when a step has nothing to add. It is
 * the part that makes this worth more than a spinner: "Resolving the name"
 * repeated on every run says nothing, "HAL on NSE · ₹4,512" says the thing the
 * trader would otherwise have to open the thesis to check.
 */
export type ThesisProgressEvent =
  | { kind: "step"; step: ThesisStep; status: "active" | "done"; detail: string | null }
  | { kind: "done"; payload: ThesisCreated }
  | { kind: "failed"; error: string };

/**
 * Reads one line into an event, or null when it is not one.
 *
 * Tolerant on purpose, in the same spirit as the `.catch` fallbacks on every
 * model-output schema in this app: a line this build does not understand — a
 * step added by a newer deployment, a blank line, a proxy's keep-alive — must
 * cost that line and nothing else. The run is still in flight and its result is
 * still coming; throwing here would lose a thesis that the server went on to
 * save anyway.
 */
export function parseProgressLine(line: string): ThesisProgressEvent | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (o.kind === "step") {
    const step = o.step;
    const status = o.status;
    if (typeof step !== "string" || !(THESIS_STEPS as readonly string[]).includes(step)) return null;
    if (status !== "active" && status !== "done") return null;
    return {
      kind: "step",
      step: step as ThesisStep,
      status,
      detail: typeof o.detail === "string" && o.detail !== "" ? o.detail : null,
    };
  }

  if (o.kind === "done") {
    const payload = o.payload as ThesisCreated | undefined;
    if (!payload || typeof payload.thesis?.id !== "string") return null;
    return { kind: "done", payload };
  }

  if (o.kind === "failed") {
    return { kind: "failed", error: typeof o.error === "string" ? o.error : "The run failed." };
  }

  return null;
}

/**
 * Streams a response body as events, newest first out of the reader.
 *
 * Chunk boundaries are not line boundaries — a single read can end mid-object,
 * or carry three objects at once — so the tail is buffered rather than parsed.
 * Getting this wrong shows up as a step that never lights and a `done` that
 * never arrives, on exactly the slow runs this feature exists for.
 */
export async function* readProgress(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<ThesisProgressEvent> {
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const event = parseProgressLine(line);
        if (event) yield event;
        newline = buffer.indexOf("\n");
      }
    }

    // A body that ended without a trailing newline still has one event in it.
    const last = parseProgressLine(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}
