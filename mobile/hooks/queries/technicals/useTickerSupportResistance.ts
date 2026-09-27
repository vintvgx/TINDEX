import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface SupportResistanceLevel {
  price: number;
  touches: number;
  strength: number;
  type: 'support' | 'resistance';
}

export interface TickerSupportResistance {
  ticker: string;
  current_price: number;
  support: SupportResistanceLevel[];
  resistance: SupportResistanceLevel[];
  pivots: { pivot: number; r1: number; r2: number; s1: number; s2: number };
  last_fetched_utc: string;
}

/**
 * Historical (multi-day) support/resistance for a ticker — swing-point
 * clustering over 2 years of daily bars plus standard pivot points, computed
 * server-side (see technical_service.get_support_resistance). A different
 * concept from ORB's orh/orl: this aggregates across days, ORB is same-
 * session only. Same 8h staleTime as useTickerTechnicals — this is a slow-
 * moving, multi-day computation, not something that needs to repoll.
 */
export function useTickerSupportResistance(ticker: string | null | undefined) {
  return useQuery<TickerSupportResistance>({
    queryKey: ['support-resistance', ticker],
    enabled: !!ticker,
    staleTime: 8 * 60 * 60 * 1000,
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/support-resistance/${ticker}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch support/resistance');
      return json.data as TickerSupportResistance;
    },
  });
}
