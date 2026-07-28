export type ProfileKey =
  | 'BULL_DOG' | 'THUNDER_CAT' | 'WOLF' | 'TREND_RIDER' | 'RETESTER' | 'REVERSAL' | 'CUSTOM'
  // Immediate trade profiles (conviction / manual entries)
  | 'SCALPER' | 'PRECISION' | 'MOMENTUM' | 'CONVICTION' | 'ALL_IN'
  // OTM-specific profiles (auto-selected for cheap out-of-money contracts)
  | 'OTM_RUNNER' | 'OTM_CONVICTION'
  | 'MANUAL';

export type TradeType = 'STRATEGY' | 'IMMEDIATE';

export interface CustomThresholds {
  qty_contracts:           number;
  max_loss_pct:            number;
  tp1_mult:                number;
  tp2_mult:                number;
  tp1_close_pct:           number;
  tp2_close_pct:           number;
  runner_trail_pct:        number;
  consol_exit:             boolean;
  volume_exit:             boolean;
  consol_range_pct:        number;
  consol_bars:             number;
  volume_exit_threshold:   number;
  strike_offset_min:       number;
  strike_offset_max:       number;
  target_delta_min:        number;
  target_delta_max:        number;
  eod_buffer_minutes:      number;
  breakout_time_limit_min: number;
  vix_max_override:        number;
}

export interface ProfileThresholds {
  qty_contracts: number;
  max_loss_pct: number;
  tp1_mult: number;
  tp2_mult: number;
  tp1_close_pct: number;
  tp2_close_pct: number;
  runner_trail_pct: number;
  consol_exit: boolean;
  volume_exit: boolean;
  consol_range_pct: number;
  consol_bars: number;
  volume_exit_threshold: number;
  strike_offset_min: number;
  strike_offset_max: number;
  target_delta_min: number;
  target_delta_max: number;
  eod_buffer_minutes: number;
  breakout_time_limit_min: number;
  vix_max_override: number;
}

export interface StrategyProfile {
  key: ProfileKey;
  display_name: string;
  emoji: string;
  contracts: number;
  max_loss_pct: number;   // integer percent, e.g. 35
  tp1_pct: number;        // integer percent, e.g. 50
  tp2_pct: number;        // integer percent, e.g. 100
  runner: boolean;
  use_tp2: boolean;
  /** "trail" (high-water-mark trailing stop) or "be_hold" (rides to TP2/
   *  breakeven-stop/EOD, no trail) — see profiles.py's describe_profile(). */
  runner_mode?: 'trail' | 'be_hold';
  risk_level: 'Low' | 'Medium' | 'High' | 'Medium-High' | 'Custom';
  vix_max: number;
  breakout_limit_min: number;
  thresholds: ProfileThresholds;
  entry_mode?: 'BREAK' | 'RETEST';
}

export type OtmFibLevel = '1.0' | '1.618' | '2.618';

export interface ExitOverrides {
  consol_exit: boolean;
  volume_exit: boolean;
}

export interface StrategyConfig {
  id: string;
  strategy_name: string;
  ticker: string;
  paper_mode: boolean;
  active: boolean;
  profile: ProfileKey;
  trade_days: number[];
  capital_limit: number | null;
  bypass_breakout_window: boolean;
  custom_thresholds: CustomThresholds | null;
  exit_overrides: ExitOverrides | null;
  budget_otm_mode: boolean;
  otm_fib_level: OtmFibLevel;
  smart_contracts: boolean;
  debug_mode: boolean;
  confirm_entry: boolean;
  has_position?: boolean;
  qty_remaining?: number | null;
}

export type PendingConfirmationStatus = 'PENDING' | 'APPROVED' | 'SKIPPED' | 'EXPIRED';

