export interface SwingScore {
  id: string;
  contract_symbol: string;
  scan_date: string;
  ticker: string;
  strike: number;
  expiry: string;
  side: 'call' | 'put';
  dte: number;
  composite_score: number;
  tier: 'Prime' | 'Strong' | 'Watch';
  flow_score: number;
  setup_score: number;
  breakdown: Record<string, number | string>;
  premium: number;
  iv_pct: number;
  vol: number;
  oi: number;
  vol_oi: number;
  dollar_flow: number;
  pct_at_ask: number;
  is_sweep: boolean;
  is_floor: boolean;
  unusual_score: number;
  scored_at: string;
}

export interface SwingWatchlistItem {
  id: string;
  user_id: string;
  contract_symbol: string;
  ticker: string;
  added_at: string;
  note?: string;
  // joined from latest swing_scores:
  latest_score?: SwingScore | null;
}

export interface SwingPosition {
  id: string;
  user_id: string;
  mode: 'paper' | 'live';
  contract_symbol: string;
  ticker: string;
  side: 'call' | 'put';
  qty: number;
  entry_price: number;
  entry_at: string;
  strategy_profile: SwingProfileName;
  stop_config: Record<string, unknown>;
  tp_ladder: Record<string, unknown>;
  status: 'open' | 'partially_closed' | 'closed';
  realized_pnl: number;
  unrealized_pnl: number;
  closed_at?: string;
}

export interface SwingRunLog {
  id: string;
  scan_date: string;
  run_at: string;
  uw_flows_raw: number;
  swing_eligible: number;
  candidates: number;
  scored: number;
  surfaced: number;
  errors?: unknown;
  duration_sec: number;
}

export type SwingProfileName =
  | 'CONSERVATIVE_SWING'
  | 'RUNNER'
  | 'DEFINED_RISK'
  | 'SCALP_SWING';

export const SWING_PROFILE_LABELS: Record<SwingProfileName, string> = {
  CONSERVATIVE_SWING: 'Conservative',
  RUNNER: 'Runner',
  DEFINED_RISK: 'Defined Risk',
  SCALP_SWING: 'Scalp Swing',
};

export const SWING_PROFILE_DESCRIPTIONS: Record<SwingProfileName, string> = {
  CONSERVATIVE_SWING: 'Tight ATR stop, scale out early, ratchet BE fast',
  RUNNER: 'Wider stop, small early trim, long trailing runner',
  DEFINED_RISK: 'Debit spread — capped max loss, 50% of spread value target',
  SCALP_SWING: 'Tight % stop, single full-close target, no runner',
};

export const TIER_COLORS: Record<SwingScore['tier'], string> = {
  Prime: '#FFD700',
  Strong: '#3B82F6',
  Watch: '#8B5CF6',
};
