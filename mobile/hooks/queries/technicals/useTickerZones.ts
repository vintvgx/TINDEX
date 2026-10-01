import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface TickerZone {
  center: number;
  low: number;
  high: number;
  score: number;      // 0-100
  touches: number;
  sources: string[];  // e.g. ['orh', 'premarket_high', 'round_1', 'swing_high_30m']
  type: 'support' | 'resistance';
}

export interface TickerFlippedZone {
  zone_id: string;
  low: number;
  high: number;
  original_type: 'support' | 'resistance';
  current_type: 'support' | 'resistance';
  score: number;
  sources: string[];
  flipped_at: string;
}

export interface TickerZones {
  ticker: string;
  current_price: number;
  atr: number | null;
  tolerance: number;
  timeframe: string;
  resistance: TickerZone[];
  support: TickerZone[];
  /** Whether StructureTracker watches this ticker's live bars. Only
   *  ORB-followed tickers are tracked; for anything else there are no live
   *  BOS/approach/break events and `trend` is null / `flips` is empty, while
   *  the zones themselves still come back (see /strategy/zones). */
  tracked: boolean;
  /** True when the market-data fetch timed out and these are the last
   *  cached zones rather than a fresh computation. */
  stale: boolean;
  /** null when untracked (see `tracked`). */
  trend: 'uptrend' | 'downtrend' | 'range' | null;
  flips: TickerFlippedZone[];
  last_fetched_utc: string;
}

/**
 * ZoneEngine's multi-source, multi-timeframe support/resistance zones
 * (bands with a 0-100 confluence score), plus live structure state when the
 * ticker is being tracked — see api/services/strategy/zone_engine.py and
 * structure_tracker.py. A different, richer concept from
 * useTickerSupportResistance's single-timeframe swing-only levels: this
 * backs the chart's auto-zone shaded-band layer and the entry gate's "zone"
 * factor, not just a line overlay. 90s server-side cache on this endpoint
 * (ZoneEngine refreshes intraday), so a short staleTime here just avoids a
 * refetch on every unrelated re-render rather than trying to out-cache it.
 */
export function useTickerZones(ticker: string | null | undefined, timeframe: '5m' | '15m' | '30m' = '30m') {
  return useQuery<TickerZones>({
    queryKey: ['ticker-zones', ticker, timeframe],
    enabled: !!ticker,
    staleTime: 60_000,
    refetchInterval: ticker ? 90_000 : false,
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/zones/${ticker}?timeframe=${timeframe}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch zones');
      return json.data as TickerZones;
    },
  });
}
