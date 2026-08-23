import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ChartPriceSource = 'alpaca' | 'yfinance';

const STORAGE_KEY = 'chart_price_source_v1';
const QUERY_KEY = ['chart-price-source'];
// 'alpaca' as of 2026-08-24 — the paper-key stream now runs under a
// genuinely separate Alpaca account (its own connection allowance; Alpaca's
// "one connection" cap is per-user, not per paper/live sub-account, so the
// original same-account paper key collided with OrbService's own live-key
// stock stream — see docs/incidents/2026-07-13-orb-stream-connection-limit.md
// and stock_chart_stream.py's docstring). 'yfinance' stays available as a
// fallback via the Profile toggle if the new connection ever misbehaves.
const DEFAULT_SOURCE: ChartPriceSource = 'alpaca';

async function loadSource(): Promise<ChartPriceSource> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === 'alpaca' || raw === 'yfinance' ? raw : DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
}

/**
 * Which live-price source PriceChartFullScreen and the Charts tab use — the
 * real-time Alpaca trade stream (useChartLiveStream) or the ~5s yfinance
 * poll (useMarketStream). User-selectable from Profile; persisted to
 * AsyncStorage and mirrored into the React Query cache (same pattern as
 * useSearchBarVisibility) so both chart screens re-render on a change.
 */
export function useChartPriceSource() {
  const qc = useQueryClient();
  const { data: source = DEFAULT_SOURCE } = useQuery<ChartPriceSource>({
    queryKey: QUERY_KEY,
    queryFn: loadSource,
    staleTime: Infinity,
  });

  const setSource = useCallback(async (next: ChartPriceSource) => {
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the toggle for the rest of this session even if the write fails.
    }
  }, [qc]);

  return { source, setSource };
}
