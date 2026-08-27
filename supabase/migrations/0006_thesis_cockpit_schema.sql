-- 0006_thesis_cockpit_schema.sql
-- Full replace of the v1 schema per the Jarvis Decision Cockpit v2 spec.
-- Drops the old analysis/holding/alert tables; `stocks` survives, trimmed to
-- a ticker/exchange/price registry (see plan's "Decisions Beyond The Spec" #2).

drop table if exists alert_log cascade;
drop table if exists alert_criteria cascade;
drop table if exists jarvis_analyses cascade;
drop table if exists holdings cascade;
drop table if exists fundamentals cascade;
drop table if exists price_cache cascade;

drop type if exists trigger_type;
drop type if exists stock_type;

alter table stocks drop column if exists type;
alter table stocks drop column if exists status;
alter table stocks drop column if exists consecutive_failure_count;
alter table stocks drop column if exists stale_since;
alter table stocks drop column if exists deleted_at;
-- yahoo_symbol/exchange/last_price/last_price_at/created_at/id/ticker are kept as-is.

create type conviction_tier as enum ('I', 'II', 'III', 'IV');
create type thesis_mode as enum ('stock_only', 'thesis_only', 'stock_plus_thesis');
create type thesis_status as enum ('draft', 'active', 'closed', 'macro');
create type position_status as enum ('active', 'partial_exit', 'closed');
create type entry_tranche as enum ('T1', 'T2', 'add');
create type exit_type as enum ('trim_t1', 'trim_t2', 'stop_hit', 'time_exit', 'manual');
create type recommendation_status as enum ('open', 't1_hit', 't2_hit', 'stop_hit', 'time_expired');
create type thesis_outcome as enum ('confirmed', 'partially_confirmed', 'invalidated');
create type position_alert_type as enum ('entry_zone_reached', 'stop_loss_breached', 'trim_target_reached', 'time_exit_due');

create table theses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  input_text text not null,
  mode thesis_mode not null,
  stock_id uuid references stocks(id),
  ticker text,
  market_view text,
  mispricing text,
  catalyst text,
  time_horizon text,
  invalidation_condition text,
  conviction_tier conviction_tier,
  conviction_score int check (conviction_score is null or (conviction_score between 0 and 100)),
  status thesis_status not null default 'draft',
  bear_cases jsonb not null default '[]',
  raw_llm_response text
);

create table trade_plans (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references theses(id) on delete cascade,
  entry_zone_low numeric(14,4),
  entry_zone_high numeric(14,4),
  add_tranche_low numeric(14,4),
  add_tranche_high numeric(14,4),
  stop_loss numeric(14,4),
  target_1 numeric(14,4),
  target_2 numeric(14,4),
  position_size_pct numeric(6,3),
  max_portfolio_pct numeric(6,3),
  time_exit_date date,
  time_exit_condition text,
  edited_fields text[] not null default '{}',
  ai_suggested jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table positions (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references theses(id) on delete cascade,
  trade_plan_id uuid not null references trade_plans(id) on delete cascade,
  stock_id uuid not null references stocks(id),
  ticker text not null,
  status position_status not null default 'active',
  created_at timestamptz not null default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id) on delete cascade,
  date date not null,
  quantity numeric(18,6) not null check (quantity > 0),
  price numeric(14,4) not null check (price > 0),
  tranche entry_tranche not null,
  notes text,
  created_at timestamptz not null default now()
);

create table exits (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id) on delete cascade,
  date date not null,
  quantity numeric(18,6) not null check (quantity > 0),
  price numeric(14,4) not null check (price > 0),
  type exit_type not null,
  reason text,
  override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now()
);

create table jarvis_recommendations (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references theses(id) on delete cascade,
  trade_plan_id uuid references trade_plans(id) on delete set null,
  stock_id uuid not null references stocks(id),
  ticker text not null,
  recommended_at timestamptz not null default now(),
  recommended_entry_low numeric(14,4),
  recommended_entry_high numeric(14,4),
  recommended_stop numeric(14,4),
  recommended_target_1 numeric(14,4),
  recommended_target_2 numeric(14,4),
  conviction_tier conviction_tier not null,
  price_at_recommendation numeric(14,4) not null,
  status recommendation_status not null default 'open',
  converted_to_position boolean not null default false,
  position_id uuid references positions(id) on delete set null,
  thesis_summary text not null
);

create table trade_journal_entries (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id) on delete cascade,
  ticker text not null,
  entry_dates date[] not null default '{}',
  exit_dates date[] not null default '{}',
  pnl_rupees numeric(14,4) not null,
  pnl_pct numeric(8,4),
  thesis_outcome thesis_outcome not null,
  conviction_tier_used conviction_tier not null,
  entry_quality int not null check (entry_quality between 1 and 5),
  sizing_quality int not null check (sizing_quality between 1 and 5),
  stop_management int not null check (stop_management between 1 and 5),
  exit_quality int not null check (exit_quality between 1 and 5),
  discipline_score int not null check (discipline_score between 1 and 5),
  what_went_right text,
  what_went_wrong text,
  lessons text,
  jarvis_verdict text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Replacement for the old `alert_log`, scoped to the new trade-plan model.
-- Written by the updated `poll-prices` Edge Function (Task 5).
create table position_alerts (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id) on delete cascade,
  alert_type position_alert_type not null,
  triggered_at timestamptz not null default now(),
  details jsonb not null,
  emailed_at timestamptz
);

-- Manually-curated feed items and opportunities (Decisions Beyond The Spec #4).
create table intelligence_signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  priority text not null check (priority in ('red', 'amber', 'blue', 'grey')),
  ticker text,
  theme text,
  headline text not null,
  thesis_id uuid references theses(id) on delete set null,
  archived_at timestamptz
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ticker text not null,
  sector text,
  conviction_tier conviction_tier,
  thesis_summary text,
  pe numeric(10,2),
  sector_median_pe numeric(10,2),
  fifty_two_week_low numeric(14,4),
  fifty_two_week_high numeric(14,4),
  market exchange_code not null,
  watching_only boolean not null default false
);

alter table theses enable row level security;
alter table trade_plans enable row level security;
alter table positions enable row level security;
alter table entries enable row level security;
alter table exits enable row level security;
alter table jarvis_recommendations enable row level security;
alter table trade_journal_entries enable row level security;
alter table position_alerts enable row level security;
alter table intelligence_signals enable row level security;
alter table opportunities enable row level security;
