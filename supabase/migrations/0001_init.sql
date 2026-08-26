create extension if not exists "pgcrypto";
create type stock_type as enum ('watchlist', 'holding');
create type exchange_code as enum ('NSE', 'BSE', 'US');
create type trigger_type as enum (
  'entry_zone_reached','stop_loss_breached','trim_target_reached',
  'earnings_approaching','reassess_due','data_stale'
);

create table stocks (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  yahoo_symbol text not null,
  exchange exchange_code not null,
  type stock_type not null default 'watchlist',
  status text not null default 'watching',
  consecutive_failure_count int not null default 0,
  stale_since timestamptz,
  last_price numeric(14,4),
  last_price_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (yahoo_symbol)
);

create table holdings (
  stock_id uuid primary key references stocks(id) on delete cascade,
  shares numeric(18,6) not null,
  cost_basis numeric(14,4) not null,
  date_acquired date not null,
  updated_at timestamptz not null default now()
);

create table jarvis_analyses (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references stocks(id) on delete cascade,
  version int not null,
  is_latest boolean not null default true,
  extraction_ok boolean not null default false,
  thesis_json jsonb not null,
  stress_test_json jsonb not null,
  trade_plan_json jsonb not null,
  exit_json jsonb not null,
  raw_llm_response text not null,
  model_id text not null,
  input_context_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (stock_id, version)
);

create table alert_criteria (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references stocks(id) on delete cascade,
  jarvis_analysis_id uuid not null references jarvis_analyses(id) on delete cascade,
  is_active boolean not null default true,
  entry_low numeric(14,4), entry_high numeric(14,4),
  stop_loss numeric(14,4),
  trim_targets jsonb not null default '[]',
  time_exit_date date, reassessment_date date, earnings_date date,
  invalidation_text text,
  created_at timestamptz not null default now()
);

create table price_cache (
  id bigint generated always as identity primary key,
  stock_id uuid not null references stocks(id) on delete cascade,
  ts timestamptz not null,
  open numeric(14,4), high numeric(14,4), low numeric(14,4), close numeric(14,4), volume bigint,
  interval text not null default '1d',
  created_at timestamptz not null default now()
);

create table fundamentals (
  id bigint generated always as identity primary key,
  stock_id uuid not null references stocks(id) on delete cascade,
  metric_key text not null,
  metric_value text not null,
  source text not null default 'auto',
  updated_at timestamptz not null default now(),
  unique (stock_id, metric_key)
);

create table alert_log (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references stocks(id) on delete cascade,
  trigger_type trigger_type not null,
  triggered_at timestamptz not null default now(),
  details jsonb not null,
  emailed_at timestamptz
);
