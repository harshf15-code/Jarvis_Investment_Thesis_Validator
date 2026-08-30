import { createClient } from "@/lib/supabase/server";
import type { LlmBudgetStatus } from "@/lib/types";

/**
 * The pre-flight spend check every LLM route runs before it spends anything.
 *
 * Sign-up is open and every model call is billed to one `OPENROUTER_API_KEY`,
 * so without this an account can spend without bound. The check is deliberately
 * ONCE PER REQUEST, not once per call: the Council's N opinions run
 * concurrently by design, and serialising them behind a budget query would
 * trade the feature's only latency win for a bound the 7-member panel cap
 * already provides. The overshoot is one request's worth of calls.
 */

/**
 * Defaults when an account has no `llm_budgets` row, which is every account by
 * default.
 *
 * A missing or unparseable env var falls back to these numbers rather than to
 * "unlimited". Failing open would mean one forgotten variable in a hosting
 * dashboard silently disarms the guard, and nothing in the UI would say so.
 */
const DEFAULT_DAILY_USD = 1;
const DEFAULT_MONTHLY_USD = 10;

function envBudget(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type BudgetVerdict =
  | { ok: true; status: LlmBudgetStatus }
  | { ok: false; message: string; window: "daily" | "monthly" }
  /**
   * Spend could not be read at all. Distinct from "over budget": nothing is
   * known, so nothing may be spent.
   */
  | { ok: false; message: string; window: "unavailable" };

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Resolves the two limits for a status row. `has_override` distinguishes "this
 * account has a row saying null, meaning unlimited" from "this account has no
 * row, so the env defaults apply" — a distinction the database cannot make,
 * because it does not know the env.
 */
export function limitsFor(status: LlmBudgetStatus): {
  daily: number | null;
  monthly: number | null;
} {
  if (!status.has_override) {
    return {
      daily: envBudget("LLM_DAILY_BUDGET_USD", DEFAULT_DAILY_USD),
      monthly: envBudget("LLM_MONTHLY_BUDGET_USD", DEFAULT_MONTHLY_USD),
    };
  }
  return { daily: status.daily_limit, monthly: status.monthly_limit };
}

export function evaluateBudget(status: LlmBudgetStatus): BudgetVerdict {
  const limits = limitsFor(status);

  if (limits.daily !== null && status.daily_spent >= limits.daily) {
    return {
      ok: false,
      window: "daily",
      message: `You've used ${money(status.daily_spent)} of your ${money(
        limits.daily,
      )} daily analysis budget. It resets at midnight UTC.`,
    };
  }
  if (limits.monthly !== null && status.monthly_spent >= limits.monthly) {
    return {
      ok: false,
      window: "monthly",
      message: `You've used ${money(status.monthly_spent)} of your ${money(
        limits.monthly,
      )} monthly analysis budget. It resets on the 1st.`,
    };
  }
  return { ok: true, status };
}

/**
 * Reads this session's spend and decides whether it may spend more.
 *
 * Runs through the user's own client, and `llm_budget_status()` takes no
 * argument — it answers only for `auth.uid()`, so this cannot be pointed at
 * another account.
 *
 * FAILS CLOSED. An earlier version allowed the call when the read failed, on
 * the grounds that a transient database hiccup should not block every analysis.
 * That was the wrong default for a spend guard: an RPC that fails for a
 * structural reason — a permission change, an unapplied migration — silently
 * removes the cap entirely, and nothing surfaces that it has gone. It also
 * bought very little, since a database that cannot answer this query cannot
 * serve the rest of the request either.
 */
export async function checkBudget(): Promise<BudgetVerdict> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("llm_budget_status");
  const status = data?.[0];
  if (error || !status) {
    return {
      ok: false,
      window: "unavailable",
      message: "Couldn't check your analysis budget just now — try again in a moment.",
    };
  }
  return evaluateBudget({
    ...status,
    daily_spent: Number(status.daily_spent),
    monthly_spent: Number(status.monthly_spent),
    daily_limit: status.daily_limit === null ? null : Number(status.daily_limit),
    monthly_limit: status.monthly_limit === null ? null : Number(status.monthly_limit),
  });
}
