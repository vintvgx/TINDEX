import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface IntradayChartData {
  available: boolean;
  dates: string[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
  vwap: number[];
  /** Null for the first 14 bars of the session (insufficient window for RSI-14) */
  rsi: (number | null)[];
}

/**
 * Intraday price/volume/VWAP/RSI for one ticker on one specific past session
 * day — powers the Daily Review's per-trade chart (see ReviewTradeChart.tsx).
 * Only fetches when `enabled` (the trade card is expanded) — this hits a live
 * yfinance call per ticker/date, so it's deliberately not prefetched for every
 * trade in a review up front.
 */
export function useReviewTradeChart(ticker: string, date: string, enabled: boolean) {
  return useQuery<IntradayChartData>({
    queryKey: ['review-trade-chart', ticker, date],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/ticker/${ticker}/history-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to fetch chart data');
      return json.data as IntradayChartData;
    },
    enabled: enabled && !!ticker && !!date,
    staleTime: 60 * 60_000, // a past day's bars never change — cache for the session
    retry: 1,
  });
}
