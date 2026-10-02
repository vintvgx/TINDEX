import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import type { ChartMode } from '@/common/components/ticker/AdvancedPriceChart';

const STORAGE_KEY = 'chart_display_prefs_v1';
const QUERY_KEY = ['chart-display-prefs'];

/**
 * Chart display options from the chart settings modal that persist across
 * app launches. Shared by the Charts tab and PriceChartFullScreen. Watch
 * mode is deliberately not here — it's a transient drawing state, not a
 * preference. Watch-level visibility, auto-zone visibility and Data Points
 * persist through their own hooks.
 */
export interface ChartDisplayPrefs {
  /** null = the timeframe's default (candles on 1D/1W, line otherwise). */
  mode: ChartMode | null;
  showSessionLines: boolean;
  showStrip: boolean;
  showVwap: boolean;
  showEma: boolean;
  showOrb: boolean;
  /** Full-screen chart's support/resistance overlay. */
  showSR: boolean;
  /** Options call/put OI walls (+ expiry-day max pain) on intraday views. */
  showWalls: boolean;
}

export const DEFAULT_CHART_DISPLAY_PREFS: ChartDisplayPrefs = {
  mode: null,
  showSessionLines: false,
  showStrip: false,
  showVwap: false,
  showEma: false,
  showOrb: true,
  showSR: false,
  showWalls: true,
};

async function loadPrefs(): Promise<ChartDisplayPrefs> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_DISPLAY_PREFS;
    // Merge over the defaults so a pref added later gets its default
    // instead of undefined for anyone with an older saved blob.
    return { ...DEFAULT_CHART_DISPLAY_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CHART_DISPLAY_PREFS;
  }
}

/**
 * Persisted chart display prefs: SecureStore for storage, mirrored in the
 * React Query cache so every mounted chart updates together the moment one
 * of them changes a setting (same cache-mirror pattern as
 * useWatchZonesVisibility, with SecureStore instead of AsyncStorage).
 */
export function useChartDisplayPrefs() {
  const qc = useQueryClient();
  const { data: prefs = DEFAULT_CHART_DISPLAY_PREFS } = useQuery<ChartDisplayPrefs>({
    queryKey: QUERY_KEY,
    queryFn: loadPrefs,
    staleTime: Infinity,
  });

  const setPref = useCallback(<K extends keyof ChartDisplayPrefs>(key: K, value: ChartDisplayPrefs[K]) => {
    const next = { ...(qc.getQueryData<ChartDisplayPrefs>(QUERY_KEY) ?? DEFAULT_CHART_DISPLAY_PREFS), [key]: value };
    qc.setQueryData(QUERY_KEY, next);
    // Best-effort persistence — the cache above already reflects the change
    // for the rest of this session even if the write fails.
    SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, [qc]);

  return { prefs, setPref };
}
