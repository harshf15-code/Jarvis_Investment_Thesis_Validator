import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { listPortfoliosEnsuringDefault } from "@/lib/portfolio/active";
import { MAX_PORTFOLIOS, PORTFOLIO_CAP_MESSAGE } from "@/lib/portfolio/limits";
import { createClient } from "@/lib/supabase/server";

/**
 * The trader's books (0027).
 *
 * No model call, so no `maxDuration` and no budget check.
 */

const CreateSchema = z.object({
  name: z.string().trim().min(1, "Give the portfolio a name.").max(60),
  ownership: z.enum(["owned", "managed"]).default("owned"),
  beneficiary_name: z
    .string()
    .trim()
    .max(60)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  base_currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code.")
    .default("INR"),
});

/**
 * Every book this trader has, default first — creating the default when there
 * are none. See `listPortfoliosEnsuringDefault`, which the server-rendered
 * pages share so both entry points agree about what a new account has.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const supabase = await createClient();
  try {
    return NextResponse.json({ portfolios: await listPortfoliosEnsuringDefault(supabase) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read your portfolios." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // Checked here so the trader gets a sentence; the `portfolios_cap` trigger in
  // 0027 is what actually enforces it, and still would if this check were
  // removed or raced past.
  const { count, error: countError } = await supabase
    .from("portfolios")
    .select("id", { count: "exact", head: true });
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_PORTFOLIOS) {
    return NextResponse.json({ error: PORTFOLIO_CAP_MESSAGE }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("portfolios")
    .insert({
      name: parsed.data.name,
      ownership: parsed.data.ownership,
      // Only meaningful on a managed book, and dropped rather than stored on an
      // owned one — a beneficiary on a book that has none is a claim nothing
      // renders and nothing would ever correct.
      beneficiary_name: parsed.data.ownership === "managed" ? parsed.data.beneficiary_name : null,
      base_currency: parsed.data.base_currency.toUpperCase(),
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ portfolio: data }, { status: 201 });
}
