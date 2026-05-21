/**
 * Portfolio position as stored in Supabase (public.portfolio_positions).
 * Critical fields: position_type, status, opened_at, realized_pnl, strategy.
 * Positions are added from the calendar (New Trade) and from the Portfolio modal.
 */
export type PositionType = "long" | "short";
export type PortfolioStatus = "open" | "closed" | "partial";
export type PortfolioStrategy = "ORB" | "swing" | "scalp";

export interface PortfolioPosition {
  id: string;
  user_id: string;
  ticker: string;
  shares: number;
  average_cost: number;
  created_at: string;
  updated_at: string;

  position_type: PositionType;
  status: PortfolioStatus;``
  opened_at: string;
  closed_at: string | null;
  realized_pnl: number | null;
  strategy: PortfolioStrategy;
}

/** Payload to add or update a position (upsert by user_id + ticker). */
export interface PortfolioPositionUpsert {
  ticker: string;
  shares: number;
  average_cost: number;
  position_type?: PositionType;
  strategy?: PortfolioStrategy;
  /** When the position was opened (e.g. from calendar date); defaults to now(). */
  opened_at?: string;
}

/**
 * Aggregated portfolio for a user (public.portfolio).
 * Compiled from portfolio_positions via trigger; used for P&L and performance.
 */
export interface PortfolioSummary {
  user_id: string;
  total_cost_basis: number;
  total_current_value: number | null;
  total_realized_pnl: number;
  total_unrealized_pnl: number | null;
  performance_pct: number | null;
  positions_count: number;
  updated_at: string;
}
