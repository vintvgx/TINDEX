export type ProfileKey = 'BULL_DOG' | 'THUNDER_CAT' | 'WOLF' | 'CUSTOM';

export interface CustomThresholds {
  qty_contracts:           number;
  max_loss_pct:            number;
  tp1_mult:                number;
  tp2_mult:                number;
  tp1_close_pct:           number;
  tp2_close_pct:           number;
  runner_trail_pct:        number;
  consol_exit:             boolean;
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
  risk_level: 'Low' | 'Medium' | 'High';
  vix_max: number;
  breakout_limit_min: number;
  thresholds: ProfileThresholds;
}

export type OtmFibLevel = '1.0' | '1.618' | '2.618';

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
  budget_otm_mode: boolean;
  otm_fib_level: OtmFibLevel;
  debug_mode: boolean;
  has_position?: boolean;
}

export type DebugLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface DebugLogEntry {
  id: number;
  ts: string;
  level: DebugLevel;
  message: string;
  data: Record<string, unknown> | null;
  strategy_id: string;
  ticker: string;
  strategy_name: string;
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

export interface ORBTrade {
  id: string;
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
  flow_confirmed: boolean;
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

export interface LiveOptionPrice {
  contract:      string;
  mid_price:     number;
  entry_premium: number;
  pnl:           number;
  pnl_pct:       number;
  qty_remaining: number;
  tp1_hit:       boolean;
  tp2_hit:       boolean;
  hard_stop:     number;
  tp1:           number;
  tp2:           number;
}

export interface AlpacaAccount {
  equity: number;
  cash: number;
  buying_power: number;
  day_trade_count: number;
  pnl_today: number;
  pnl_today_pct: number;
  paper_mode: boolean;
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
