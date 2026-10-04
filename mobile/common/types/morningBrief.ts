/** Morning brief (TODO 8) — mirrors api/services/brief/brief_service.py. */

export type BriefPlayStatus =
  | 'watching'               // 9:00–9:28, before the lock
  | 'armed'                  // locked, waiting for the 1m trigger
  | 'checking'               // trigger hit, running guards + Technicals Gate
  | 'awaiting_confirmation'  // confirm-first play, 3-minute window
  | 'working'                // limit buy working
  | 'filled'
  | 'cancelled'
  | 'scratch'
  | 'skipped'
  | 'expired'
  | 'stood_down'
  | 'cut'
  | 'error';

export type BriefPlayMode = 'confirm' | 'auto';

export type BriefOrderState =
  | 'SELECTED' | 'WORKING' | 'FILLED' | 'CANCELLED_TIMEOUT'
  | 'CANCELLED_STALE' | 'SCRATCH' | 'ERROR';

export interface BriefOrder {
  state: BriefOrderState;
  symbol?: string;
  strike?: number;
  qty?: number;
  profile?: string;
  limit?: number;
  limit_basis?: 'ask' | 'mid';
  spread_pct?: number;
  delta_target?: number;
  order_id?: string;
  /** epoch seconds (server clock) the limit order was submitted */
  started_at?: number;
  /** auto-cancel after this many seconds */
  timeout?: number;
  filled_qty?: number;
  avg_price?: number;
  reason?: string;
}

export interface BriefZone { low: number; high: number; score: number }

export interface BriefPlay {
  ticker: string;
  direction: 'CALL' | 'PUT';
  score: number;
  components: Record<string, number>;
  trigger: number;
  target: number;
  invalidation: number;
  expected_move: number;
  trigger_zone: BriefZone;
  target_zone: BriefZone;
  distance_to_trigger_pct: number;
  reward_risk: number;
  price: number;
  technicals: { trend: string | null; rsi: number | null; sector: string | null };
  gap_pct: number;
  pm_high: number | null;
  pm_low: number | null;
  /** always null on a listed play (blocked tickers go to MorningBrief.blocked) */
  blocked: string | null;
  mode: BriefPlayMode;
  status: BriefPlayStatus;
  status_reason: string | null;
  history: { at: string; event: string; reason: string | null }[];
  baseline_1m: number | null;
  gate_at_trigger?: string | null;
  confirm_expires_at?: string;
  order?: BriefOrder;
  trade_id?: string;
  /** latest underlying price from the live 1m bars (null before 9:30) */
  live_price: number | null;
}

export interface MorningBrief {
  brief_date: string;
  phase: 'build' | 'rescore' | 'lock';
  locked: boolean;
  generated_at: string | null;
  updated_at: string;
  correlation_label: string | null;
  blocked: { ticker: string; reason: string }[];
  plays: BriefPlay[];
  /** epoch seconds — server clock at response time */
  server_time: number;
}

// ── Paper-testing loop (part 3) ─────────────────────────────────────────────

export type SignalPath = 'A' | 'B';
export type SignalOutcome = 'target_hit' | 'stopped' | 'expired';

export interface PaperSignal {
  id: string;
  signal_path: SignalPath;
  signal_date: string;
  ticker: string;
  direction: 'CALL' | 'PUT';
  signal_at: string | null;
  signal_price: number | null;
  setup_score: number | null;
  zone_score: number | null;
  gate_decision: string | null;
  gate_agree: number | null;
  gate_total: number | null;
  trigger: number;
  target: number;
  invalidation: number;
  fill_status: string;
  trade_id: string | null;
  contract_symbol: string | null;
  qty: number | null;
  profile: string | null;
  entry_premium: number | null;
  paper_mode: boolean;
  outcome: SignalOutcome | null;
  mfe_pct: number | null;
  mae_pct: number | null;
  pnl: number | null;
  pnl_pct: number | null;
}

export interface SignalStats {
  signals: number;
  traded: number;
  fill_rate: number | null;
  win_rate: number | null;
  avg_return_pct: number | null;
  total_pnl: number;
  target_hit_rate: number | null;
  stopped_rate: number | null;
  expired_rate: number | null;
}

export interface BriefReview {
  start: string;
  end: string;
  paper_only: boolean;
  overall: SignalStats;
  by_path: Record<SignalPath, SignalStats>;
  by_zone_score: (SignalStats & { bucket: string; path: SignalPath })[];
  by_setup_score: (SignalStats & { bucket: string })[];
  signals: PaperSignal[];
}

export interface BriefConfigBound { default: number; min: number; max: number; type: 'int' | 'float' }

export interface BriefConfig {
  settings: Record<string, number>;
  bounds: Record<string, BriefConfigBound>;
}
