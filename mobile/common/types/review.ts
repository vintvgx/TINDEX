export interface PerformanceReviewSummary {
  review_date: string;
  net_pnl: number;
  trade_count: number;
  win_rate: number;
  winners: number;
  losers: number;
  created_at: string;
  is_reviewed: boolean;
}

export interface ReviewTrade {
  ticker: string;
  profile: string;
  direction: 'CALL' | 'PUT';
  contract_symbol: string;
  strike: number;
  entry_premium: number;
  exit_premium: number | null;
  qty_entered: number;
  qty_exited: number;
  pnl: number;
  pnl_pct: number;
  exit_reason: string;
  entry_time: string;
  exit_time: string | null;
  underlying_price_entry: number | null;
  underlying_price_exit: number | null;
  vix_at_entry: number | null;
  orh: number | null;
  orl: number | null;
  paper_mode: boolean;
  exit_stages?: Array<{
    reason: string;
    qty: number;
    premium: number;
    pnl: number;
    time: string;
  }>;
}

export interface PerformanceReview extends PerformanceReviewSummary {
  markdown: string;
  trades_json: ReviewTrade[];
}
