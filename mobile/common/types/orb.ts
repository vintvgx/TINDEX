/**
 * ORB (Opening Range Breakout) domain types.
 * Matches database columns for orb_ranges and orb_breakouts including gap/trend enrichment.
 */

export type GapDirection = "up" | "down" | "flat";
export type PriorDayTrend = "bullish" | "bearish" | "flat";

export interface ORBRange {
  id?: string;
  ticker: string;
  trade_date: string;
  orb_high: number;
  orb_low: number;
  opening_price: number;
  volume_in_range: number;
  /** Gap/trend enrichment (from GapAnalysisService) */
  prior_close: number | null;
  today_open: number | null;
  gap_points: number | null;
  gap_percent: number | null;
  gap_direction: GapDirection | null;
  prior_day_open: number | null;
  prior_day_trend: PriorDayTrend | null;
  trend_continuation: boolean | null;
}

export interface ORBBreakout {
  id?: string;
  ticker: string;
  trade_date: string;
  breakout_type: "above" | "below";
  breakout_price: number;
  breakout_time: string;
  orb_high: number;
  orb_low: number;
  /** Gap/trend context on breakout event */
  gap_percent: number | null;
  gap_direction: GapDirection | null;
  prior_day_trend: PriorDayTrend | null;
  trend_continuation: boolean | null;
  breakout_aligns_gap: boolean | null;
}

/**
 * Minimal shape for displaying gap/trend badges when full ORBRange or notification payload is available.
 */
export interface GapTrendContext {
  gap_percent: number | null;
  gap_points: number | null;
  gap_direction: GapDirection | null;
  prior_day_trend: PriorDayTrend | null;
  trend_continuation: boolean | null;
  breakout_aligns_gap?: boolean | null;
}
