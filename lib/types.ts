// lib/types.ts
// Canonical TypeScript types mirroring supabase/migrations/0006_thesis_cockpit_schema.sql
// and 0007_thesis_cockpit_indexes.sql exactly. See that file's header comment
// (preserved from v1) for the `type` vs `interface` rule and the numeric/jsonb
// mapping notes — both still apply unchanged.
//
// Since 0013_user_accounts.sql every table except `stocks` also carries a
// `user_id` (NOT NULL as of 0015). It is absent from the Insert types
// deliberately: the column defaults to `auth.uid()` and row-level security
// rejects any other value, so application code neither sets nor filters on it.

export type ExchangeCode = "NSE" | "BSE" | "US";
/**
 * The universe a thesis is analysed against (migration 0016). Deliberately
 * distinct from `ExchangeCode`: a market is what the trader picks, an exchange
 * is where a listing lives, and India is one market across two exchanges.
 * `CN`/`EU`/`EM` exist in the enum but are not selectable — see `lib/markets.ts`.
 */
export type MarketCode = "US" | "IN" | "CN" | "EU" | "EM";
export type ConvictionTier = "I" | "II" | "III" | "IV";
export type ThesisMode = "stock_only" | "thesis_only" | "stock_plus_thesis";
export type ThesisStatus = "draft" | "active" | "closed" | "macro";
export type PositionStatus = "active" | "partial_exit" | "closed";
export type EntryTranche = "T1" | "T2" | "add";
export type ExitType = "trim_t1" | "trim_t2" | "stop_hit" | "time_exit" | "manual";
export type RecommendationStatus = "open" | "t1_hit" | "t2_hit" | "stop_hit" | "time_expired";
export type ThesisOutcome = "confirmed" | "partially_confirmed" | "invalidated";
export type PositionAlertType =
  | "entry_zone_reached"
  | "stop_loss_breached"
  | "trim_target_reached"
  | "trim_target_1_reached"
  | "trim_target_2_reached"
  | "time_exit_due";

/**
 * Which part of the app spent a model call (0018). Used to attribute cost, so
 * "the Council is what costs money" is answerable rather than assumed.
 */
export type LlmFeature =
  | "thesis"
  | "memorandum"
  | "council_opinion"
  | "council_synthesis"
  | "journal"
  | "holding_review"
  | "portfolio_council_opinion"
  | "portfolio_council_synthesis";

/**
 * `reported` is OpenRouter's own charge for the call, read off the raw response
 * before the AI SDK parses it. `estimated` is derived from token counts against
 * a local price map, and is shown as such — a drifting price map should surface
 * as visibly estimated money, never as quietly wrong money.
 */
export type LlmCostSource = "reported" | "estimated";

/**
 * Where a thesis came from (0020). `imported` marks the synthetic thesis a CSV
 * holdings import creates so a pre-existing position can live in the same
 * tables as an analysed one — a LABEL for provenance, not a different kind of
 * row. It is what tells the UI a position has no real trade plan behind it,
 * and what a later per-holding watch scopes itself by.
 */
