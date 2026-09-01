import type { PricePeriod } from '@/common/types/blogPosts/ticker';

/**
 * Mirrors api/services/yfinance/yfinance_service.py's ALLOWED_INTERVALS
 * exactly — every bar granularity a client may request per period,
 * constrained by Yahoo's real lookback limits for sub-daily bars (roughly
 * 60 days for intervals <=60m). Keep these two lists in sync; the backend
 * is the actual source of truth (it silently ignores anything not in its
 * own copy), this one only drives which chips the picker shows.
 */
export const ALLOWED_INTERVALS: Record<PricePeriod, string[]> = {
  '1D':  ['5m', '15m'],
  '1W':  ['15m', '30m', '1h'],
  '1M':  ['1h', '1d'],
  '3M':  ['1d', '1wk'],
  YTD:   ['1d', '1wk'],
  '1Y':  ['1d', '1wk'],
  '5Y':  ['1wk', '1mo'],
};

/** Matches PERIOD_MAP's default interval for each period on the backend. */
export const DEFAULT_INTERVAL: Record<PricePeriod, string> = {
  '1D':  '5m',
  '1W':  '30m',
  '1M':  '1d',
  '3M':  '1d',
  YTD:   '1d',
  '1Y':  '1d',
  '5Y':  '1wk',
};

export const INTERVAL_LABEL: Record<string, string> = {
  '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H',
  '1d': '1D', '1wk': '1W', '1mo': '1M',
};

/** Minutes-per-bar for the intraday intervals used to reserve a fixed
 *  session width on the 1D chart — see AdvancedPriceChart's
 *  fullSessionBarCount. Only 1D's own intervals need an entry here. */
export const INTERVAL_MINUTES: Record<string, number> = {
  '5m': 5, '15m': 15, '30m': 30, '1h': 60,
};
