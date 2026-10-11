import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ChartAutoZone, ChartZoneContext } from '@/common/components/ticker/AdvancedPriceChart';

export interface TickerZone {
  center: number;
  low: number;
  high: number;
  score: number;      // 0-100
  touches: number;
  sources: string[];  // e.g. ['orh', 'premarket_high', 'round_1', 'swing_high_30m']
  type: 'support' | 'resistance';
  /** Each point behind the zone, newest date first (absent on older cached responses). */
  touch_detail?: { price: number; date: string | null; source: string }[];
  /** Scoring v2 breakdown — touch/30, recency/20, volume/15, confluence/35. */
  score_terms?: { touch: number; recency: number; volume: number; confluence: number; score: number };
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
  prior_day?: { high: number; low: number; close: number };
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

/** Zones farther than this from price are left off the chart — a far daily
 *  swing zone would otherwise stretch the y-axis and crush the candles. */
const CHART_ZONE_MAX_DISTANCE_PCT = 0.20;

/** ZoneEngine zones → AdvancedPriceChart's `autoZones`, bounded to
 *  CHART_ZONE_MAX_DISTANCE_PCT of price. */
export function toChartAutoZones(data: TickerZones | undefined): ChartAutoZone[] | null {
  if (!data) return null;
  const price = data.current_price;
  const map = (z: TickerZone, type: ChartAutoZone['type']): ChartAutoZone => ({
    id: `${type}_${z.center}`, low: z.low, high: z.high, score: z.score, touches: z.touches, sources: z.sources, type,
    touchDetail: z.touch_detail, scoreTerms: z.score_terms,
  });
  return [
    ...data.support.filter(z => (price - z.low) / price <= CHART_ZONE_MAX_DISTANCE_PCT).map(z => map(z, 'support')),
    ...data.resistance.filter(z => (z.high - price) / price <= CHART_ZONE_MAX_DISTANCE_PCT).map(z => map(z, 'resistance')),
  ];
}

/**
 * Chart-ready auto zones for `ticker` plus the market context the zone
 * detail sheet shows, fetched only while `enabled` (the "Auto-detected
 * zones" setting, and the chart being visible) — the fetch is a real, if
 * 90s-cached, yfinance call. Shared by the Charts tab and
 * PriceChartFullScreen.
 */
export function useChartAutoZones(
  ticker: string | null | undefined,
  enabled: boolean,
): { zones: ChartAutoZone[] | null; context: ChartZoneContext | null } {
  const { data } = useTickerZones(enabled ? ticker : null);
  // Memoized on the query data: a fresh array every render made the TV
  // chart rebuild (and re-stringify) its zone bands on every live tick.
  return useMemo(() => {
    if (!enabled || !data) return { zones: null, context: null };
    return {
      zones: toChartAutoZones(data),
      context: {
        currentPrice: data.current_price ?? null,
        atr: data.atr ?? null,
        priorDay: data.prior_day ?? null,
        timeframe: data.timeframe ?? null,
      },
    };
  }, [enabled, data]);
}