export type ThesisSource = "jarvis" | "imported";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** `stocks` (trimmed ticker/exchange/price registry — see plan Decisions #2) */
export type Stock = {
  id: string;
  ticker: string;
  yahoo_symbol: string;
  exchange: ExchangeCode;
  /**
   * ISO-4217-ish code this listing is quoted in, taken from the quote itself
   * (0021). Not derived from `exchange`: that derivation was a US-or-rupees
   * binary, and it is what let the Cockpit add ₹ to $ in one total. "-ish"
   * because Yahoo reports LSE in `GBp` — pence — which is a real answer and
   * not a malformed one.
   */
  currency: string;
  last_price: number | null;
  last_price_at: string | null;
  created_at: string;
};

/** One bear case + counter-argument inside `theses.bear_cases`. */
export type BearCase = {
  reason: string;
  counter: string;
  modified: boolean;
};

/** `theses` */
export type Thesis = {
  id: string;
  /**
   * Owner, from `auth.users`. NOT NULL since `0015`: the column defaults to
   * `auth.uid()`, so a writer with no session fails the insert rather than
   * creating a row no RLS policy can ever match. Absent from the Insert types
   * on purpose — application code must never set it, and RLS rejects any
   * value but the caller's own.
   */
  user_id: string;
  created_at: string;
  input_text: string;
  mode: ThesisMode;
  /** Markets the trader chose to run this thesis against (0016). Never empty. */
  markets: MarketCode[];
  stock_id: string | null;
  /**
   * Only ever set when the TRADER named a stock — never when the model
   * merely mentioned one. See `app/api/theses/route.ts`: a `thesis_only`
   * extraction has this forced to null, because this field grants a ticker
   * the "seed it first, never drop it" treatment in the memorandum route and
   * that authority belongs to the user alone.
   */
  ticker: string | null;
  market_view: string | null;
  mispricing: string | null;
  catalyst: string | null;
  time_horizon: string | null;
  invalidation_condition: string | null;
  conviction_tier: ConvictionTier | null;
  conviction_score: number | null;
  status: ThesisStatus;
  bear_cases: BearCase[];
  raw_llm_response: string | null;
  /** Set once a macro thesis's bake-off is resolved to one name (see `ThesisCandidate`). */
  selected_candidate_id: string | null;
  /** `imported` when this thesis exists only to carry a holding the trader
   *  already owned (0020). Those rows are hidden from `/thesis`, which lists
   *  analyses, and badged on `/positions`, which lists what is owned. */
  source: ThesisSource;
  /** The CSV upload that created this thesis, when one did. */
  import_batch_id: string | null;
};

/**
 * One name Jarvis weighed when a thesis named no stock of its own. See
 * migration 0011 — these persist the head-to-head so a macro thesis resolves
 * to a concrete ticker instead of dead-ending on a list of suggestions.
 */
export type CandidateVerdict = "bet" | "watch" | "avoid";

/** `thesis_candidates` */
export type ThesisCandidate = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  created_at: string;
  thesis_id: string;
  /** Which market's run produced this row (0016). Unique per (thesis, market, ticker). */
  market: MarketCode;
  stock_id: string | null;
  ticker: string;
  company_name: string | null;
  yahoo_symbol: string | null;
  exchange: ExchangeCode | null;
  rank: number;
  verdict: CandidateVerdict;
  score: number | null;
  fit_rationale: string | null;
  bull_case: string | null;
  bear_case: string | null;
  cmp: number | null;
  fundamentals: Record<string, string | number>;
  /** Comparative-grid fields (migration 0012): model-written except the range,
   *  which is mirrored from Yahoo so the range bar plots real numbers. */
  tagline: string | null;
  operational_share: string | null;
  valuation_metric: string | null;
  market_cap: string | null;
  range_low: number | null;
  range_high: number | null;
};

/** `thesis_memorandums` — see `lib/jarvis-memorandum.ts` for `document`'s shape. */
export type ThesisMemorandum = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  created_at: string;
  thesis_id: string;
  /** Which market this memo analyses (0016). Unique per (thesis, market). */
  market: MarketCode;
  sector_theme: string | null;
  memo_title: string | null;
  data_source: string | null;
  primary_candidate_id: string | null;
  secondary_candidate_id: string | null;
  conviction_score: number | null;
  document: Json;
  raw_llm_response: string | null;
};

/**
 * `council_members` (0017) — one Investment Council roster per user.
 *
 * `source` is a LABEL, not a lock. A built-in is an ordinary row the user owns
 * and may edit or delete; the roster caps at 7 total, so a trader who wants
 * four custom voices has to be able to free the slot.
 */
export type CouncilMemberSource = "builtin" | "custom";

