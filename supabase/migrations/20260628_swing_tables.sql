-- Swing Trade [Beta] tables
-- Migration: 20260628_swing_tables.sql

-- ── swing_scores ──────────────────────────────────────────────────────────────
-- Scored contract opportunities surfaced by the daily pipeline.
-- Unique per contract per scan date; upserted on repeated runs.

create table if not exists swing_scores (
  id                uuid primary key default gen_random_uuid(),
  contract_symbol   text not null,
  scan_date         date not null,
  ticker            text not null,
  strike            numeric,
  expiry            date,
  side              text check (side in ('call', 'put')),
  dte               int,
  composite_score   numeric not null,
  tier              text check (tier in ('Prime', 'Strong', 'Watch')),
  flow_score        numeric,
  setup_score       numeric,
  breakdown         jsonb,
  premium           numeric,
  iv_pct            numeric,
  vol               int,
  oi                int,
  vol_oi            numeric,
  dollar_flow       numeric,
  pct_at_ask        numeric,
  is_sweep          boolean default false,
  is_floor          boolean default false,
  unusual_score     numeric,
  created_at        timestamptz default now(),
  unique (contract_symbol, scan_date)
);

create index if not exists swing_scores_scan_date_idx on swing_scores (scan_date);
create index if not exists swing_scores_tier_idx on swing_scores (tier);
create index if not exists swing_scores_ticker_idx on swing_scores (ticker);
create index if not exists swing_scores_composite_idx on swing_scores (composite_score desc);


-- ── swing_watchlist ──────────────────────────────────────────────────────────
-- User-curated list of contracts to watch (not yet entered).

create table if not exists swing_watchlist (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  contract_symbol  text not null,
  ticker           text,
  note             text,
  added_at         timestamptz default now(),
  unique (user_id, contract_symbol)
);

alter table swing_watchlist enable row level security;

create policy "Users manage own watchlist"
  on swing_watchlist for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists swing_watchlist_user_idx on swing_watchlist (user_id);


-- ── swing_positions ──────────────────────────────────────────────────────────
-- Paper and live positions opened via the swing strategy.

create table if not exists swing_positions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  mode              text not null check (mode in ('paper', 'live')),
  contract_symbol   text not null,
  ticker            text,
  side              text check (side in ('call', 'put')),
  qty               int not null,
  entry_price       numeric not null,
  strategy_profile  text not null,
  stop_config       jsonb,
  tp_ladder         jsonb,
  status            text not null default 'open'
                    check (status in ('open', 'partially_closed', 'closed', 'expired')),
  realized_pnl      numeric default 0,
  broker_order_ids  jsonb,
  entry_at          timestamptz default now(),
  closed_at         timestamptz,
  updated_at        timestamptz default now()
);

alter table swing_positions enable row level security;

create policy "Users manage own positions"
  on swing_positions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists swing_positions_user_idx on swing_positions (user_id);
create index if not exists swing_positions_status_idx on swing_positions (status);


-- ── swing_trade_logs ─────────────────────────────────────────────────────────
-- Immutable audit trail of every partial close / stop / TP event.

create table if not exists swing_trade_logs (
  id            uuid primary key default gen_random_uuid(),
  position_id   uuid references swing_positions (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  event_type    text not null,   -- TP1 | TP2 | HARD_STOP | TIME_STOP | BE_STOP | RUNNER_TRAIL | MANUAL
  qty_closed    int,
  price         numeric,
  pnl           numeric,
  reason        text,
  logged_at     timestamptz default now()
);

alter table swing_trade_logs enable row level security;

create policy "Users view own trade logs"
  on swing_trade_logs for select
  using (auth.uid() = user_id);

create policy "Backend insert trade logs"
  on swing_trade_logs for insert
  with check (auth.uid() = user_id);

create index if not exists swing_trade_logs_position_idx on swing_trade_logs (position_id);
create index if not exists swing_trade_logs_user_idx on swing_trade_logs (user_id);


-- ── swing_run_logs ────────────────────────────────────────────────────────────
-- One row per pipeline invocation — tracks funnel throughput.

create table if not exists swing_run_logs (
  id               uuid primary key default gen_random_uuid(),
  scan_date        date not null,
  uw_flows_raw     int,
  swing_eligible   int,
  candidates       int,
  scored           int,
  surfaced         int,
  errors           jsonb,
  duration_sec     numeric,
  run_at           timestamptz default now()
);

create index if not exists swing_run_logs_scan_date_idx on swing_run_logs (scan_date);
create index if not exists swing_run_logs_run_at_idx on swing_run_logs (run_at desc);


-- ── swing_config ─────────────────────────────────────────────────────────────
-- Key/value config overrides for the pipeline; falls back to code defaults.
-- Keys: stage_weights, tier_cutoffs, dte_range, max_surfaced, min_tech_score

create table if not exists swing_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz default now()
);

-- Seed defaults (upsert so re-running is idempotent)
insert into swing_config (key, value) values
  ('stage_weights',  '{"tech_weight": 0.45, "flow_weight": 0.55}'),
  ('tier_cutoffs',   '{"prime": 90, "strong": 75, "watch": 60}'),
  ('dte_range',      '{"min": 30, "max": 90}'),
  ('max_surfaced',   '20'),
  ('min_tech_score', '40')
on conflict (key) do nothing;
