import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadSecureBoolPref, saveSecureBoolPref } from '@/lib/secureBoolPref';

const STORAGE_KEY = 'chart_show_auto_zones_v1';
const QUERY_KEY = ['chart-show-auto-zones'];
const DEFAULT_VISIBLE = true;

function loadVisible(): Promise<boolean> {
  return loadSecureBoolPref(STORAGE_KEY, DEFAULT_VISIBLE);
}

/**
 * Whether ZoneEngine's auto-detected zones are drawn on AdvancedPriceChart —
 * a global, persisted preference, same SecureStore + React-Query-cache-
 * mirror pattern as useWatchZonesVisibility, and deliberately the SAME
 * pattern rather than a prop threaded down from settings: AdvancedPriceChart
 * reads this hook directly (same as it reads useWatchZonesVisibility), and
 * useChartSettings' modal row writes through the same cache key, so toggling
 * from either the inline toolbar button or the settings modal stays in sync
 * with no plumbing between them.
 */
export function useAutoZonesVisibility() {
  const qc = useQueryClient();
  const { data: visible = DEFAULT_VISIBLE } = useQuery<boolean>({
    queryKey: QUERY_KEY,
    queryFn: loadVisible,
    staleTime: Infinity,
  });

  const setVisible = useCallback(async (next: boolean) => {
    qc.setQueryData(QUERY_KEY, next);
    // Best-effort persistence — the query cache above already reflects
    // the toggle for the rest of this session even if the write fails.
    await saveSecureBoolPref(STORAGE_KEY, next);
  }, [qc]);

  return { visible, setVisible };
}
