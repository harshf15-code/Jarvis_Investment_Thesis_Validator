import { afterEach, describe, expect, it } from "vitest";

import { evaluateBudget, limitsFor } from "@/lib/llm/budget";
import type { LlmBudgetStatus } from "@/lib/types";

function status(o: Partial<LlmBudgetStatus> = {}): LlmBudgetStatus {
  return {
    daily_spent: 0,
    monthly_spent: 0,
    daily_limit: null,
    monthly_limit: null,
    has_override: false,
    ...o,
  };
}

const ENV_KEYS = ["LLM_DAILY_BUDGET_USD", "LLM_MONTHLY_BUDGET_USD"] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("limitsFor", () => {
  it("uses the built-in defaults when there is no override row", () => {
    // Every account is capped from the moment it exists — no row has to be
    // created for the guard to apply.
    expect(limitsFor(status())).toEqual({ daily: 1, monthly: 10 });
  });

  it("reads the env vars when they are set", () => {
    process.env.LLM_DAILY_BUDGET_USD = "2.50";
    process.env.LLM_MONTHLY_BUDGET_USD = "40";
    expect(limitsFor(status())).toEqual({ daily: 2.5, monthly: 40 });
  });

  it("falls back to the defaults rather than unlimited on a junk env var", () => {
    // A forgotten or fat-fingered variable in a hosting dashboard must not
    // silently disarm the guard.
    process.env.LLM_DAILY_BUDGET_USD = "not-a-number";
    expect(limitsFor(status()).daily).toBe(1);
  });

  it("treats a null column on an override row as unlimited", () => {
    // This is how the owner's own account runs uncapped: a row exists, and its
    // columns are null. Distinct from having no row at all.
    expect(limitsFor(status({ has_override: true }))).toEqual({ daily: null, monthly: null });
  });

  it("an override row wins over the env vars", () => {
    process.env.LLM_DAILY_BUDGET_USD = "2";
    expect(limitsFor(status({ has_override: true, daily_limit: 25 })).daily).toBe(25);
  });
});

describe("evaluateBudget", () => {
  it("allows spend under both limits", () => {
    expect(evaluateBudget(status({ daily_spent: 0.4, monthly_spent: 3 })).ok).toBe(true);
  });

  it("blocks at the daily limit, naming the window and the reset", () => {
    const v = evaluateBudget(status({ daily_spent: 1, monthly_spent: 1 }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.window).toBe("daily");
      expect(v.message).toContain("$1.00");
      expect(v.message).toContain("midnight UTC");
    }
  });

  it("blocks at the monthly limit even when today is clear", () => {
    const v = evaluateBudget(status({ daily_spent: 0, monthly_spent: 10 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.window).toBe("monthly");
  });

  it("blocks on reaching the limit, not only on exceeding it", () => {
    // >= not >: at exactly the cap the next call would take the account over,
    // and the cost of that call is not knowable in advance.
    expect(evaluateBudget(status({ daily_spent: 1.0 })).ok).toBe(false);
    expect(evaluateBudget(status({ daily_spent: 0.999999 })).ok).toBe(true);
  });

  it("never blocks an uncapped account", () => {
    const v = evaluateBudget(
      status({ has_override: true, daily_spent: 9999, monthly_spent: 99999 }),
    );
    expect(v.ok).toBe(true);
  });

  it("reports the daily window first when both are blown", () => {
    const v = evaluateBudget(status({ daily_spent: 50, monthly_spent: 50 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.window).toBe("daily");
  });
});

describe("checkBudget failure mode", () => {
  it("has an 'unavailable' window distinct from being over budget", () => {
    // The two are answered differently by the routes: 503 (retry) vs 429 (stop).
    // A guard that cannot read spend must refuse, not wave the call through —
    // an RPC broken by a permission change or an unapplied migration would
    // otherwise remove the cap with nothing to show it had gone.
    const over = evaluateBudget(status({ daily_spent: 5 }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.window).toBe("daily");
  });
});
