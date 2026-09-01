import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import {
  buildExitPlanUserContext,
  diffExitPlan,
  parseExitPlanProposal,
  sanitizeExitPlanGeometry,
  validateApprovedLevels,
  EXIT_PLAN_SYSTEM_PROMPT,
  type ExitPlanLevels,
} from "@/lib/exit-plan";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { loadHoldingContext, type HoldingContext } from "@/lib/portfolio/holding-review";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";

/**
 * The exit plan for a holding that arrived from a CSV.
 *
 * POST proposes and writes NOTHING. PATCH commits what the trader approved.
 * Two calls rather than one because the whole point is that a number nobody
 * looked at never reaches `trade_plans` — a plan built and saved in one step is
 * an auto-fill with extra latency.
 */
export const maxDuration = 60;

const JARVIS_SOURCE_REFUSAL =
  "This position came from a Jarvis thesis, which already has a trade plan behind it. Edit that plan instead — rebuilding it from a one-line rationale would throw away the memorandum the numbers came from.";

const NO_RATIONALE_REFUSAL =
  "Add why you own this first. Without a stated reason there is nothing to anchor a stop to, and a level invented from a price alone is a number pretending to be a plan.";

type Guarded =
  | { ok: true; context: HoldingContext }
  | { ok: false; response: NextResponse };

/**
 * Load the holding and refuse anything this feature must not touch.
 *
 * RLS answers for someone else's position by returning nothing, which surfaces
 * as `not_found` and therefore 404 — the absence must not become a 403 that
 * confirms the row exists.
 */
async function guardedContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  positionId: string,
): Promise<Guarded> {
  const loaded = await loadHoldingContext({ supabase, userId, positionId });
  if (!loaded.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: loaded.error },
        { status: loaded.kind === "not_found" ? 404 : 500 },
      ),
    };
  }
  if (loaded.context.thesis?.source !== "imported") {
    return { ok: false, response: NextResponse.json({ error: JARVIS_SOURCE_REFUSAL }, { status: 400 }) };
  }
  return { ok: true, context: loaded.context };
}

