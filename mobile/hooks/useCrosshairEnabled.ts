import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'chart_crosshair_enabled_v1';
const QUERY_KEY = ['chart-crosshair-enabled'];
const DEFAULT_ENABLED = true;

async function loadEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_ENABLED : raw === '1';
  } catch {
    return DEFAULT_ENABLED;
  }
}

/**
 * Whether the tap/press-and-hold crosshair (scrubGesture + its SVG overlay)
 * is active on AdvancedPriceChart — a global, persisted preference so it can
 * be switched off as a quick A/B test for whether the crosshair's per-frame
 * React state updates are a source of chart lag, without needing a dev
 * build. Same AsyncStorage + React-Query-cache-mirror pattern as
 * useWatchZonesVisibility/useSearchBarVisibility.
 */
export function useCrosshairEnabled() {
  const qc = useQueryClient();
  const { data: enabled = DEFAULT_ENABLED } = useQuery<boolean>({
    queryKey: QUERY_KEY,
    queryFn: loadEnabled,
    staleTime: Infinity,
  });

  const setEnabled = useCallback(async (next: boolean) => {
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the toggle for the rest of this session even if the write fails.
    }
  }, [qc]);

  return { enabled, setEnabled };
}