export type CouncilMember = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  created_at: string;
  name: string;
  /**
   * What actually grounds this persona's system prompt. A bare name gives the
   * model nothing to imitate, so the column is NOT NULL with a 40-char floor.
   */
  philosophy: string;
  source: CouncilMemberSource;
  sort_order: number;
};

/**
 * `thesis_council_reports` (0017) — one council report per (thesis, market).
 *
 * `document` is the whole report as one validated blob (see
 * `lib/jarvis-council.ts`), replaced on every re-run — the same discipline as
 * `ThesisMemorandum.document`.
 */
export type ThesisCouncilReport = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  created_at: string;
  thesis_id: string;
  market: MarketCode;
  /**
   * Which memorandum the council actually read. The memo is replaced on every
   * re-run, so without this a report would read as a verdict on the current
   * memo when it may have judged a different pick entirely.
   */
  memorandum_id: string | null;
  document: Json;
  raw_llm_response: string | null;
};

/** One measurable thesis condition tracked on a locked trade plan (spec US-15). */
export type ThesisCondition = {
  label: string;
  target: string;
  currentValue: string;
};

/** `trade_plans` */
export type TradePlan = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  thesis_id: string;
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  add_tranche_low: number | null;
  add_tranche_high: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  position_size_pct: number | null;
  max_portfolio_pct: number | null;
  time_exit_date: string | null;
  time_exit_condition: string | null;
  /** `0010_trade_plan_thesis_conditions.sql` — jsonb, defaults to `[]`. */
  thesis_conditions: ThesisCondition[];
  edited_fields: string[];
  ai_suggested: Json;
  created_at: string;
  updated_at: string;
};

/** `positions` */
export type Position = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  thesis_id: string;
  trade_plan_id: string;
  stock_id: string;
  ticker: string;
  status: PositionStatus;
  created_at: string;
};

/** `entries` */
export type Entry = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  position_id: string;
  date: string;
  quantity: number;
  price: number;
  tranche: EntryTranche;
  notes: string | null;
  created_at: string;
};

/** `exits` */
export type Exit = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  position_id: string;
  date: string;
  quantity: number;
  price: number;
  type: ExitType;
  reason: string | null;
  override: boolean;
  override_reason: string | null;
  created_at: string;
};

/** `jarvis_recommendations` */
export type JarvisRecommendation = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  thesis_id: string;
  trade_plan_id: string | null;
  stock_id: string;
  ticker: string;
  recommended_at: string;
  recommended_entry_low: number | null;
  recommended_entry_high: number | null;
  recommended_stop: number | null;
  recommended_target_1: number | null;
  recommended_target_2: number | null;
  conviction_tier: ConvictionTier;
  price_at_recommendation: number;
  status: RecommendationStatus;
  converted_to_position: boolean;
  position_id: string | null;
  thesis_summary: string;
};

/** `trade_journal_entries` */
export type TradeJournalEntry = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  position_id: string;
  ticker: string;
  entry_dates: string[];
  exit_dates: string[];
  pnl_rupees: number;
  pnl_pct: number | null;
  thesis_outcome: ThesisOutcome;
  conviction_tier_used: ConvictionTier;
  entry_quality: number;
  sizing_quality: number;
  stop_management: number;
  exit_quality: number;
  discipline_score: number;
  what_went_right: string | null;
  what_went_wrong: string | null;
  lessons: string | null;
  jarvis_verdict: string | null;
  tags: string[];
  created_at: string;
};

/** `position_alerts` (v2 replacement for the old `alert_log`) */
export type PositionAlert = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  position_id: string;
  alert_type: PositionAlertType;
  triggered_at: string;
  details: Json;
  emailed_at: string | null;
};

/** `intelligence_signals` */
export type IntelligenceSignal = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  created_at: string;
  priority: "red" | "amber" | "blue" | "grey";
  ticker: string | null;
  theme: string | null;
  headline: string;
  thesis_id: string | null;
  archived_at: string | null;
  /** Set by `daily-digest` once this signal has actually been emailed (0022),
   *  mirroring `position_alerts.emailed_at`. Null means unsent. */
  emailed_at: string | null;
};

