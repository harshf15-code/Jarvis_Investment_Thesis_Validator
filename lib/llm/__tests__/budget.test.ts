import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkBudget } from "@/lib/llm/budget";

const UNDER = [
  { daily_spent: "0.01", monthly_spent: "0.05", daily_limit: null, monthly_limit: null, has_override: false },
];

function rpcMock(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

describe("checkBudget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks for the caller's own spend when given no user", async () => {
    const user = rpcMock({ data: UNDER, error: null });
    vi.mocked(createClient).mockResolvedValue(user as never);

    expect((await checkBudget()).ok).toBe(true);
    expect(user.rpc).toHaveBeenCalledWith("llm_budget_status");
    // Never through the service role: a request must not be able to read
    // another account's spend.
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("names the user explicitly for a job that has no session", async () => {
    // `llm_budget_status()` reads auth.uid(), which is null under the service
    // role — so without this the scheduled watch would spend model calls on
    // every account's behalf while passing nobody's cap.
    const admin = rpcMock({ data: UNDER, error: null });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    expect((await checkBudget("user-9")).ok).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("llm_budget_status_for", { uid: "user-9" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("fails closed on both paths when the read errors", async () => {
    vi.mocked(createClient).mockResolvedValue(rpcMock({ data: null, error: { message: "boom" } }) as never);
    vi.mocked(createAdminClient).mockReturnValue(rpcMock({ data: null, error: { message: "boom" } }) as never);

    for (const verdict of [await checkBudget(), await checkBudget("user-9")]) {
      expect(verdict.ok).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.window).toBe("unavailable");
    }
  });

  it("refuses once the daily default is spent", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      rpcMock({
        data: [
          { daily_spent: "1.00", monthly_spent: "1.00", daily_limit: null, monthly_limit: null, has_override: false },
        ],
        error: null,
      }) as never,
    );

    const verdict = await checkBudget("user-9");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.window).toBe("daily");
  });
});
