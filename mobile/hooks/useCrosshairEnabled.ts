import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadSecureBoolPref, saveSecureBoolPref } from '@/lib/secureBoolPref';

const STORAGE_KEY = 'chart_crosshair_enabled_v1';
const QUERY_KEY = ['chart-crosshair-enabled'];
const DEFAULT_ENABLED = true;

function loadEnabled(): Promise<boolean> {
  return loadSecureBoolPref(STORAGE_KEY, DEFAULT_ENABLED);
}

/**
 * Whether the tap/press-and-hold crosshair (scrubGesture + its SVG overlay)
 * is active on AdvancedPriceChart — a global, persisted preference so it can
 * be switched off as a quick A/B test for whether the crosshair's per-frame
 * React state updates are a source of chart lag, without needing a dev
 * build. Same SecureStore + React-Query-cache-mirror pattern as
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
    // Best-effort persistence — the query cache above already reflects
    // the toggle for the rest of this session even if the write fails.
    await saveSecureBoolPref(STORAGE_KEY, next);
  }, [qc]);

  return { enabled, setEnabled };
}