/** `opportunities` */
export type Opportunity = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  created_at: string;
  ticker: string;
  sector: string | null;
  conviction_tier: ConvictionTier | null;
  thesis_summary: string | null;
  pe: number | null;
  sector_median_pe: number | null;
  fifty_two_week_low: number | null;
  fifty_two_week_high: number | null;
  market: ExchangeCode;
  watching_only: boolean;
};

/**
 * `portfolio_imports` (0020) — one row per CSV holdings upload.
 *
 * An audit record, not a queue: it is written before the holdings and updated
 * after, so a run that dies partway leaves `status: "failed"` rather than
 * nothing. `errors` explains every row that was skipped, which is what lets a
 * trader answer "what did I import last Tuesday, and did anything fail".
 */
export type PortfolioImport = {
  id: string;
  /** Owner — see `Thesis.user_id`. */
  user_id: string;
  created_at: string;
  source_filename: string;
  /** A batch prices against exactly one market — see `lib/markets.ts`. */
  market: MarketCode;
  /** The approximate purchase date stamped on every entry in this batch. */
  as_of_date: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  status: PortfolioImportStatus;
  errors: PortfolioImportError[];
};

export type PortfolioImportStatus = "completed" | "partial" | "failed";

/** One skipped row, and why. Shape of an element of `PortfolioImport.errors`. */
export type PortfolioImportError = {
  /** 1-based line number in the trader's file, header included. */
  row: number;
  ticker: string;
  reason: string;
};

/**
 * `portfolio_profiles` (0020) — what the trader is trying to do with the book
 * as a whole. Optional, one row per user, and nothing reads it yet: it is
 * collected during the import because that is the one moment a trader is
 * already thinking about their portfolio as a portfolio.
 */
export type PortfolioProfile = {
  user_id: string;
  objective: string | null;
  updated_at: string;
};

/**
 * What made a `holding_reviews` row happen (0022).
 *
 * `manual` covers both the trader pressing "re-run this read" and the FIRST
 * read on a freshly imported holding — in both cases nothing changed, someone
 * simply asked. `scheduled` is reserved for a re-check the cadence forced with
 * no trigger of its own.
 */
export type HoldingReviewTrigger =
  | "manual"
  | "earnings_calendar"
  | "fundamentals_delta"
  | "scheduled";

/**
 * `portfolio_council_reports` (0023) — one Council consult on the whole book.
 *
 * Append-only, unlike `thesis_council_reports`, which is keyed
 * `unique (thesis_id, market)` and replaced in place. A memorandum is rewritten
 * on every re-run so an old report on it is stale by definition; a portfolio is
 * not rewritten, it changes, and comparing two dates is the point.
 */
export type PortfolioCouncilReportRow = {
  id: string;
  user_id: string;
  created_at: string;
  document: Json;
  /** What was reviewed and at what prices, so a report cannot silently read as
   *  current once the book has moved on. */
  holdings_snapshot: Json;
  raw_llm_response: string | null;
};

/**
 * `holding_reviews` (0022) — one Jarvis read of one holding, append-only.
 *
 * `document` is a `HoldingReview` from `lib/holding-watch.ts`, re-validated on
 * read like every other JSONB document in this schema.
 */
export type HoldingReview = {
  id: string;
  user_id: string;
  created_at: string;
  thesis_id: string;
  position_id: string;
  trigger: HoldingReviewTrigger;
  document: Json;
  raw_llm_response: string | null;
};

/**
 * `holding_watch_state` (0022) — one row per watched position, updated in
 * place. The only thing in the schema that makes "has this moved since last
 * time" answerable; see the migration for why it is not an append-only
 * snapshot table.
 */
