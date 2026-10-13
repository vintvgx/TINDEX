import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import type { ChartMode } from '@/common/components/ticker/AdvancedPriceChart';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';

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
  /** 1D candles include the extended-hours session (premarket + regular),
   *  not just 09:30–16:00 ET. */
  showExtendedHours: boolean;
  showStrip: boolean;
  showVwap: boolean;
  showEma: boolean;
  showOrb: boolean;
  /** Full-screen chart's support/resistance overlay. */
  showSR: boolean;
  /** Options call/put OI walls (+ expiry-day max pain) on intraday views. */
  showWalls: boolean;
  /** Charts tab: the ticker's Morning Brief trigger / stop / target zone. */
  showBriefLevels: boolean;
  /** Timeframe moving-average overlays (computed from the loaded bars). */
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  ema400: boolean;
  /** Which chart engine renders the Charts tab. */
  chartEngine: 'tv' | 'legacy';
  /** Date range + bar size the Charts tab opens on at launch. */
  defaultPeriod: PricePeriod;
  /** null = that period's own default bar size. */
  defaultInterval: string | null;
  /** Home dynamic card's chart page (Profile → Home chart timeframe). */
  homeChartPeriod: PricePeriod;
  homeChartInterval: string;
  /** Set once the 15m → 5m Home chart default migration has run (see loadPrefs). */
  homeChartInterval5m: boolean;
  /** The ticker the Charts screen was last showing — reopened on return
   *  (the chart overlay unmounts when closed). null = none yet. */
  lastChartTicker: string | null;
}

export const DEFAULT_CHART_DISPLAY_PREFS: ChartDisplayPrefs = {
  mode: null,
  showSessionLines: false,
  showExtendedHours: true,
  showStrip: false,
  showVwap: false,
  showEma: false,
  showOrb: true,
  showSR: false,
  showWalls: true,
  showBriefLevels: true,
  ema20: true,
  ema50: true,
  ema200: false,
  ema400: false,
  chartEngine: 'tv',
  defaultPeriod: '1D',
  defaultInterval: null,
  homeChartPeriod: '1D',
  homeChartInterval: '5m',
  homeChartInterval5m: true,
  lastChartTicker: null,
};

async function loadPrefs(): Promise<ChartDisplayPrefs> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_DISPLAY_PREFS;
    // Merge over the defaults so a pref added later gets its default
    // instead of undefined for anyone with an older saved blob.
    const saved = JSON.parse(raw);
    // 2026-10-13: the Home chart default went 15m → 5m. A saved blob carries
    // every pref, so the old default rode along for anyone who changed any
    // chart setting — move those to 5m once. An explicit 15m picked later is
    // saved alongside the flag and kept.
    if (!saved.homeChartInterval5m && saved.homeChartInterval === '15m') {
      saved.homeChartInterval = '5m';
    }
    return { ...DEFAULT_CHART_DISPLAY_PREFS, ...saved };
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
  const { data: prefs = DEFAULT_CHART_DISPLAY_PREFS, isSuccess: loaded } = useQuery<ChartDisplayPrefs>({
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

  /** `loaded` — the stored prefs have been read (vs. still showing defaults). */
  return { prefs, setPref, loaded };
}
