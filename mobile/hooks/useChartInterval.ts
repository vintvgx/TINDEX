import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import { ALLOWED_INTERVALS, DEFAULT_INTERVAL } from '@/lib/chartIntervals';

const STORAGE_KEY = 'chart_interval_by_period_v1';
const QUERY_KEY = ['chart-interval-by-period'];

type IntervalMap = Partial<Record<PricePeriod, string>>;

async function loadMap(): Promise<IntervalMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Persisted bar-granularity choice, one per period (5m vs 15m on 1D, 1d vs
 * 1wk on 3M, etc.) — a GLOBAL, AsyncStorage-backed preference so it survives
 * ticker switches (the chart remounts per ticker) and app restarts, same
 * pattern as useWatchZonesVisibility/useCrosshairEnabled. Falls back to
 * DEFAULT_INTERVAL for any period never explicitly chosen, and silently
 * ignores/repairs a stored value that's no longer valid for that period
 * (e.g. ALLOWED_INTERVALS changed under it).
 */
export function useChartInterval(period: PricePeriod) {
  const qc = useQueryClient();
  const { data: map = {} } = useQuery<IntervalMap>({
    queryKey: QUERY_KEY,
    queryFn: loadMap,
    staleTime: Infinity,
  });

  const allowed = ALLOWED_INTERVALS[period];
  const stored = map[period];
  const interval = stored && allowed.includes(stored) ? stored : DEFAULT_INTERVAL[period];

  const setInterval = useCallback(async (next: string) => {
    if (!ALLOWED_INTERVALS[period].includes(next)) return;
    const current = qc.getQueryData<IntervalMap>(QUERY_KEY) ?? {};
    const nextMap = { ...current, [period]: next };
    qc.setQueryData(QUERY_KEY, nextMap);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextMap));
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the choice for the rest of this session even if the write fails.
    }
  }, [qc, period]);

  return { interval, setInterval, allowed };
}
