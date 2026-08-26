/**
 * Canonical TypeScript types mirroring `supabase/migrations/0001_init.sql` and
 * `0002_indexes.sql` exactly. This is the single source of truth for
 * stock/holding/analysis/alert shapes — every later task (API routes, the
 * Jarvis LLM integration, the dashboard, the Edge Functions' Deno-side
 * reimplementation) should import from here rather than redefining these
 * shapes locally.
 *
 * Column -> field mapping notes:
 * - `uuid` / `timestamptz` / `date` columns are typed as `string` (ISO 8601),
 *   matching what `@supabase/supabase-js` returns over PostgREST.
 * - `numeric(p,s)` columns are typed as `number`. PostgREST serializes
 *   `numeric` as a bare JSON number (not a string), so this matches the
 *   runtime shape; be aware this can lose precision for values outside
 *   JS's safe double range, which is not a concern for this app's data.
 * - `bigint generated always as identity` primary keys (`price_cache.id`,
 *   `fundamentals.id`) are typed as `number` and deliberately excluded from
 *   the corresponding `*Insert` types below, since Postgres rejects a
 *   client-supplied value for a `GENERATED ALWAYS` identity column without
 *   `OVERRIDING SYSTEM VALUE`.
 * - `jsonb` columns are typed as `Json`. The application-level shapes stored
 *   inside `thesis_json`, `stress_test_json`, `trade_plan_json`, `exit_json`,
 *   `input_context_json`, `trim_targets`, and `alert_log.details` belong to
 *   the tasks that produce/consume them (the Jarvis LLM integration, the
 *   alert engine); this file only fixes the DB-level `jsonb` contract.
 */

// ---------------------------------------------------------------------------
// Enums (Postgres `create type ... as enum`)
// ---------------------------------------------------------------------------

export type StockType = "watchlist" | "holding";

export type ExchangeCode = "NSE" | "BSE" | "US";

export type TriggerType =
  | "entry_zone_reached"
  | "stop_loss_breached"
  | "trim_target_reached"
  | "earnings_approaching"
  | "reassess_due"
  | "data_stale";

// ---------------------------------------------------------------------------
// JSON value type (for `jsonb` columns)
// ---------------------------------------------------------------------------

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---------------------------------------------------------------------------
// Row types (one per table, in `0001_init.sql` order)
// ---------------------------------------------------------------------------

