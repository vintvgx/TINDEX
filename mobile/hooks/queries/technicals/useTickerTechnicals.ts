import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface TickerTechnicals {
  ticker: string;
  current_price: number;
  ema20: number;
  ema50: number | null;
  ema200: number | null;
  rsi: number;
  macd_above_signal: boolean;
  macd_value: number;
  atr: number;
  trend: 'up' | 'down' | 'sideways' | 'unknown';
  ema_aligned: boolean;
  dist_from_ema20_pct: number;
  zone: 'bullish' | 'extended' | 'neutral' | 'bearish';
  last_fetched_utc: string;
}

export function useTickerTechnicals(ticker: string | null | undefined) {
  return useQuery<TickerTechnicals>({
    queryKey: ['technicals', ticker],
    enabled: !!ticker,
    staleTime: 8 * 60 * 60 * 1000,
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/technicals/${ticker}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch technicals');
      return json.data as TickerTechnicals;
    },
  });
}