export type HoldingWatchState = {
  position_id: string;
  user_id: string;
  /** Null means never successfully reviewed — which is how an import queues one. */
  last_checked_at: string | null;
  /**
   * When the drain last TRIED, whatever came of it. The queue is ordered on
   * this, not on `last_checked_at`: a holding that fails every time keeps a
   * null `last_checked_at` forever, so ordering on that would hand back the
   * same doomed rows every hour and starve everything behind them.
   */
  last_attempted_at: string | null;
  fundamentals: Json;
  next_earnings_date: string | null;
  last_earnings_seen: string | null;
};

// --- Insert types (columns with a SQL default or that are nullable become optional) ---

export type PortfolioCouncilReportInsert = Pick<
  PortfolioCouncilReportRow,
  "document" | "holdings_snapshot"
> &
  Partial<Pick<PortfolioCouncilReportRow, "id" | "user_id" | "created_at" | "raw_llm_response">>;

export type PortfolioCouncilReportUpdate = Partial<PortfolioCouncilReportInsert>;

export type HoldingReviewInsert = Pick<
  HoldingReview,
  "thesis_id" | "position_id" | "trigger" | "document"
> &
  Partial<Pick<HoldingReview, "id" | "user_id" | "created_at" | "raw_llm_response">>;

export type HoldingReviewUpdate = Partial<HoldingReviewInsert>;

export type HoldingWatchStateInsert = Pick<HoldingWatchState, "position_id"> &
  Partial<
    Pick<
      HoldingWatchState,
      | "user_id"
      | "last_checked_at"
      | "last_attempted_at"
      | "fundamentals"
      | "next_earnings_date"
      | "last_earnings_seen"
    >
  >;

export type HoldingWatchStateUpdate = Partial<HoldingWatchStateInsert>;

export type StockInsert = Pick<Stock, "ticker" | "yahoo_symbol" | "exchange" | "currency"> &
  Partial<Pick<Stock, "id" | "last_price" | "last_price_at" | "created_at">>;

export type ThesisInsert = Pick<Thesis, "input_text" | "mode" | "markets"> &
  Partial<
    Pick<
      Thesis,
      | "id"
      | "created_at"
      | "stock_id"
      | "ticker"
      | "market_view"
      | "mispricing"
      | "catalyst"
      | "time_horizon"
      | "invalidation_condition"
      | "conviction_tier"
      | "conviction_score"
      | "status"
      | "bear_cases"
      | "raw_llm_response"
      | "selected_candidate_id"
      | "source"
      | "import_batch_id"
    >
  >;

export type ThesisCandidateInsert = Pick<
  ThesisCandidate,
  "thesis_id" | "market" | "ticker" | "rank" | "verdict"
> &
  Partial<
    Pick<
      ThesisCandidate,
      | "id"
      | "created_at"
      | "stock_id"
      | "company_name"
      | "yahoo_symbol"
      | "exchange"
      | "score"
      | "fit_rationale"
      | "bull_case"
      | "bear_case"
      | "cmp"
      | "fundamentals"
      | "tagline"
      | "operational_share"
      | "valuation_metric"
      | "market_cap"
      | "range_low"
      | "range_high"
    >
  >;

export type ThesisMemorandumInsert = Pick<ThesisMemorandum, "thesis_id" | "market" | "document"> &
  Partial<
    Pick<
      ThesisMemorandum,
      | "id"
      | "created_at"
      | "sector_theme"
      | "memo_title"
      | "data_source"
      | "primary_candidate_id"
      | "secondary_candidate_id"
      | "conviction_score"
      | "raw_llm_response"
    >
  >;

export type ThesisMemorandumUpdate = Partial<ThesisMemorandumInsert>;

/** `user_id`, `source` and `sort_order` all have server-side defaults. */
export type CouncilMemberInsert = Pick<CouncilMember, "name" | "philosophy"> &
  Partial<Pick<CouncilMember, "id" | "created_at" | "source" | "sort_order">>;

export type CouncilMemberUpdate = Partial<CouncilMemberInsert>;

export type ThesisCouncilReportInsert = Pick<
  ThesisCouncilReport,
  "thesis_id" | "market" | "document"
