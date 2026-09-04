import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ThesisUpdate } from "@/lib/types";

/**
 * The thesis-detail read path: the thesis itself, its single trade plan (if
 * one has been locked yet), and the linked stock's price snapshot. `stock` is
 * `null` for a Macro Thesis, which has no `stock_id`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: thesis, error } = await supabase.from("theses").select("*").eq("id", id).single();
  if (error || !thesis) {
    return NextResponse.json({ error: error?.message ?? "Thesis not found" }, { status: 404 });
  }

  const { data: tradePlan } = await supabase
    .from("trade_plans")
    .select("*")
    .eq("thesis_id", id)
    .maybeSingle();

  const { data: stock } = thesis.stock_id
    ? await supabase
        .from("stocks")
        .select("exchange, last_price, last_price_at")
        .eq("id", thesis.stock_id)
        .single()
    : { data: null };

  return NextResponse.json({ thesis, tradePlan: tradePlan ?? null, stock: stock ?? null });
}

const UpdateThesisSchema = z.object({
  status: z.enum(["draft", "active", "closed", "macro"]).optional(),
  bear_cases: z
    .array(z.object({ reason: z.string(), counter: z.string(), modified: z.boolean() }))
    .optional(),
  conviction_score: z.number().min(0).max(100).optional(),
  /**
   * "Why I own this", for a holding that arrived from a CSV.
   *
   * Accepted ONLY on an imported thesis, and the check is server-side below.
   * A Jarvis thesis's `input_text` is the prompt every downstream artefact was
   * generated from — the extraction, the bear cases, the memorandum, the
   * conviction score. Editing it later would leave all of those silently
   * describing a thesis that no longer exists, which is worse than not being
   * able to edit it at all. An imported thesis has no such artefacts: its
   * input_text is a placeholder or the trader's own note, and nothing has been
   * derived from it.
   */
  input_text: z.string().trim().min(1).max(2000).optional(),
  /**
   * Resolves a macro thesis onto one of its bake-off candidates. The client
   * sends only the candidate id; `ticker` and `stock_id` are copied from that
   * row server-side rather than trusted from the request, so the thesis can
   * never end up pointing at a ticker the bake-off never actually priced.
   */
  selected_candidate_id: z.string().uuid().nullable().optional(),
  /**
   * The trader's own name for this idea (0028).
   *
   * Editable on ANY thesis, unlike `input_text` above — and for the opposite
   * reason. `input_text` is what every downstream artefact was generated from,
   * so rewriting it would leave the extraction, the bear cases and the
   * memorandum describing a thesis that no longer exists. A title is a label.
   * Nothing is derived from it, so renaming costs nothing and the trader's word
   * for their own idea should win.
   */
  title: z.string().trim().min(1, "Give it a name, or leave the old one.").max(80).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = UpdateThesisSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = await createClient();

  // `input_text` is editable on imported holdings only — see the schema note.
  // Read through the user client so RLS answers "not found" for someone else's
  // thesis rather than leaking that it exists.
  if (parsed.data.input_text !== undefined) {
    const { data: owned, error: sourceError } = await supabase
      .from("theses")
      .select("source")
      .eq("id", id)
      .maybeSingle();
    if (sourceError) {
      return NextResponse.json({ error: sourceError.message }, { status: 500 });
    }
    if (!owned) {
      return NextResponse.json({ error: "Thesis not found" }, { status: 404 });
    }
    if (owned.source !== "imported") {
      return NextResponse.json(
        {
          error:
            "This thesis was written with Jarvis, so its text is what the analysis was built from and cannot be rewritten. Only an imported holding's reason can be edited.",
        },
        { status: 400 },
      );
    }
  }

  const { selected_candidate_id, ...rest } = parsed.data;
  const patch: ThesisUpdate = { ...rest };

  // Set here rather than accepted from the client: the flag means "a human
  // chose this", and a client that could set it could also clear it — which
  // would let a later re-run silently overwrite a name the trader picked.
  if (rest.title !== undefined) patch.title_edited = true;

  if (selected_candidate_id !== undefined) {
    patch.selected_candidate_id = selected_candidate_id;
    if (selected_candidate_id === null) {
      patch.ticker = null;
      patch.stock_id = null;
    } else {
      const { data: candidate, error: candidateError } = await supabase
        .from("thesis_candidates")
        .select("ticker, stock_id, thesis_id")
        .eq("id", selected_candidate_id)
        .single();
      if (candidateError || !candidate) {
        return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
      }
      if (candidate.thesis_id !== id) {
        return NextResponse.json(
          { error: "Candidate belongs to a different thesis" },
          { status: 400 },
        );
      }
      patch.ticker = candidate.ticker;
      patch.stock_id = candidate.stock_id;
    }
  }

  const { data: thesis, error } = await supabase
    .from("theses")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !thesis) {
    return NextResponse.json({ error: error?.message ?? "Thesis not found" }, { status: 404 });
  }
  return NextResponse.json({ thesis });
}