/* ------------------------------------------------------------------------- *
 * POST — propose. Writes nothing.
 * ------------------------------------------------------------------------- */

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Before the holding is even loaded, so an over-budget account costs nothing
  // at all — not a Yahoo round trip, not a database fan-out.
  const budget = await checkBudget();
  if (!budget.ok) {
    const status = budget.window === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: budget.message }, { status });
  }

  // The user's own client: RLS is what makes `id` safe to take from the URL.
  const supabase = await createClient();
  const guard = await guardedContext(supabase, user.id, id);
  if (!guard.ok) return guard.response;
  const ctx = guard.context;

  if (ctx.rationale === null) {
    return NextResponse.json({ error: NO_RATIONALE_REFUSAL }, { status: 400 });
  }
  if (ctx.price === null) {
    // Every level this proposes is defined relative to the current price. With
    // no price there is nothing to be below or above, and a stop guessed off a
    // months-old average cost is worse than no stop.
    return NextResponse.json(
      { error: `${ctx.position.ticker} has no current price right now, so there is nothing to set levels against. Try again once it prices.` },
      { status: 400 },
    );
  }

  let raw: string;
  try {
    const result = await meteredGenerateText({
      userId: user.id,
      feature: "imported_exit_plan",
      // Unlike the portfolio Council, this call is about exactly one thesis, so
      // the ledger can attribute its cost to that holding.
      thesisId: ctx.position.thesis_id,
      system: EXIT_PLAN_SYSTEM_PROMPT,
      prompt: buildExitPlanUserContext({
        ticker: ctx.position.ticker,
        companyName: null,
        currency: ctx.stock.currency,
        quantity: ctx.remaining,
        averagePrice: ctx.weightedAverage.averagePrice,
        currentPrice: ctx.price,
        rationale: ctx.rationale,
        objective: ctx.objective,
        heldSince: ctx.heldSince,
        fundamentals: ctx.observed.fundamentals,
      }),
    });
    raw = result.text;
  } catch (err) {
    return NextResponse.json(
      { error: `Jarvis could not build a plan: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const parsed = parseExitPlanProposal(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 500 });

  const proposal = sanitizeExitPlanGeometry(parsed.data, ctx.price);

  // 200, not 201: the trader has been shown a proposal, not given a plan.
  return NextResponse.json({
    proposal,
    currentPrice: ctx.price,
    currency: ctx.stock.currency,
    averagePrice: ctx.weightedAverage.averagePrice,
    quantity: ctx.remaining,
  });
}

/* ------------------------------------------------------------------------- *
 * PATCH — commit what the trader approved.
 * ------------------------------------------------------------------------- */

const LevelsSchema = z
  .object({
    stop_loss: z.number().nullable(),
    target_1: z.number().nullable(),
    target_2: z.number().nullable(),
    time_exit_date: z.string().nullable(),
    time_exit_condition: z.string().nullable(),
  })
  .strict();

const CommitSchema = z
  .object({
    /** What the trader is saving. */
    approved: LevelsSchema,
    /**
     * What Jarvis originally proposed, echoed back so `ai_suggested` and
     * `edited_fields` can be written in the same statement as the levels.
     *
     * It comes from the client and could be forged. The only thing that buys
     * anyone is a wrong "edited" marker on their own row — no other account is
     * reachable and nothing about the saved levels changes — which is not worth
     * a server-side proposal cache to prevent.
     */
    proposed: LevelsSchema,
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = CommitSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const approved: ExitPlanLevels = parsed.data.approved;
  const proposed: ExitPlanLevels = parsed.data.proposed;

  const supabase = await createClient();

  // Deliberately NOT `loadHoldingContext`: this path needs the owner, the
  // source and a price, and that loader also pulls a fresh fundamentals
  // snapshot from Yahoo. Saving numbers the trader is already looking at should
  // not wait on the network for data nobody here reads.
  const { data: position, error: positionError } = await supabase
    .from("positions")
    .select("trade_plan_id, thesis_id, stock_id")
    .eq("id", id)
    .maybeSingle();
  if (positionError) return NextResponse.json({ error: positionError.message }, { status: 500 });
  // RLS answers for someone else's position by returning nothing. It must keep
  // reading as absent rather than becoming a 403 that confirms it exists.
  if (!position) return NextResponse.json({ error: "Position not found" }, { status: 404 });

  const [thesisRes, stockRes] = await Promise.all([
    supabase.from("theses").select("source").eq("id", position.thesis_id).maybeSingle(),
    supabase.from("stocks").select("last_price").eq("id", position.stock_id).maybeSingle(),
  ]);
  if (thesisRes.error) return NextResponse.json({ error: thesisRes.error.message }, { status: 500 });
  if (stockRes.error) return NextResponse.json({ error: stockRes.error.message }, { status: 500 });
  if (!thesisRes.data) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  if (thesisRes.data.source !== "imported") {
    return NextResponse.json({ error: JARVIS_SOURCE_REFUSAL }, { status: 400 });
  }

  /**
   * The trader's own numbers are REFUSED when they do not hold together, never
   * silently dropped. Nulling a level somebody deliberately typed would save
   * successfully, lose the number, and say nothing about why.
   *
   * Checked against the CACHED `stocks.last_price` rather than a fresh quote,
   * and that is the point rather than a shortcut: `poll-prices` evaluates a
   * breach against exactly this number, so validating against it means the two
   * can never disagree. A stop this accepts is one the watch will not
   * immediately fire on, and a stop it refuses is one the watch WOULD have
   * fired on. A fresher price from a second Yahoo round trip would be a
   * different number from the one that actually raises the alert.
   */
  const valid = validateApprovedLevels(approved, stockRes.data?.last_price ?? null);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

  const { data: tradePlan, error: updateError } = await supabase
    .from("trade_plans")
    .update({
      ...approved,
      ai_suggested: proposed as unknown as Json,
      edited_fields: diffExitPlan(proposed, approved),
      updated_at: new Date().toISOString(),
    })
    .eq("id", position.trade_plan_id)
    .select("*")
    .single();

  if (updateError || !tradePlan) {
    return NextResponse.json(
      { error: updateError?.message ?? "Could not save those levels" },
      { status: 500 },
    );
  }
  return NextResponse.json({ tradePlan });
}
