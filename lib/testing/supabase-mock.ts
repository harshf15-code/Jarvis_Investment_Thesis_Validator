import { vi } from "vitest";

/**
 * A chainable stand-in for the Supabase query builder, for route tests.
 *
 * The hand-written mocks these replace assumed each read was `select()` plus
 * exactly one more call, which was true until portfolio scoping (0027) started
 * composing filters — `.select().eq().in()`, `.select().order().order()`. A mock
 * that only supports the shapes that existed when it was written fails on the
 * new ones for reasons that have nothing to do with what the test is checking.
 *
 * Every filter method returns the same object and the object is thenable, so a
 * chain of any length and order resolves to the rows registered for its table.
 * The filters are RECORDED rather than applied: a route test's job is to check
 * what the route does with rows, and a mock that re-implemented PostgREST's
 * filtering would be a second implementation to keep correct. Where a test does
 * care that a filter was applied — that a read was scoped to one book — it
 * asserts on `calls` directly.
 */

export type TableRows = Record<string, unknown[]>;

/** One recorded call: the table, the method, and its arguments. */
export type RecordedCall = { table: string; method: string; args: unknown[] };

export type SupabaseMock = {
  from: ReturnType<typeof vi.fn>;
  /** Every filter/order/limit call made, in order, for assertions. */
  calls: RecordedCall[];
  /** Filters recorded against one table, e.g. `filters("positions").portfolio_id`. */
  filters(table: string): Record<string, unknown>;
};

type Options = {
  /** Tables that should resolve with an error instead of rows. */
  errors?: Record<string, { message: string }>;
  /**
   * Tables whose reads must fail the test if they happen. A route that reads a
   * table nobody expected is exactly the bug these suites exist to catch.
   */
  strict?: boolean;
};

const TERMINAL = new Set(["single", "maybeSingle"]);

export function buildSupabaseMock(rows: TableRows, options: Options = {}): SupabaseMock {
  const calls: RecordedCall[] = [];

  function makeBuilder(table: string, forceSingle = false) {
    const settle = () => {
      const error = options.errors?.[table];
      if (error) return Promise.resolve({ data: null, error, count: null });
      const data = rows[table] ?? [];
      if (forceSingle) {
        return Promise.resolve({ data: data[0] ?? null, error: null, count: data.length });
      }
      return Promise.resolve({ data, error: null, count: data.length });
    };

    const builder: Record<string, unknown> = {};

    const chain = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        if (TERMINAL.has(method)) return makeBuilder(table, true);
        return builder;
      });

    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "lt",
      "gt",
      "gte",
      "lte",
      "order",
      "limit",
      "range",
      "insert",
      "update",
      "upsert",
      "delete",
      "single",
      "maybeSingle",
    ]) {
      builder[method] = chain(method);
    }

    // Thenable, so `await` on any point in the chain resolves the read. This is
    // what lets a route add a filter without every test having to know.
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      settle().then(resolve, reject);

    return builder;
  }

  return {
    calls,
    from: vi.fn((table: string) => {
      if (options.strict && !(table in rows) && !(table in (options.errors ?? {}))) {
        throw new Error(`Unexpected read of table "${table}"`);
      }
      return makeBuilder(table);
    }),
    filters(table: string) {
      const out: Record<string, unknown> = {};
      for (const call of calls) {
        if (call.table !== table) continue;
        if (call.method === "eq" || call.method === "in" || call.method === "is") {
          out[String(call.args[0])] = call.args[1];
        }
      }
      return out;
    },
  };
}

/** The one book most tests need, with sane defaults. */
export function fakePortfolio(over: Record<string, unknown> = {}) {
  return {
    id: "pf-1",
    user_id: "u1",
    created_at: "2026-01-01T00:00:00.000Z",
    name: "My Portfolio",
    ownership: "owned",
    beneficiary_name: null,
    base_currency: "INR",
    is_default: true,
    ...over,
  };
}