> &
  Partial<
    Pick<ThesisCouncilReport, "id" | "created_at" | "memorandum_id" | "raw_llm_response">
  >;

export type ThesisCouncilReportUpdate = Partial<ThesisCouncilReportInsert>;

export type ThesisCandidateUpdate = Partial<ThesisCandidateInsert>;

export type TradePlanInsert = Pick<TradePlan, "thesis_id"> &
  Partial<
    Pick<
      TradePlan,
      | "id"
      | "entry_zone_low"
      | "entry_zone_high"
      | "add_tranche_low"
      | "add_tranche_high"
      | "stop_loss"
      | "target_1"
      | "target_2"
      | "position_size_pct"
      | "max_portfolio_pct"
      | "time_exit_date"
      | "time_exit_condition"
      | "thesis_conditions"
      | "edited_fields"
      | "ai_suggested"
      | "created_at"
      | "updated_at"
    >
  >;

export type PositionInsert = Pick<
  Position,
  "thesis_id" | "trade_plan_id" | "stock_id" | "ticker"
> &
  Partial<Pick<Position, "id" | "status" | "created_at">>;

export type EntryInsert = Pick<
  Entry,
  "position_id" | "date" | "quantity" | "price" | "tranche"
> &
  Partial<Pick<Entry, "id" | "notes" | "created_at">>;

export type ExitInsert = Pick<
  Exit,
  "position_id" | "date" | "quantity" | "price" | "type"
> &
  Partial<
    Pick<Exit, "id" | "reason" | "override" | "override_reason" | "created_at">
  >;

export type JarvisRecommendationInsert = Pick<
  JarvisRecommendation,
  "thesis_id" | "stock_id" | "ticker" | "conviction_tier" | "price_at_recommendation" | "thesis_summary"
> &
  Partial<
    Pick<
      JarvisRecommendation,
      | "id"
      | "trade_plan_id"
      | "recommended_at"
      | "recommended_entry_low"
      | "recommended_entry_high"
      | "recommended_stop"
      | "recommended_target_1"
      | "recommended_target_2"
      | "status"
      | "converted_to_position"
      | "position_id"
    >
  >;

export type TradeJournalEntryInsert = Pick<
  TradeJournalEntry,
  | "position_id"
  | "ticker"
  | "pnl_rupees"
  | "thesis_outcome"
  | "conviction_tier_used"
  | "entry_quality"
  | "sizing_quality"
  | "stop_management"
  | "exit_quality"
  | "discipline_score"
> &
  Partial<
    Pick<
      TradeJournalEntry,
      | "id"
      | "entry_dates"
      | "exit_dates"
      | "pnl_pct"
      | "what_went_right"
      | "what_went_wrong"
      | "lessons"
      | "jarvis_verdict"
      | "tags"
      | "created_at"
    >
  >;

export type PositionAlertInsert = Pick<
  PositionAlert,
  "position_id" | "alert_type" | "details"
> &
  Partial<Pick<PositionAlert, "id" | "triggered_at" | "emailed_at">>;

export type IntelligenceSignalInsert = Pick<IntelligenceSignal, "priority" | "headline"> &
  Partial<
    Pick<
      IntelligenceSignal,
      | "id"
      | "user_id"
      | "created_at"
      | "ticker"
      | "theme"
      | "thesis_id"
      | "archived_at"
      | "emailed_at"
    >
  >;

export type OpportunityInsert = Pick<Opportunity, "ticker" | "market"> &
  Partial<
    Pick<
      Opportunity,
      | "id"
      | "created_at"
      | "sector"
      | "conviction_tier"
      | "thesis_summary"
      | "pe"
      | "sector_median_pe"
      | "fifty_two_week_low"
      | "fifty_two_week_high"
      | "watching_only"
    >
  >;