export interface PendingConfirmation {
  id: string;
  strategy_id: string;
  ticker: string;
  profile: ProfileKey;
  direction: 'CALL' | 'PUT';
  contract_symbol: string;
  strike: number;
  qty: number;
  trigger_price: number;
  entry_estimate: number;
  confidence: number;   // 0-100
  confidence_breakdown: {
    breakout_strength: number;
    vwap_alignment: number;
    volume_surge: number;
    weights: { breakout_strength: number; vwap_alignment: number; volume_surge: number };
  } | null;
  hard_stop: number;
  tp1: number;
  tp2: number | null;
  status: PendingConfirmationStatus;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  /** Set only when this pause was triggered by another engine already
   *  holding the same ticker+direction open (not the opt-in confirm_entry
   *  toggle) — describes that other position so the modal can explain why. */
  conflict_context: {
    ticker: string;
    direction: 'CALL' | 'PUT';
    profile: ProfileKey;
    strategy_id: string | null;
    strategy_name: string | null;
    paper_mode: boolean;
    entry_premium: number | null;
    entry_time: string | null;
  } | null;
}

/** Live price message shape pushed over /ws/strategy/<id>/live while a
 *  confirmation is pending (distinct from the post-entry "price_update" type). */
export interface PendingPriceUpdate {
  type: 'pending_price_update';
  pending_id: string;
  contract: string;
  mid_price: number;
  hard_stop_preview: number;
  tp1_preview: number;
  tp2_preview: number | null;
}

export type DebugLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface DebugLogEntry {
  id: string;   // UUID from Supabase
  ts: string;
  level: DebugLevel;
  message: string;
  data: Record<string, unknown> | null;
  strategy_id: string | null;
  ticker: string | null;
  strategy_name: string | null;
}

export interface DebugLogsResponse {
  debug_enabled: boolean;
  logs: DebugLogEntry[];
}

/** Ticker-based immediate trade (not tied to a saved strategy). */
export interface ImmediateTradeByTickerRequest {
  ticker: string;
  direction: 'CALL' | 'PUT';
  contract_symbol: string;
  qty?: number;
  profile?: ProfileKey;
  paper_mode: boolean;
  consol_exit?: boolean;
  volume_exit?: boolean;
  max_loss_pct?: number; // MANUAL profile: decimal (e.g. 0.30 = 30% SL)
}

/** An open position from a ticker-based immediate trade engine. */
export interface ImmediatePosition {
  strategy_id: string;
  ticker: string;
  paper_mode: boolean;
  direction: 'CALL' | 'PUT';
  contract: string;
  profile: ProfileKey;
  qty_remaining: number;
  entry_premium: number | null;
  mid_price: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  tp1_hit: boolean;
  tp2_hit: boolean;
}

export interface FibLevels {
  'up_1.0': number;
  'up_1.618': number;
  'up_2.618': number;
  'dn_1.0': number;
  'dn_1.618': number;
  'dn_2.618': number;
  mid: number;
  orh: number;
  orl: number;
}

export interface StrategyPosition {
  active: boolean;
  paper_mode: boolean;
  ticker: string;
  profile: ProfileKey;
  direction?: 'CALL' | 'PUT';
  contract?: string;
  qty_remaining?: number;
  qty_total?: number;
  entry_premium?: number;
  current_price?: number;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
  hard_stop?: number;
  tp1?: number;
  tp2?: number;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  be_stop_active?: boolean;
  runner_trail?: number;
  fib_levels?: FibLevels;
}

export interface ExitStage {
  reason: string;   // "TP1" | "TP2" | "HARD_STOP" | "RUNNER_TRAIL_STOP" | "EOD_CLOSE" | etc.
  qty: number;
  premium: number;
  pnl: number;      // dollar P&L for this partial close
  time: string;     // ISO timestamp
}

