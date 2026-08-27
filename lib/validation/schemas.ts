import { z } from "zod";

/**
 * zod schemas for the stocks API (`app/api/stocks/route.ts` and
 * `app/api/stocks/[id]/route.ts`). Mirrors `ExchangeCode`/`StockType` from
 * `lib/types.ts` (kept as separate zod enums here rather than derived from
 * the TS types, since zod needs its own runtime representation).
 */

export const ExchangeCodeSchema = z.enum(["NSE", "BSE", "US"]);

export const StockTypeSchema = z.enum(["watchlist", "holding"]);

/**
 * Holding-specific fields, shared by `AddTickerInputSchema`'s "holding"
 * branch and reused (as independently-optional fields) in
 * `UpdateStockInputSchema`.
 */
const sharesSchema = z.coerce
  .number({ error: "Shares is required" })
  .positive("Shares must be a positive number");

const costBasisSchema = z.coerce
  .number({ error: "Cost basis is required" })
  .positive("Cost basis must be a positive number");

// Date-only ISO string ("YYYY-MM-DD"), matching the `date` column type and
// what an `<input type="date">` submits.
const dateAcquiredSchema = z.iso.date("Date acquired must be a valid date");

/**
 * POST /api/stocks body. A discriminated union on `type`: the "holding"
 * branch requires `shares`/`cost_basis`/`date_acquired`; the "watchlist"
 * branch has no holding fields at all (extra fields are rejected by zod's
 * default strict-on-unrecognized-keys behavior within each branch object).
 */
export const AddTickerInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("watchlist"),
    ticker: z.string().trim().min(1, "Ticker is required"),
    exchange: ExchangeCodeSchema,
  }),
  z.object({
    type: z.literal("holding"),
    ticker: z.string().trim().min(1, "Ticker is required"),
    exchange: ExchangeCodeSchema,
    shares: sharesSchema,
    cost_basis: costBasisSchema,
    date_acquired: dateAcquiredSchema,
  }),
]);

export type AddTickerInput = z.infer<typeof AddTickerInputSchema>;

/**
 * PATCH /api/stocks/[id] body. Everything is independently optional (a
 * partial update), except: when `type: "holding"` is present in the same
 * request, the holding fields are required in it too (this is the "switch
 * TO holding" case — the route needs a complete holding row to insert).
 * Switching `type` to `"watchlist"`, or omitting `type` altogether to just
 * update holding fields on an already-a-holding stock, require no
 * additional fields here; the route handler enforces the "already a
 * holding" precondition for the latter case since that depends on current
 * DB state, not just the request body shape.
 *
 * `deleted_at` is included for completeness (a direct field update, same as
 * every other column) even though the dedicated soft-delete path is
 * `DELETE /api/stocks/[id]`, which sets it server-side without going
 * through client input.
 */
export const UpdateStockInputSchema = z
  .object({
    type: StockTypeSchema.optional(),
    shares: sharesSchema.optional(),
    cost_basis: costBasisSchema.optional(),
    date_acquired: dateAcquiredSchema.optional(),
    deleted_at: z.iso.datetime().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type !== "holding") {
      return;
    }
    if (data.shares === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["shares"],
        message: "Shares is required when switching to a holding",
      });
    }
    if (data.cost_basis === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["cost_basis"],
        message: "Cost basis is required when switching to a holding",
      });
    }
    if (data.date_acquired === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["date_acquired"],
        message: "Date acquired is required when switching to a holding",
      });
    }
  });

export type UpdateStockInput = z.infer<typeof UpdateStockInputSchema>;

/** POST /api/jarvis/run body. */
export const RunJarvisInputSchema = z.object({
  stockId: z.string().min(1, "stockId is required"),
});

export type RunJarvisInput = z.infer<typeof RunJarvisInputSchema>;

/**
 * PATCH /api/fundamentals/[stockId] body. Upserts one user-tracked
 * ("manual") metric by `metric_key` — this route never writes `source:
 * 'auto'` rows (those are pulled from Yahoo elsewhere), so the request body
 * only ever needs the key/value pair itself.
 */
export const UpsertFundamentalInputSchema = z.object({
  metric_key: z.string().trim().min(1, "metric_key is required"),
  metric_value: z.string().trim().min(1, "metric_value is required"),
});

export type UpsertFundamentalInput = z.infer<
  typeof UpsertFundamentalInputSchema
>;
