import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ChartPriceSource = 'alpaca' | 'yfinance';

const STORAGE_KEY = 'chart_price_source_v1';
const QUERY_KEY = ['chart-price-source'];
const DEFAULT_SOURCE: ChartPriceSource = 'yfinance';

async function loadSource(): Promise<ChartPriceSource> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === 'yfinance' ? 'yfinance' : DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
}

/**
 * Which live-price source PriceChartFullScreen uses — the real-time
 * paper-key Alpaca trade stream (useChartLiveStream) or the existing ~5s
 * yfinance poll (useMarketStream). The Alpaca stream is force-disabled
 * (Railway errors from the paper-key connection) — 'alpaca' is never
 * returned even if a device has it persisted from before, and the Profile
 * toggle's Alpaca option is disabled so it can't be re-selected. Persisted
 * to AsyncStorage and mirrored into the React Query cache (same pattern as
 * useSearchBarVisibility) so PriceChartFullScreen re-renders if this is
 * ever re-enabled.
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
