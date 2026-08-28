// lib/types.ts
// Canonical TypeScript types mirroring supabase/migrations/0006_thesis_cockpit_schema.sql
// and 0007_thesis_cockpit_indexes.sql exactly. See that file's header comment
// (preserved from v1) for the `type` vs `interface` rule and the numeric/jsonb
// mapping notes — both still apply unchanged.

export type ExchangeCode = "NSE" | "BSE" | "US";
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
  created_at: string;
  input_text: string;
  mode: ThesisMode;
  stock_id: string | null;
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
  created_at: string;
  thesis_id: string;
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
  position_id: string;
  alert_type: PositionAlertType;
  triggered_at: string;
  details: Json;
  emailed_at: string | null;
};

/** `intelligence_signals` */
export type IntelligenceSignal = {
  id: string;
  created_at: string;
  priority: "red" | "amber" | "blue" | "grey";
  ticker: string | null;
  theme: string | null;
  headline: string;
  thesis_id: string | null;
  archived_at: string | null;
};

/** `opportunities` */
export type Opportunity = {
  id: string;
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

// --- Insert types (columns with a SQL default or that are nullable become optional) ---

export type StockInsert = Pick<Stock, "ticker" | "yahoo_symbol" | "exchange"> &
  Partial<Pick<Stock, "id" | "last_price" | "last_price_at" | "created_at">>;

export type ThesisInsert = Pick<Thesis, "input_text" | "mode"> &
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
    >
  >;

export type ThesisCandidateInsert = Pick<
  ThesisCandidate,
  "thesis_id" | "ticker" | "rank" | "verdict"
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
    >
  >;

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
    Pick<IntelligenceSignal, "id" | "created_at" | "ticker" | "theme" | "thesis_id" | "archived_at">
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
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
    };
    CompositeTypes: Record<string, never>;
  };
}