export interface ORBTrade {
  id: string;
  strategy_id: string | null;
  trade_date: string;
  ticker: string;
  profile: ProfileKey;
  direction: 'CALL' | 'PUT';
  contract_symbol: string;
  strike: number;
  expiry: string;
  entry_premium: number;
  exit_premium: number | null;
  qty_entered: number;
  qty_exited: number;
  pnl: number | null;
  pnl_pct: number | null;
  entry_time: string;
  exit_time: string | null;
  exit_reason: string | null;
  orh: number;
  orl: number;
  vix_at_entry: number | null;
  underlying_price_entry: number | null;
  underlying_price_exit: number | null;
  flow_confirmed: boolean;
  fib_targets?: Record<string, number> | null;
  paper_mode?: boolean;
  trade_type?: TradeType;
  // ── Per-stage exit detail (populated as each partial close fires) ──────────
  tp1_premium?: number | null;
  tp1_qty?: number | null;
  tp1_pnl?: number | null;
  tp2_premium?: number | null;
  tp2_qty?: number | null;
  tp2_pnl?: number | null;
  exit_stages?: ExitStage[] | null;
  // ── Account-level snapshot (only populated for trades logged going forward) ─
  account_balance_before?: number | null;
  account_balance_after?: number | null;
  account_balance_change?: number | null;
  // ── Live unrealized P&L — only present while the row is still open
  //    (exit_time is null). Computed at response time from a live quote,
  //    never written to the DB, and distinct from pnl/pnl_pct above (which
  //    stay null until a real exit/partial-close event). See
  //    api/routes/strategy_routes.py's _enrich_open_trades_with_live_pnl.
  live_price?: number;
  live_pnl?: number;
  live_pnl_pct?: number;
}

export interface StrategyStats {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  total_pnl: number;
  avg_winner: number;
  avg_loser: number;
  profile?: ProfileKey;
}

export interface RatingBreakdownItem {
  score: number;
  max: number;
  value: number;
  label: string;
}

export interface RatingResult {
  score: number;
  grade: string;
  label: string;
  profit_factor: number;
  breakdown: Record<string, RatingBreakdownItem>;
}

export interface StrategyRating extends StrategyStats, RatingResult {}

export interface StrategyPerformance {
  overall: StrategyRating;
  by_strategy: Array<StrategyRating & {
    strategy_id: string;
    strategy_name: string;
    ticker: string;
    profile: ProfileKey;
  }>;
  by_profile: Array<StrategyRating & { profile: ProfileKey }>;
}

export interface LiveOptionPrice {
  contract:      string;
  mid_price:     number;
  entry_premium: number;
  pnl:           number;
  pnl_pct:       number;
  qty_remaining: number;
  market_value:  number;
  tp1_hit:       boolean;
  tp2_hit:       boolean;
  hard_stop:     number;
  tp1:           number;
  tp2:           number;
}

export interface AlpacaAccount {
  equity: number;
  /** Start-of-day equity baseline — lets the client recompute today's P&L
   *  against a live-derived equity instead of only this endpoint's own. */
  last_equity?: number;
  cash: number;
  buying_power: number;
  day_trade_count: number;
  pnl_today: number;
  pnl_today_pct: number;
  paper_mode: boolean;
  /** Non-marginable buying power — the account's actual unlevered spending
   *  power, distinct from buying_power (which reflects margin). */
  available_balance?: number;
  options_buying_power?: number;
  long_market_value?: number;
  short_market_value?: number;
}

export interface ORBSession {
  date: string;
  ticker: string;
  profile: ProfileKey;
  trade_days: number[];
  paper_mode: boolean;
  orh: number | null;
  orl: number | null;
  orb_range: number | null;
  fib_levels: FibLevels | null;
  trade_taken: boolean;
  skip_reason: string | null;
  position: 'CALL' | 'PUT' | null;
  contract: string | null;
  exit_state: {
    entry_premium: number;
    hard_stop: number;
    tp1: number;
    tp2: number;
    runner_trail: number;
    tp1_hit: boolean;
    tp2_hit: boolean;
    be_stop_active: boolean;
    qty: number;
    qty_remaining: number;
  } | null;
}
