export type ZeroDTETier = 'FIRE' | 'SET' | 'WATCH' | 'CANDIDATE';
export type ContractType = 'call' | 'put';

export interface ZeroDTEOpportunity {
  id?: string;
  scan_date: string;
  scan_time: string;
  ticker: string;
  contract_type: ContractType;
  strike: number;
  expiry: string;
  composite_score: number;
  tier: ZeroDTETier;
  flow_score: number;
  intraday_score: number;
  dollar_flow: number;
  vol_oi: number;
  is_sweep: boolean;
  is_floor: boolean;
  aggressor?: string;
  uw_score: number;
  current_price: number;
  vwap: number | null;
  above_vwap: boolean | null;
  trend_aligned: boolean | null;
  iv_pct: number;
  otm_pct: number;
  premium: number;
  minutes_remaining: number;
  time_penalty?: number;
  fail_reason?: string;
}

export interface ZeroDTEScanMeta {
  scan_time: string;
  scan_date: string;
  uw_flows_raw: number;
  zero_dte_flows: number;
  candidates: number;
  surfaced: number;
  minutes_remaining: number;
  time_penalty: number;
  duration_sec: number;
}

export const TIER_CONFIG: Record<ZeroDTETier, { label: string; color: string; bg: string; emoji: string }> = {
  FIRE:      { label: 'FIRE',      color: '#F97316', bg: '#431407', emoji: '🔥' },
  SET:       { label: 'SET',       color: '#10B981', bg: '#064E3B', emoji: '✅' },
  WATCH:     { label: 'WATCH',     color: '#94A3B8', bg: '#1E293B', emoji: '👁' },
  CANDIDATE: { label: 'CANDIDATE', color: '#64748B', bg: '#1E293B', emoji: '🔍' },
};

// ── Position profiles ─────────────────────────────────────────────────────────

export type ZeroDTEProfileName = 'SCALP' | 'MOMENTUM' | 'AGGRESSIVE';

export const ZERO_DTE_PROFILE_LABELS: Record<ZeroDTEProfileName, string> = {
  SCALP:      'Scalp',
  MOMENTUM:   'Momentum',
  AGGRESSIVE: 'Aggressive',
};

export const ZERO_DTE_PROFILE_DESCRIPTIONS: Record<ZeroDTEProfileName, string> = {
  SCALP:      '30% stop · full exit at +30%',
  MOMENTUM:   '40% stop · 50% at +40%, rest at +80%',
  AGGRESSIVE: '50% stop · 40% at +60%, runners to +120%',
};

export interface ZeroDTEPosition {
  id: string;
  user_id: string;
  watchlist_ref_id?: string;
  ticker: string;
  contract_type: ContractType;
  strike: number;
  expiry: string;
  qty: number;
  qty_remaining: number;
  entry_price: number;
  strategy_profile: ZeroDTEProfileName;
  stop_pct: number;
  stop_price: number;
  tp_ladder: Array<{ level: string; pct: number; qty_pct: number; hit: boolean }>;
  mode: 'paper' | 'live';
  status: 'open' | 'closed' | 'partially_closed' | 'expired';
  realized_pnl: number | null;
  closed_at: string | null;
  created_at: string;
}
