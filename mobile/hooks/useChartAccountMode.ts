import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ChartAccountMode = 'live' | 'paper';

const STORAGE_KEY = 'chart_account_mode_v1';
const QUERY_KEY = ['chart-account-mode'];
const DEFAULT_MODE: ChartAccountMode = 'live';

async function loadMode(): Promise<ChartAccountMode> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === 'live' || raw === 'paper' ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/**
 * Which Alpaca account the Charts tab's bottom account strip
 * (LiveAccountStrip) shows — live or paper. User-selectable from Profile;
 * persisted to AsyncStorage and mirrored into the React Query cache (same
 * pattern as useChartPriceSource) so the strip re-renders on a change.
 */
export function useChartAccountMode() {
  const qc = useQueryClient();
  const { data: mode = DEFAULT_MODE } = useQuery<ChartAccountMode>({
    queryKey: QUERY_KEY,
    queryFn: loadMode,
    staleTime: Infinity,
  });

  const setMode = useCallback(async (next: ChartAccountMode) => {
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the choice for the rest of this session even if the write fails.
    }
  }, [qc]);

  return { mode, setMode };
}