/** `stocks` */
export interface Stock {
  id: string;
  ticker: string;
  yahoo_symbol: string;
  exchange: ExchangeCode;
  type: StockType;
  status: string;
  consecutive_failure_count: number;
  stale_since: string | null;
  last_price: number | null;
  last_price_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** `holdings` (one-to-one with `stocks` via `stock_id`) */
export interface Holding {
  stock_id: string;
  shares: number;
  cost_basis: number;
  date_acquired: string;
  updated_at: string;
}

/** `jarvis_analyses` */
export interface JarvisAnalysis {
  id: string;
  stock_id: string;
  version: number;
  is_latest: boolean;
  extraction_ok: boolean;
  thesis_json: Json;
  stress_test_json: Json;
  trade_plan_json: Json;
  exit_json: Json;
  raw_llm_response: string;
  model_id: string;
  input_context_json: Json;
  created_at: string;
}

/** `alert_criteria` */
export interface AlertCriteria {
  id: string;
  stock_id: string;
  jarvis_analysis_id: string;
  is_active: boolean;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  trim_targets: Json;
  time_exit_date: string | null;
  reassessment_date: string | null;
  earnings_date: string | null;
  invalidation_text: string | null;
  created_at: string;
}

/** `price_cache` */
export interface PriceCacheRow {
  id: number;
  stock_id: string;
  ts: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  interval: string;
  created_at: string;
}

/** `fundamentals` */
export interface FundamentalRow {
  id: number;
  stock_id: string;
  metric_key: string;
  metric_value: string;
  source: string;
  updated_at: string;
}

/** `alert_log` */
export interface AlertLog {
  id: string;
  stock_id: string;
  trigger_type: TriggerType;
  triggered_at: string;
  details: Json;
  emailed_at: string | null;
}

// ---------------------------------------------------------------------------
// Insert types: Row shape narrowed to what's required on `insert()`, i.e.
// columns with a SQL `default` or that are nullable become optional.
// ---------------------------------------------------------------------------

export type StockInsert = Pick<Stock, "ticker" | "yahoo_symbol" | "exchange"> &
  Partial<
    Pick<
      Stock,
      | "id"
      | "type"
      | "status"
      | "consecutive_failure_count"
      | "stale_since"
      | "last_price"
      | "last_price_at"
      | "created_at"
      | "deleted_at"
    >
  >;

export type HoldingInsert = Pick<
  Holding,
  "stock_id" | "shares" | "cost_basis" | "date_acquired"
> &
  Partial<Pick<Holding, "updated_at">>;

export type JarvisAnalysisInsert = Pick<
  JarvisAnalysis,
  | "stock_id"
  | "version"
  | "thesis_json"
  | "stress_test_json"
  | "trade_plan_json"
  | "exit_json"
  | "raw_llm_response"
  | "model_id"
  | "input_context_json"
> &
  Partial<
    Pick<JarvisAnalysis, "id" | "is_latest" | "extraction_ok" | "created_at">
  >;

export type AlertCriteriaInsert = Pick<
  AlertCriteria,
  "stock_id" | "jarvis_analysis_id"
> &
  Partial<
    Pick<
      AlertCriteria,
      | "id"
      | "is_active"
      | "entry_low"
      | "entry_high"
      | "stop_loss"
      | "trim_targets"
      | "time_exit_date"
      | "reassessment_date"
      | "earnings_date"
      | "invalidation_text"
      | "created_at"
    >
  >;

/** `id` is excluded: `price_cache.id` is `generated always as identity`. */
export type PriceCacheInsert = Pick<PriceCacheRow, "stock_id" | "ts"> &
  Partial<
    Pick<
      PriceCacheRow,
      "open" | "high" | "low" | "close" | "volume" | "interval" | "created_at"
    >
  >;

/** `id` is excluded: `fundamentals.id` is `generated always as identity`. */
export type FundamentalInsert = Pick<
  FundamentalRow,
  "stock_id" | "metric_key" | "metric_value"
> &
  Partial<Pick<FundamentalRow, "source" | "updated_at">>;

export type AlertLogInsert = Pick<
  AlertLog,
  "stock_id" | "trigger_type" | "details"
> &
  Partial<Pick<AlertLog, "id" | "triggered_at" | "emailed_at">>;

// ---------------------------------------------------------------------------
// Update types: everything optional, since an `update()` call only needs to
// supply the columns being changed.
// ---------------------------------------------------------------------------

export type StockUpdate = Partial<StockInsert>;
export type HoldingUpdate = Partial<HoldingInsert>;
export type JarvisAnalysisUpdate = Partial<JarvisAnalysisInsert>;
export type AlertCriteriaUpdate = Partial<AlertCriteriaInsert>;
export type PriceCacheUpdate = Partial<PriceCacheInsert>;
export type FundamentalUpdate = Partial<FundamentalInsert>;
export type AlertLogUpdate = Partial<AlertLogInsert>;

// ---------------------------------------------------------------------------
// Hand-written `Database` type, in the shape `@supabase/supabase-js` expects
// as its generic parameter (same shape `supabase gen types typescript` would
// produce). Written by hand because no live Supabase project exists to
// generate against in this task; if/when one does, generated types can drop
// in as a replacement without changing any code that imports `Database`.
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      stocks: {
        Row: Stock;
        Insert: StockInsert;
        Update: StockUpdate;
      };
      holdings: {
        Row: Holding;
        Insert: HoldingInsert;
        Update: HoldingUpdate;
      };
      jarvis_analyses: {
        Row: JarvisAnalysis;
        Insert: JarvisAnalysisInsert;
        Update: JarvisAnalysisUpdate;
      };
      alert_criteria: {
        Row: AlertCriteria;
        Insert: AlertCriteriaInsert;
        Update: AlertCriteriaUpdate;
      };
      price_cache: {
        Row: PriceCacheRow;
        Insert: PriceCacheInsert;
        Update: PriceCacheUpdate;
      };
      fundamentals: {
        Row: FundamentalRow;
        Insert: FundamentalInsert;
        Update: FundamentalUpdate;
      };
      alert_log: {
        Row: AlertLog;
        Insert: AlertLogInsert;
        Update: AlertLogUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      stock_type: StockType;
      exchange_code: ExchangeCode;
      trigger_type: TriggerType;
    };
    CompositeTypes: Record<string, never>;
  };
}
