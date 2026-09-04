import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { PortfolioUpdate } from "@/lib/types";

/**
 * Rename, re-label or delete one book (0027).
 *
 * RLS makes somebody else's portfolio invisible rather than forbidden, so "not
 * yours" and "does not exist" are the same 404 throughout — the answer that
 * leaks the least.
 */

const UpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Give the portfolio a name.").max(60).optional(),
    ownership: z.enum(["owned", "managed"]).optional(),
    beneficiary_name: z
      .string()
      .trim()
      .max(60)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    base_currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code.")
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const json = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }

  const patch: PortfolioUpdate = { ...parsed.data };
  if (patch.base_currency) patch.base_currency = patch.base_currency.toUpperCase();
  // Turning a managed book back into the trader's own money leaves no
  // beneficiary behind it. Clearing it here rather than trusting the client to
  // send both fields keeps the two from disagreeing.
  if (patch.ownership === "owned") patch.beneficiary_name = null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolios")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }
  return NextResponse.json({ portfolio: data });
}

/**
 * Deletes a book, and refuses when it still holds anything the trader wrote.
 *
 * This is the plain-English form of a constraint that exists either way: 0027's
 * foreign keys from `positions` and `scratchpad_notes` are deferred rather than
 * cascading, so the database would refuse this too — but it would refuse it as
 * a foreign-key violation at commit, which tells a trader nothing. Counting
 * first turns that into a sentence naming what is in the way.
 *
 * The Council reports, pattern reads and import batches DO cascade, and are not
 * counted here. They are statements about a book; once the book is gone they
 * are dangling references rather than history.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: portfolio, error: readError } = await supabase
    .from("portfolios")
    .select("id, is_default")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (!portfolio) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }
  if (portfolio.is_default) {
    return NextResponse.json(
      {
        error:
          "This is your default portfolio — it is where a link with no portfolio in it lands. Make another one the default first.",
      },
      { status: 400 },
    );
  }

  const [{ count: positionCount, error: positionError }, { count: noteCount, error: noteError }] =
    await Promise.all([
      supabase
        .from("positions")
        .select("id", { count: "exact", head: true })
        .eq("portfolio_id", id),
      supabase
        .from("scratchpad_notes")
        .select("id", { count: "exact", head: true })
        .eq("portfolio_id", id),
    ]);
  if (positionError || noteError) {
    return NextResponse.json(
      { error: positionError?.message ?? noteError?.message ?? "Could not read the portfolio." },
      { status: 500 },
    );
  }

  const blocking: string[] = [];
  if (positionCount) blocking.push(`${positionCount} position${positionCount === 1 ? "" : "s"}`);
  if (noteCount) blocking.push(`${noteCount} note${noteCount === 1 ? "" : "s"}`);
  if (blocking.length > 0) {
    return NextResponse.json(
      {
        error: `This portfolio still holds ${blocking.join(" and ")}. Deleting it would take that history with it, so move or close them first.`,
      },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("portfolios").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
