import { describe, expect, it } from "vitest";

import {
  THESIS_STEPS,
  THESIS_STEP_LABELS,
  parseProgressLine,
  readProgress,
  type ThesisProgressEvent,
} from "@/lib/thesis-progress";

const line = (o: unknown) => JSON.stringify(o);

/** A body split at the given byte offsets, to model real chunk boundaries. */
function streamOf(text: string, cuts: number[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const bounds = [0, ...cuts, bytes.length];
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bounds.length - 1; i++) {
        controller.enqueue(bytes.slice(bounds[i], bounds[i + 1]));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array> | null): Promise<ThesisProgressEvent[]> {
  const out: ThesisProgressEvent[] = [];
  for await (const e of readProgress(stream)) out.push(e);
  return out;
}

describe("THESIS_STEPS", () => {
  it("labels every step, so the panel cannot render a blank row", () => {
    for (const step of THESIS_STEPS) {
      expect(THESIS_STEP_LABELS[step]).toBeTruthy();
    }
  });
});

describe("parseProgressLine", () => {
  it("reads a step event, with and without a detail", () => {
    expect(parseProgressLine(line({ kind: "step", step: "generate", status: "active" }))).toEqual({
      kind: "step",
      step: "generate",
      status: "active",
      detail: null,
    });
    expect(
      parseProgressLine(
        line({ kind: "step", step: "resolve", status: "done", detail: "HAL on NSE · ₹4,512" }),
      ),
    ).toEqual({ kind: "step", step: "resolve", status: "done", detail: "HAL on NSE · ₹4,512" });
  });

  it("treats an empty detail as no detail", () => {
    // Otherwise the panel renders a stray mono span with nothing in it.
    const out = parseProgressLine(line({ kind: "step", step: "save", status: "done", detail: "" }));
    expect(out).toMatchObject({ detail: null });
  });

  it("reads the terminal events", () => {
    const payload = { thesis: { id: "t-1" }, stockSuggestions: [], duplicateWarning: null };
    expect(parseProgressLine(line({ kind: "done", payload }))).toMatchObject({ kind: "done" });
    expect(parseProgressLine(line({ kind: "failed", error: "boom" }))).toEqual({
      kind: "failed",
      error: "boom",
    });
  });

  it("costs one line, not the run, when a line is not understood", () => {
    // A newer deployment's extra step, a proxy keep-alive, a truncated write:
    // the result is still coming and throwing here would lose it.
    expect(parseProgressLine("")).toBeNull();
    expect(parseProgressLine("   ")).toBeNull();
    expect(parseProgressLine("not json")).toBeNull();
    expect(parseProgressLine("null")).toBeNull();
    expect(parseProgressLine(line({ kind: "step", step: "reticulating", status: "active" }))).toBeNull();
    expect(parseProgressLine(line({ kind: "step", step: "save", status: "halfway" }))).toBeNull();
    expect(parseProgressLine(line({ kind: "wat" }))).toBeNull();
  });

  it("refuses a done event with no thesis id, which the caller would deref", () => {
    expect(parseProgressLine(line({ kind: "done", payload: { thesis: {} } }))).toBeNull();
    expect(parseProgressLine(line({ kind: "done" }))).toBeNull();
  });

  it("still names the failure when the error field is missing", () => {
    expect(parseProgressLine(line({ kind: "failed" }))).toEqual({
      kind: "failed",
      error: "The run failed.",
    });
  });
});

describe("readProgress", () => {
  const body =
    [
      line({ kind: "step", step: "budget", status: "done" }),
      line({ kind: "step", step: "resolve", status: "active" }),
      line({ kind: "step", step: "resolve", status: "done", detail: "HAL on NSE" }),
      line({
        kind: "done",
        payload: { thesis: { id: "t-1" }, stockSuggestions: [], duplicateWarning: null },
      }),
    ].join("\n") + "\n";

  it("yields every event in order", async () => {
    const out = await collect(streamOf(body, []));
    expect(out.map((e) => e.kind)).toEqual(["step", "step", "step", "done"]);
    expect(out[2]).toMatchObject({ detail: "HAL on NSE" });
  });

  it("survives chunks that split a line down the middle", async () => {
    // The failure this guards against is silent: a mis-buffered reader shows a
    // step that never lights and a `done` that never arrives, on exactly the
    // slow runs this feature exists for.
    const cuts = [7, 31, 64, 90, 140, 190];
    const out = await collect(streamOf(body, cuts.filter((c) => c < body.length)));
    expect(out.map((e) => e.kind)).toEqual(["step", "step", "step", "done"]);
  });

  it("splits a multibyte character across a chunk boundary without mangling it", async () => {
    const one = line({ kind: "step", step: "resolve", status: "done", detail: "₹4,512" }) + "\n";
    const bytes = new TextEncoder().encode(one);
    // Cut inside the three-byte ₹.
    const rupee = bytes.indexOf(0xe2);
    expect(rupee).toBeGreaterThan(-1);
    const out = await collect(streamOf(one, [rupee + 1]));
    expect(out[0]).toMatchObject({ detail: "₹4,512" });
  });

  it("reads a final line that has no trailing newline", async () => {
    const out = await collect(streamOf(body.trimEnd(), []));
    expect(out.at(-1)?.kind).toBe("done");
  });

  it("skips junk lines and keeps the rest of the run", async () => {
    const noisy = ["", "keep-alive", line({ kind: "step", step: "save", status: "done" })].join("\n");
    const out = await collect(streamOf(noisy, []));
    expect(out).toEqual([{ kind: "step", step: "save", status: "done", detail: null }]);
  });

  it("yields nothing for a body that never arrived", async () => {
    expect(await collect(null)).toEqual([]);
  });
});