// --- Update types ---
/** `llm_usage` (0018) — append-only. One row per model call, denominated in money. */
export type LlmUsage = {
  id: string;
  user_id: string;
  created_at: string;
  feature: LlmFeature;
  model: string;
  /** OpenRouter's generation id — unique, so a retried write cannot double-count. */
  generation_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_source: LlmCostSource;
  thesis_id: string | null;
  /** False when the call threw. Still recorded: a failed call can still be billed. */
  ok: boolean;
};

/**
 * Written by the service-role client only. `authenticated` has SELECT and
 * nothing else on this table — a ledger its subject can edit is not a limit.
 */
export type LlmUsageInsert = Pick<LlmUsage, "user_id" | "feature" | "model"> &
  Partial<
    Pick<
      LlmUsage,
      | "id"
      | "created_at"
      | "generation_id"
      | "input_tokens"
      | "output_tokens"
      | "cost_usd"
      | "cost_source"
      | "thesis_id"
      | "ok"
    >
  >;

/**
 * `llm_budgets` (0018) — sparse. NO ROW means the env defaults apply, so every
 * account is capped from the moment it exists. A row exists only to override,
 * and a null column means no limit for that window.
 */
export type LlmBudget = {
  user_id: string;
  daily_usd: number | null;
  monthly_usd: number | null;
  note: string | null;
};

export type LlmBudgetInsert = Pick<LlmBudget, "user_id"> &
  Partial<Pick<LlmBudget, "daily_usd" | "monthly_usd" | "note">>;

/** Return shape of the `llm_budget_status()` RPC. */
export type LlmBudgetStatus = {
  daily_spent: number;
  monthly_spent: number;
  daily_limit: number | null;
  monthly_limit: number | null;
  has_override: boolean;
};

export type PortfolioImportInsert = Pick<
  PortfolioImport,
  "source_filename" | "market" | "as_of_date" | "total_rows"
> &
  Partial<
    Pick<
      PortfolioImport,
      "id" | "created_at" | "imported_rows" | "skipped_rows" | "status" | "errors"
    >
  >;

export type PortfolioProfileInsert = Partial<Pick<PortfolioProfile, "objective" | "updated_at">>;

export type StockUpdate = Partial<StockInsert>;
export type ThesisUpdate = Partial<ThesisInsert>;
export type TradePlanUpdate = Partial<TradePlanInsert>;
export type PositionUpdate = Partial<PositionInsert>;
export type EntryUpdate = Partial<EntryInsert>;
export type ExitUpdate = Partial<ExitInsert>;
export type JarvisRecommendationUpdate = Partial<JarvisRecommendationInsert>;
export type TradeJournalEntryUpdate = Partial<TradeJournalEntryInsert>;
export type PositionAlertUpdate = Partial<PositionAlertInsert>;
export type IntelligenceSignalUpdate = Partial<IntelligenceSignalInsert>;
export type OpportunityUpdate = Partial<OpportunityInsert>;
export type PortfolioImportUpdate = Partial<PortfolioImportInsert>;
export type PortfolioProfileUpdate = Partial<PortfolioProfileInsert>;

