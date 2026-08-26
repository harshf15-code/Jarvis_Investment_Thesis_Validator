/**
 * Minimal fake for the subset of the `@supabase/supabase-js` chainable
 * query-builder API the stocks routes use (`from().insert().select().eq()
 * .is().in().order().single().maybeSingle().update().upsert().delete()`).
 *
 * Every chain method just records the call and returns the same builder
 * object; the builder is itself "thenable" (implements `.then`), so
 * `await`-ing it at whatever point the route code stops chaining resolves
 * to the next queued response, in call order. This mirrors how the route
 * handlers actually use the client — each one awaits a fixed, known
 * sequence of `supabase.from(...)` chains per code path — without needing
 * to model postgrest-js's real chain semantics.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

export type MockResponse<T = unknown> = {
  data: T;
  error: { message: string; code?: string } | null;
};

export type RecordedCall = {
  table: string;
  method: string;
  args: unknown[];
};

export function createMockSupabase(responses: MockResponse[]) {
  const calls: RecordedCall[] = [];
  let responseIndex = 0;

  function makeBuilder(table: string) {
    const methodNames = [
      "insert",
      "select",
      "update",
      "delete",
      "upsert",
      "eq",
      "in",
      "is",
      "order",
      "single",
      "maybeSingle",
    ] as const;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const method of methodNames) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.then = (
      onFulfilled?: (value: MockResponse) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => {
      const response = responses[responseIndex] ?? { data: null, error: null };
      responseIndex += 1;
      return Promise.resolve(response).then(onFulfilled, onRejected);
    };
    return builder;
  }

  const client = {
    from: (table: string) => {
      calls.push({ table, method: "from", args: [] });
      return makeBuilder(table);
    },
  };

  // Cast rather than shaping this to structurally satisfy the real
  // `SupabaseClient` class (which carries a long list of protected fields
  // — `auth`, `realtime`, `storage`, etc. — this fake never needs): the
  // route handlers under test only ever call `.from(...)`, so this is the
  // full surface that matters for them.
  return {
    client: client as unknown as SupabaseClient<Database>,
    calls,
  };
}

export function ok<T>(data: T): MockResponse<T> {
  return { data, error: null };
}

export function fail(message: string, code?: string): MockResponse<null> {
  return { data: null, error: { message, code } };
}

/** Number of `.from(table, ...)` calls with the given method recorded. */
export function callsFor(
  calls: RecordedCall[],
  table: string,
  method: string,
): RecordedCall[] {
  return calls.filter((call) => call.table === table && call.method === method);
}
