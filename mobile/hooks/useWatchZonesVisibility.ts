import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'chart_show_watch_zones_v1';
const QUERY_KEY = ['chart-show-watch-zones'];
const DEFAULT_VISIBLE = true;

async function loadVisible(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_VISIBLE : raw === '1';
  } catch {
    return DEFAULT_VISIBLE;
  }
}

/**
 * Whether watch zones (key levels) are drawn on AdvancedPriceChart — a
 * global, persisted preference rather than per-instance component state.
 * The chart remounts on every ticker switch (`key={activeTicker}` in
 * charts.tsx) and again on every app restart, so a plain useState would
 * silently reset to the default each time; this survives both, the same
 * AsyncStorage + React-Query-cache-mirror pattern as useChartPriceSource/
 * useSearchBarVisibility.
 */
export function useWatchZonesVisibility() {
  const qc = useQueryClient();
  const { data: visible = DEFAULT_VISIBLE } = useQuery<boolean>({
    queryKey: QUERY_KEY,
    queryFn: loadVisible,
    staleTime: Infinity,
  });

  const setVisible = useCallback(async (next: boolean) => {
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the toggle for the rest of this session even if the write fails.
    }
  }, [qc]);

  return { visible, setVisible };
}