export interface Database {
  public: {
    Tables: {
      stocks: { Row: Stock; Insert: StockInsert; Update: StockUpdate; Relationships: [] };
      theses: { Row: Thesis; Insert: ThesisInsert; Update: ThesisUpdate; Relationships: [] };
      thesis_candidates: {
        Row: ThesisCandidate;
        Insert: ThesisCandidateInsert;
        Update: ThesisCandidateUpdate;
        Relationships: [];
      };
      thesis_memorandums: {
        Row: ThesisMemorandum;
        Insert: ThesisMemorandumInsert;
        Update: ThesisMemorandumUpdate;
        Relationships: [];
      };
      llm_usage: {
        Row: LlmUsage;
        Insert: LlmUsageInsert;
        Update: Partial<LlmUsageInsert>;
        Relationships: [];
      };
      llm_budgets: {
        Row: LlmBudget;
        Insert: LlmBudgetInsert;
        Update: Partial<LlmBudgetInsert>;
        Relationships: [];
      };
      council_members: {
        Row: CouncilMember;
        Insert: CouncilMemberInsert;
        Update: CouncilMemberUpdate;
        Relationships: [];
      };
      thesis_council_reports: {
        Row: ThesisCouncilReport;
        Insert: ThesisCouncilReportInsert;
        Update: ThesisCouncilReportUpdate;
        Relationships: [];
      };
      trade_plans: { Row: TradePlan; Insert: TradePlanInsert; Update: TradePlanUpdate; Relationships: [] };
      positions: { Row: Position; Insert: PositionInsert; Update: PositionUpdate; Relationships: [] };
      entries: { Row: Entry; Insert: EntryInsert; Update: EntryUpdate; Relationships: [] };
      exits: { Row: Exit; Insert: ExitInsert; Update: ExitUpdate; Relationships: [] };
      jarvis_recommendations: {
        Row: JarvisRecommendation;
        Insert: JarvisRecommendationInsert;
        Update: JarvisRecommendationUpdate;
        Relationships: [];
      };
      trade_journal_entries: {
        Row: TradeJournalEntry;
        Insert: TradeJournalEntryInsert;
        Update: TradeJournalEntryUpdate;
        Relationships: [];
      };
      position_alerts: {
        Row: PositionAlert;
        Insert: PositionAlertInsert;
        Update: PositionAlertUpdate;
        Relationships: [];
      };
      intelligence_signals: {
        Row: IntelligenceSignal;
        Insert: IntelligenceSignalInsert;
        Update: IntelligenceSignalUpdate;
        Relationships: [];
      };
      opportunities: {
        Row: Opportunity;
        Insert: OpportunityInsert;
        Update: OpportunityUpdate;
        Relationships: [];
      };
      portfolio_imports: {
        Row: PortfolioImport;
        Insert: PortfolioImportInsert;
        Update: PortfolioImportUpdate;
        Relationships: [];
      };
      portfolio_profiles: {
        Row: PortfolioProfile;
        Insert: PortfolioProfileInsert;
        Update: PortfolioProfileUpdate;
        Relationships: [];
      };
      portfolio_council_reports: {
        Row: PortfolioCouncilReportRow;
        Insert: PortfolioCouncilReportInsert;
        Update: PortfolioCouncilReportUpdate;
        Relationships: [];
      };
      holding_reviews: {
        Row: HoldingReview;
        Insert: HoldingReviewInsert;
        Update: HoldingReviewUpdate;
        Relationships: [];
      };
      holding_watch_state: {
        Row: HoldingWatchState;
        Insert: HoldingWatchStateInsert;
        Update: HoldingWatchStateUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      llm_budget_status: {
        Args: Record<string, never>;
        Returns: LlmBudgetStatus[];
      };
      /** Same rule, told who to apply it to. Service-role only (0022) — a
       *  scheduled job acts as no one, so it cannot read `auth.uid()`. */
      llm_budget_status_for: {
        Args: { uid: string };
        Returns: LlmBudgetStatus[];
      };
      llm_usage_by_feature: {
        Args: Record<string, never>;
        Returns: {
          feature: LlmFeature;
          cost_usd: number;
          calls: number;
          estimated_calls: number;
        }[];
      };
    };
    Enums: {
      exchange_code: ExchangeCode;
      conviction_tier: ConvictionTier;
      thesis_mode: ThesisMode;
      candidate_verdict: CandidateVerdict;
      thesis_status: ThesisStatus;
      position_status: PositionStatus;
      entry_tranche: EntryTranche;
      exit_type: ExitType;
      recommendation_status: RecommendationStatus;
      thesis_outcome: ThesisOutcome;
      position_alert_type: PositionAlertType;
      council_member_source: CouncilMemberSource;
      llm_feature: LlmFeature;
      thesis_source: ThesisSource;
      holding_review_trigger: HoldingReviewTrigger;
    };
    CompositeTypes: Record<string, never>;
  };
}
