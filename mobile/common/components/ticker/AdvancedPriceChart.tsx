import type React from 'react';
import { Fragment, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, LayoutChangeEvent, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import Svg, { Path, Rect, Line, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useWatchZonesVisibility } from '@/hooks/useWatchZonesVisibility';
import { useCrosshairEnabled } from '@/hooks/useCrosshairEnabled';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { PricePeriod, TickerHistoryData } from '@/common/types/blogPosts/ticker';
import type { OrbRangeLines } from '@/common/components/ticker/PriceChart';

const PERIODS: PricePeriod[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y'];

/** Scrub payload with the full bar, so the header can show an OHLC readout. */
export interface AdvancedScrubPoint {
  index: number;
  date: string;
  price: number; // close
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

type ChartMode = 'line' | 'candle';

/** A labeled horizontal level — e.g. entry/TP1/TP2/stop for a simulation or
 *  a live position. Visually distinct from the ORB band's solid lines
 *  (dashed, label anchored on the left so it doesn't collide with the
 *  ORH/ORL pills already anchored on the right). */
export interface ChartReferenceLine {
  label: string;
  price: number;
  color?: string;
  dash?: string;
}

/** A point-in-time annotation — e.g. "TP1 hit" at the bar where it fired.
 *  `index` must be a valid index into the chart's `data` arrays. */
export interface ChartEventMarker {
  index: number;
  price: number;
  label: string;
  color?: string;
}

/** An existing watched price level/zone (from watched_price_levels) drawn
 *  directly on the chart — see the "Watch" toggle in the chart toolbar. */
export interface ChartWatchZone {
  id: string;
  low: number;
  high: number;
  // 'either' only applies while status === 'watching' — once 'confirmed'
  // the backend overwrites this with whichever side actually triggered.
  direction: 'bullish' | 'bearish' | 'either';
  status: 'watching' | 'confirmed';
}

/** A newly-drawn-but-not-yet-saved watch zone, reported once the user lifts
 *  their finger after a long-press-drag in Watch mode. The chart itself
 *  never calls the API — the parent owns persistence (see onWatchConfirm). */
export interface ChartWatchDraft {
  low: number;
  high: number;
  direction: 'bullish' | 'bearish' | 'either';
}

interface AdvancedPriceChartProps {
  data: TickerHistoryData | undefined;
  /** Needed only to lazy-load earlier trading days as the user pans past
   *  the left edge on 1D (see the "load earlier days" block below) — the
   *  1D history-date endpoint is fetched directly from here, ticker-scoped.
   *  Omit to leave 1D hard-clamped to whatever `data` already contains. */
  ticker?: string;
  isLoading?: boolean;
  period: PricePeriod;
  onPeriodChange: (period: PricePeriod) => void;
  /** Whether the period is up or down overall — drives line-mode color. */
  positive: boolean;
  onScrub?: (point: AdvancedScrubPoint | null) => void;
  height?: number;
  /** Today's Opening Range high/low, when available for this ticker. */
  orbRange?: OrbRangeLines | null;
  /** Draws the ORB band. Only rendered on 1D — the range is intraday-only. */
  showOrbRange?: boolean;
  /**
   * Live streamed price. On 1D, this is blended into the last (still-forming)
   * bar's close — and its high/low, when candles are on — so the chart's own
   * last candle/line-endpoint moves with each tick, not just the separate
   * last-price line/tag. Off on other timeframes: a 30m/1d/1wk bar isn't
   * "in progress" in the same sense a 5m bar during market hours is.
   */
  livePrice?: number | null;
  /** Labeled horizontal levels (e.g. entry/TP1/TP2/stop). Folded into the
   *  y-axis domain so a level is never clipped off-canvas. */
  referenceLines?: ChartReferenceLine[] | null;
  /** Pre-Market/Market-Close/Post-Market/Overnight lines (see
   *  yfinance_service._session_boundary_lines) — kept separate from
   *  referenceLines so this component can own its own show/hide toggle
   *  (button in the toolbar, defaults OFF) instead of every caller having
   *  to remember to gate them. Folded into the y-axis domain exactly like
   *  referenceLines, only while the toggle is on. */
  sessionReferenceLines?: ChartReferenceLine[] | null;
  /** Point-in-time annotations drawn on top of the price marks. */
  eventMarkers?: ChartEventMarker[] | null;
  /** Existing watched levels/zones for this ticker, drawn as shaded bands.
   *  Folded into the y-axis domain like referenceLines. */
  watchZones?: ChartWatchZone[] | null;
  /** Fired when the user taps Confirm on a drawn zone. Return (or resolve
   *  to) `false` to signal the save failed — the chart then keeps the band
   *  and confirm bar up with an inline error instead of clearing it, so a
   *  failure is never silently indistinguishable from success. Anything
   *  else (including throwing) is NOT treated as success — throw or return
   *  `false` on failure; return `true`/`undefined` only once actually
   *  persisted. The caller is responsible for the actual persistence and
   *  for passing the updated `watchZones` back down once it lands. */
  onWatchConfirm?: (draft: ChartWatchDraft) => Promise<boolean> | boolean;
  /** Fired when the user edits an existing zone (tap it while in Watch
   *  mode, adjust, hit the confirm bar's "Update"). Same success/failure
   *  contract as onWatchConfirm — return/resolve `false` or throw to keep
   *  the band + confirm bar up with an inline error instead of clearing it. */
  onUpdateWatchZone?: (zoneId: string, draft: ChartWatchDraft) => Promise<boolean> | boolean;
  /** Fired after the user confirms (via the chart's own Alert) that they
   *  want to remove an existing watched zone — the caller owns the actual
   *  delete call (e.g. useCancelKeyLevel) and re-fetching `watchZones`,
   *  same division of responsibility as onWatchConfirm. */
  onDeleteWatchZone?: (zoneId: string) => void;
  /** Bump/change this (e.g. pass the ticker) whenever the chart is showing
   *  a genuinely different instrument — clears Watch mode and any
   *  in-progress/pending draft so a stale drawing never survives a ticker
   *  swap. Left undefined, Watch state simply persists across re-renders. */
  resetKey?: string | number;
}

// ── Layout constants ─────────────────────────────────────────────────────
const Y_AXIS_W = 54; // right gutter for price labels
// Bottom row for time labels — tall enough for the scrub tooltip's two lines
// (time on top, volume below) rather than just the plain axis label.
const X_AXIS_H = 34;
const VOL_H = 44; // volume pane height
const PANE_GAP = 6; // gap between price pane and volume pane

// ── Pan/zoom (Phase 1 — see docs/CHARTS_TAB_PLAN.md) ────────────────────
// Never zoom in past this many visible bars — a handful of candles is
// still readable; fewer than that and the chart stops being useful.
const MIN_VISIBLE_BARS = 5;
// Clamp factor per gesture update to a sane range so a fast/erratic touch
// can't collapse or blow out the window in one frame. Called from inside
// gesture worklets (UI thread) — needs its own 'worklet' directive so
// Reanimated's Babel plugin compiles it for that thread too, rather than
// leaving it as a plain JS-thread function the worklet can't synchronously
// call (see https://docs.swmansion.com/react-native-reanimated/docs/guides/troubleshooting#tried-to-synchronously-call-a-non-worklet-function-on-the-ui-thread).
const clampZoomFactor = (f: number) => {
  'worklet';
  return Math.max(0.2, Math.min(5, f));
};

/**
 * Round-number y-axis step: 1/2/5 × 10^k that yields ~targetTicks divisions.
 */
const niceStep = (range: number, targetTicks: number) => {
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const factor = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return factor * mag;
};

const formatAxisPrice = (p: number) => (p >= 1000 ? p.toFixed(0) : p.toFixed(2));

const formatVolume = (v: number) => {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${v}`;
};

/** Time label under the x-axis, granularity matched to the timeframe. */
const formatXLabel = (dateStr: string, period: PricePeriod) => {
  const d = new Date(dateStr);
  if (period === '1D') {
    return d
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(/\s?[AP]M/i, '');
  }
  if (period === '1W' || period === '1M') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (period === '1Y' || period === '5Y') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '");
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const isSameDay = (a: string, b: string) => {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

/** Date label for an x-axis tick that lands right where the calendar day
 *  changes — plain day number ("27") normally, month+day once the month
 *  also changed since the previous tick, plus year once the year changed
 *  too. Mirrors TradingView's own adaptive axis: mostly time labels, with
 *  the date stamped in exactly at day boundaries. Only relevant on the 1D
 *  period once panning has loaded earlier days into the same view — see
 *  fetchEarlierDay/MAX_EARLIER_DAYS. */
const formatDayBoundaryLabel = (dateStr: string, prevDateStr: string | null) => {
  const d = new Date(dateStr);
  if (!prevDateStr) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const prev = new Date(prevDateStr);
  if (d.getFullYear() !== prev.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }
  if (d.getMonth() !== prev.getMonth()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return String(d.getDate());
};

/** Full-precision label shown top-right while scrubbing. */
const formatScrubLabel = (dateStr: string, period: PricePeriod) => {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: period === '1Y' || period === '5Y' ? 'numeric' : undefined,
    hour: period === '1D' || period === '1W' ? 'numeric' : undefined,
    minute: period === '1D' || period === '1W' ? '2-digit' : undefined,
  });
};

/** Crosshair pill label — plain time on the 1D period UNLESS the scrubbed
 *  bar is on a different calendar day than the chart's most recent bar
 *  (i.e. the user has panned back into an earlier loaded day), in which
 *  case the date is spelled out alongside the time so it's never ambiguous
 *  which day is being inspected. */
const formatCrosshairLabel = (dateStr: string, period: PricePeriod, lastDateStr?: string) => {
  if (period === '1D' && lastDateStr && !isSameDay(dateStr, lastDateStr)) {
    const d = new Date(dateStr);
    return d
      .toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(/\s?[AP]M/i, '');
  }
  return formatXLabel(dateStr, period);
};

/**
 * Full-screen day-trading chart: candlesticks (line fallback), y-axis price
 * gridlines + labels, x-axis time labels, a volume pane, a live last-price
 * tag, a TradingView-style shaded ORB band, and a crosshair scrub that
 * labels both axes. The compact in-sheet chart stays the minimal sparkline
 * (PriceChart.tsx); this one trades that minimalism for information density.
 *
 * On 1D, `livePrice` ticks are blended into the last bar (see `ePrices`/
 * `eHighs`/`eLows` below) rather than only driving the separate last-price
 * overlay line — the chart's own last candle/line-endpoint moves with the
 * stream, the way a live trading chart is expected to. This is a client-side
 * blend, not a history refetch: the underlying 5m bar from the backend stays
 * cached (~30s) and only its last index is rewritten in memory per tick.
 */
export const AdvancedPriceChart: React.FC<AdvancedPriceChartProps> = ({
  data,
  ticker,
  isLoading,
  period,
  onPeriodChange,
  positive,
  onScrub,
  height = 340,
  orbRange,
  showOrbRange,
  livePrice,
  referenceLines,
  sessionReferenceLines,
  eventMarkers,
  watchZones,
  onWatchConfirm,
  onUpdateWatchZone,
  onDeleteWatchZone,
  resetKey,
}) => {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);

  // ── Lazy-loaded earlier trading days (1D pan-past-the-left-edge) ────────
  // `data` from the parent is always just the CURRENTLY SELECTED period's
  // fetch (today's bars, for 1D) — panning used to hard-clamp at index 0
  // because there was nothing before it in memory. This prepends whole
  // prior trading days on demand as the user pans toward/past the start,
  // capped at MAX_EARLIER_DAYS so the series can't grow unbounded. Oldest
  // day first, so `[...earlierDays.flat, ...data]` is already in
  // chronological order.
  const MAX_EARLIER_DAYS = 8;
  const [earlierDays, setEarlierDays] = useState<TickerHistoryData[]>([]);
  const loadingEarlierRef = useRef(false);
  const unavailableDatesRef = useRef<Set<string>>(new Set());

  // A genuinely different instrument (or the caller's resetKey bump) means
  // the earlier-days cache is for the wrong ticker entirely — never carry
  // it across.
  useEffect(() => {
    setEarlierDays([]);
    loadingEarlierRef.current = false;
    unavailableDatesRef.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, ticker]);

  const earlierBarsCount = useMemo(
    () => earlierDays.reduce((n, d) => n + d.dates.length, 0),
    [earlierDays],
  );

  // The merged series everything below actually renders — `data` itself is
  // read directly only where "today specifically" is what's meant (the ORB
  // band's regular-session-start search, and the fetch-trigger's own
  // day-stepping below).
  const chartData: TickerHistoryData | undefined = useMemo(() => {
    if (period !== '1D' || earlierDays.length === 0 || !data) return data;
    const opensOk = earlierDays.every(d => Array.isArray(d.opens)) && Array.isArray(data.opens);
    const highsOk = earlierDays.every(d => Array.isArray(d.highs)) && Array.isArray(data.highs);
    const lowsOk = earlierDays.every(d => Array.isArray(d.lows)) && Array.isArray(data.lows);
    return {
      dates: [...earlierDays.flatMap(d => d.dates), ...data.dates],
      prices: [...earlierDays.flatMap(d => d.prices), ...data.prices],
      volumes: [...earlierDays.flatMap(d => d.volumes), ...data.volumes],
      opens: opensOk ? [...earlierDays.flatMap(d => d.opens!), ...data.opens!] : data.opens,
      highs: highsOk ? [...earlierDays.flatMap(d => d.highs!), ...data.highs!] : data.highs,
      lows: lowsOk ? [...earlierDays.flatMap(d => d.lows!), ...data.lows!] : data.lows,
      session_lines: data.session_lines,
    };
  }, [data, earlierDays, period]);

  // Steps back one calendar day at a time (skipping weekends without a
  // network call) from whatever's currently the oldest loaded bar, fetching
  // the regular-session 5-minute bars for that date via the same endpoint
  // the Daily Review's per-trade chart uses. A date already known empty
  // (holiday, or past yfinance's ~60-day intraday lookback) is skipped on
  // sight next time rather than re-requested. Stops after finding ONE
  // day worth of bars — the next edge-hit fetches the day before that.
  const fetchEarlierDay = useCallback(async () => {
    if (!ticker || period !== '1D' || loadingEarlierRef.current) return;
    if (earlierDays.length >= MAX_EARLIER_DAYS) return;
    const oldestDateStr = earlierDays[0]?.dates[0] ?? data?.dates?.[0];
    if (!oldestDateStr) return;

    loadingEarlierRef.current = true;
    try {
      const cursor = new Date(oldestDateStr);
      for (let attempt = 0; attempt < 5; attempt++) {
        cursor.setDate(cursor.getDate() - 1);
        const dow = cursor.getDay();
        if (dow === 0 || dow === 6) continue; // weekend — no network call
        const iso = cursor.toISOString().split('T')[0];
        if (unavailableDatesRef.current.has(iso)) continue;

        try {
          const res = await fetch(`${RAILWAY_BASE_URL}/ticker/${ticker}/history-date`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: iso }),
          });
          const json = await res.json();
          if (json?.success && json.data?.available && json.data.dates?.length) {
            const day: TickerHistoryData = {
              dates: json.data.dates,
              prices: json.data.closes,
              volumes: json.data.volumes,
              opens: json.data.opens,
              highs: json.data.highs,
              lows: json.data.lows,
            };
            const shiftBy = day.dates.length;
            setEarlierDays(prev => [day, ...prev]);
            // Keep whatever was on screen still on screen — the new bars
            // slide in to the LEFT of it, not underneath it. xWindow==null
            // (never zoomed) needs no shift: it always tracks "show
            // everything," which already includes the new day for free.
            setXWindow(w => (w ? { start: w.start + shiftBy, end: w.end + shiftBy } : null));
            return;
          }
          unavailableDatesRef.current.add(iso);
        } catch {
          return; // network hiccup — a later edge-hit tries again
        }
      }
    } finally {
      loadingEarlierRef.current = false;
    }
  }, [ticker, period, earlierDays, data]);

  const prices = useMemo(() => chartData?.prices ?? [], [chartData]);
  const dates = useMemo(() => chartData?.dates ?? [], [chartData]);
  const volumes = useMemo(() => chartData?.volumes ?? [], [chartData]);

  // OHLC is only usable if every array lines up with closes — a partial or
  // stale-cached payload silently degrades to line mode instead of drawing
  // misaligned candles.
  const hasOhlc =
    !!chartData &&
    Array.isArray(chartData.opens) &&
    Array.isArray(chartData.highs) &&
    Array.isArray(chartData.lows) &&
    chartData.opens.length === prices.length &&
    chartData.highs.length === prices.length &&
    chartData.lows.length === prices.length;

  // Candles by default on intraday timeframes (where individual bars are
  // readable and matter for entries); line for long ranges. A manual toggle
  // overrides either way for the rest of the session.
  const [modeOverride, setModeOverride] = useState<ChartMode | null>(null);
  const defaultMode: ChartMode = period === '1D' || period === '1W' ? 'candle' : 'line';
  const mode: ChartMode = hasOhlc ? modeOverride ?? defaultMode : 'line';

  // ── Live tick blended into the last (still-forming) bar ────────────────
  // Only meaningful on 1D — a 30m/1d/1wk bar isn't "in progress" the way a
  // 5m bar during market hours is — and only once a real tick has arrived
  // (never a 0/placeholder). `ePrices`/`eHighs`/`eLows` are the base arrays
  // with just the last index rewritten; everywhere below draws from these
  // instead of the raw history, so the last candle/line-endpoint tracks the
  // stream without needing a history refetch.
  const lastIdx = prices.length - 1;
  const isLiveBar = period === '1D' && livePrice != null && livePrice > 0 && prices.length > 0;

  const ePrices = useMemo(() => {
    if (!isLiveBar) return prices;
    const next = prices.slice();
    next[lastIdx] = livePrice!;
    return next;
  }, [prices, isLiveBar, lastIdx, livePrice]);

  const eHighs = useMemo<number[] | undefined>(() => {
    if (!hasOhlc) return undefined;
    const base = chartData!.highs!;
    if (!isLiveBar) return base;
    const next = base.slice();
    next[lastIdx] = Math.max(base[lastIdx], livePrice!);
    return next;
  }, [hasOhlc, chartData, isLiveBar, lastIdx, livePrice]);

  const eLows = useMemo<number[] | undefined>(() => {
    if (!hasOhlc) return undefined;
    const base = chartData!.lows!;
    if (!isLiveBar) return base;
    const next = base.slice();
    next[lastIdx] = Math.min(base[lastIdx], livePrice!);
    return next;
  }, [hasOhlc, chartData, isLiveBar, lastIdx, livePrice]);

  const hasData = prices.length > 1 && width > 0;
  const lineColor = positive ? colors.success : colors.error;

  // "No chart data available" is a real dead-end state (bad ticker, API
  // outage) — it should NOT flash on every ordinary switch. Right after a
  // ticker/period change there's an unavoidable gap before `width` is
  // re-measured and fresh data lands, during which hasData is briefly
  // false too; without a buffer that gap rendered the empty-state message
  // for a frame or two on every switch. Bridge it with the loading
  // animation instead, and only commit to the empty state after a beat
  // with still nothing to show.
  const EMPTY_STATE_BUFFER_MS = 600;
  const [showEmptyState, setShowEmptyState] = useState(false);
  useEffect(() => {
    if (isLoading || hasData) {
      setShowEmptyState(false);
      return;
    }
    const t = setTimeout(() => setShowEmptyState(true), EMPTY_STATE_BUFFER_MS);
    return () => clearTimeout(t);
  }, [isLoading, hasData]);

  const plotW = Math.max(0, width - Y_AXIS_W);
  const priceH = Math.max(0, height - X_AXIS_H - VOL_H - PANE_GAP);
  const volTop = priceH + PANE_GAP;

  // ── Pan/zoom state ──────────────────────────────────────────────────────
  // null means "auto" — the full fetched range (X) / auto-fit min-max (Y),
  // exactly today's behavior. Once set, these override the defaults until
  // reset (double-tap, the Reset pill, or a period change).
  const [xWindow, setXWindow] = useState<{ start: number; end: number } | null>(null);
  const [yOverride, setYOverride] = useState<{ lo: number; hi: number } | null>(null);
  const count = ePrices.length;

  // A new timeframe should always start at the default auto-fit view, same
  // as TradingView's own behavior when you switch resolution. Deliberately
  // NOT reset on every `data` refetch (e.g. 1D's background poll bringing
  // in a new bar every ~30s) — that would wipe an in-progress zoom out from
  // under the user constantly while they're actively looking at the chart.
  const prevPeriodRef = useRef(period);
  useEffect(() => {
    if (prevPeriodRef.current !== period) {
      setXWindow(null);
      setYOverride(null);
      prevPeriodRef.current = period;
    }
  }, [period]);

  const resetZoom = useCallback(() => {
    setXWindow(null);
    setYOverride(null);
  }, []);

  // Clamped against the current data length so a stale window (e.g. if the
  // underlying series shrinks/changes shape without a period change) can
  // never index out of bounds.
  const visibleStart = xWindow ? Math.max(0, Math.min(xWindow.start, count - 1)) : 0;
  const visibleEnd = xWindow ? Math.max(visibleStart, Math.min(xWindow.end, count - 1)) : count - 1;
  const visibleCount = Math.max(1, visibleEnd - visibleStart + 1);
  const isZoomed = xWindow !== null || yOverride !== null;

  const visibleIndices = useMemo(
    () => Array.from({ length: visibleCount }, (_, k) => visibleStart + k),
    [visibleStart, visibleCount],
  );

  // ORB band only means anything on the trading day it was computed for.
  const orbVisible = !!(showOrbRange && orbRange && period === '1D');

  // Index of the first regular-session (09:30 ET) bar — the ORB band must
  // start there, not at index 0. On 1D with extended-hours bars now mixed
  // in (see yfinance_service._session_boundary_lines), index 0 is 04:00 ET
  // pre-market, not the open; drawing the band from x=0 would visually
  // stretch it across the entire pre-market session even though orbRange's
  // own high/low are still correctly computed from only the 09:30-09:45
  // window (2026-08-27 fix). Deliberately searches the ORIGINAL `data`
  // (today only), never `chartData` — with earlier days now possibly
  // prepended, searching from index 0 forward in the merged series would
  // find an EARLIER day's 9:30 bar instead of today's; earlierBarsCount
  // shifts the found index back into chartData's index space.
  const regularSessionStartIndex = useMemo(() => {
    if (!orbVisible || !data?.dates?.length) return 0;
    for (let i = 0; i < data.dates.length; i++) {
      const d = new Date(data.dates[i]);
      const parts = d.toLocaleString('en-US', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const [hh, mm] = parts.split(':').map(Number);
      if (hh * 60 + mm >= 9 * 60 + 30) return i + earlierBarsCount;
    }
    return earlierBarsCount;
  }, [orbVisible, data?.dates, earlierBarsCount]);

  // Pre-Market/Market-Close/Post-Market/Overnight lines — off by default;
  // toggled via the toolbar button below. Merged with the generic
  // referenceLines prop (e.g. entry/TP/stop) into one array so both the
  // y-domain fold-in and the render map only need to handle one list.
  const [showSessionLines, setShowSessionLines] = useState(false);
  const effectiveReferenceLines = useMemo(
    () => [
      ...(referenceLines ?? []),
      ...(showSessionLines ? (sessionReferenceLines ?? []) : []),
    ],
    [referenceLines, sessionReferenceLines, showSessionLines],
  );

  // Watched zones (key levels) — ON by default, toggled off via the
  // toolbar to view the ticker's raw price action without them. A GLOBAL
  // persisted preference (useWatchZonesVisibility), not per-instance
  // state — this component remounts on every ticker switch (`key=
  // {activeTicker}` in charts.tsx), so a plain useState would silently
  // reset to visible on every switch and every app restart; toggling it
  // off must actually stay off everywhere until turned back on. Hidden
  // zones are excluded from the y-axis fold-in too (below), so hiding them
  // actually declutters the view rather than leaving the domain stretched
  // to fit something no longer drawn.
  const { visible: showWatchZones, setVisible: setShowWatchZones } = useWatchZonesVisibility();
  const effectiveWatchZones = showWatchZones ? watchZones : null;

  // Global, persisted toggle for the tap/press-and-hold crosshair — lets the
  // user switch it off entirely to test whether its per-frame React state
  // updates are a source of chart lag/snappiness. See useCrosshairEnabled.
  const { enabled: crosshairEnabled } = useCrosshairEnabled();

  const scale = useMemo(() => {
    if (!hasData) return null;

    // Auto-fit is computed from only the VISIBLE slice now, not the whole
    // fetched series — zooming in on X (fewer bars) auto-tightens Y to what's
    // on screen too, same as TradingView's default behavior, unless the user
    // has explicitly overridden Y (yOverride) via pinch or the axis drag.
    const visLows = hasOhlc
      ? visibleIndices.map(i => eLows![i])
      : visibleIndices.map(i => ePrices[i]);
    const visHighs = hasOhlc
      ? visibleIndices.map(i => eHighs![i])
      : visibleIndices.map(i => ePrices[i]);

    let min = Math.min(...visLows);
    let max = Math.max(...visHighs);
    // The y-domain must contain the ORB band even after a breakout has
    // carried price well away from it — seeing price relative to the range
    // is the whole point of the overlay.
    if (orbVisible && orbRange) {
      min = Math.min(min, orbRange.low);
      max = Math.max(max, orbRange.high);
    }
    // Reference lines (entry/TP/stop, and session lines while toggled on)
    // must stay visible even before price has actually approached them —
    // same reasoning as the ORB band above.
    if (effectiveReferenceLines.length) {
      for (const line of effectiveReferenceLines) {
        min = Math.min(min, line.price);
        max = Math.max(max, line.price);
      }
    }
    // Watched zones — same reasoning: a level called out well above/below
    // the currently-visible range should still pull the domain out to show
    // it, but only while actually shown (effectiveWatchZones respects the
    // toggle below).
    if (effectiveWatchZones?.length) {
      for (const z of effectiveWatchZones) {
        min = Math.min(min, z.low);
        max = Math.max(max, z.high);
      }
    }

    let lo: number, hi: number;
    if (yOverride) {
      lo = yOverride.lo;
      hi = yOverride.hi;
    } else {
      const pad = (max - min) * 0.06 || 1;
      lo = min - pad;
      hi = max + pad;
    }

    const step = plotW / visibleCount;
    const xForIndex = (i: number) => (i - visibleStart + 0.5) * step;
    const yForPrice = (p: number) => priceH - ((p - lo) / (hi - lo)) * priceH;
    // Inverse of yForPrice — converts a pixel Y (within the price pane) back
    // to a price. Used only from JS-thread callbacks (never inside a
    // 'worklet' block directly — this closes over `lo`/`hi`/`priceH` from
    // this render's scope, which a UI-thread worklet can't safely call).
    const priceForY = (y: number) => lo + (1 - y / priceH) * (hi - lo);

    // Y ticks on round numbers within the domain. Density scales with the
    // pane's actual height (roughly one label per ~42px) rather than a flat
    // 4 — a tall pane at a tight zoom otherwise still only got 4 gridlines,
    // too coarse to read an exact price point off when marking a level.
    const targetTicks = Math.max(4, Math.min(9, Math.round(priceH / 42)));
    const tickStep = niceStep(hi - lo, targetTicks);
    const yTicks: number[] = [];
    for (let t = Math.ceil(lo / tickStep) * tickStep; t <= hi; t += tickStep) yTicks.push(t);

    // ~4 evenly spaced x labels, snapped to data indices within the visible window.
    const xTickCount = Math.min(4, visibleCount);
    const xTicks: number[] = [];
    for (let k = 0; k < xTickCount; k++) {
      xTicks.push(visibleStart + Math.round(((k + 0.5) / xTickCount) * (visibleCount - 1)));
    }

    const visVolumes = visibleIndices.map(i => volumes[i] ?? 0);
    const maxVolume = visVolumes.length ? Math.max(...visVolumes) : 0;

    return { lo, hi, step, xForIndex, yForPrice, priceForY, yTicks, xTicks, maxVolume };
  }, [hasData, hasOhlc, ePrices, eHighs, eLows, volumes, plotW, priceH, orbVisible, orbRange, effectiveReferenceLines, effectiveWatchZones, yOverride, visibleIndices, visibleStart, visibleCount]);

  // X-axis tick labels — plain evenly-spaced time labels everywhere EXCEPT
  // the 1D period, which can show multiple calendar days at once once
  // fetchEarlierDay has loaded earlier days into view (see MAX_EARLIER_DAYS).
  // There, insert a date label exactly at each day-boundary crossing —
  // dropping any evenly-spaced time tick that would collide with one —
  // mirroring TradingView's own adaptive axis (mostly times, date stamped
  // in only where the day actually changes).
  const xAxisTicks = useMemo(() => {
    if (!scale || visibleCount < 2) return [] as { index: number; label: string; isBoundary: boolean }[];
    const baseTicks = scale.xTicks;
    if (period !== '1D') {
      return baseTicks.map((i) => ({ index: i, label: formatXLabel(dates[i], period), isBoundary: false }));
    }
    const boundaries: number[] = [];
    for (let i = visibleStart + 1; i <= visibleEnd; i++) {
      if (dates[i - 1] && dates[i] && !isSameDay(dates[i - 1], dates[i])) boundaries.push(i);
    }
    if (boundaries.length === 0) {
      return baseTicks.map((i) => ({ index: i, label: formatXLabel(dates[i], period), isBoundary: false }));
    }
    const MIN_GAP_PX = 30;
    const thinned: number[] = [boundaries[0]];
    for (let k = 1; k < boundaries.length; k++) {
      if (scale.xForIndex(boundaries[k]) - scale.xForIndex(thinned[thinned.length - 1]) >= MIN_GAP_PX) {
        thinned.push(boundaries[k]);
      }
    }
    const keptBase = baseTicks.filter((bi) => {
      const bx = scale.xForIndex(bi);
      return thinned.every((ti) => Math.abs(scale.xForIndex(ti) - bx) >= MIN_GAP_PX);
    });
    return [...keptBase, ...thinned]
      .sort((a, b) => a - b)
      .map((i) => {
        const isBoundary = thinned.includes(i);
        return {
          index: i,
          label: isBoundary ? formatDayBoundaryLabel(dates[i], dates[i - 1] ?? null) : formatXLabel(dates[i], period),
          isBoundary,
        };
      });
  }, [scale, period, dates, visibleStart, visibleEnd, visibleCount]);

  // Line-mode path built from closes — the last point tracks the live tick.
  // Only the visible window is drawn.
  const { linePath, areaPath } = useMemo(() => {
    if (!scale || mode !== 'line') return { linePath: '', areaPath: '' };
    let p = '';
    visibleIndices.forEach((i, k) => {
      p += `${k === 0 ? 'M' : ' L'}${scale.xForIndex(i)},${scale.yForPrice(ePrices[i])}`;
    });
    const lastI = visibleIndices[visibleIndices.length - 1];
    const firstI = visibleIndices[0];
    const area = `${p} L${scale.xForIndex(lastI)},${priceH} L${scale.xForIndex(firstI)},${priceH} Z`;
    return { linePath: p, areaPath: area };
  }, [scale, mode, ePrices, priceH, visibleIndices]);

  // ── Crosshair scrub ────────────────────────────────────────────────────
  // The crosshair snaps to whole bar indices, so plain React state (updated
  // only when the index changes) is enough — no per-frame animation needed.
  const [scrubIndex, setScrubIndex] = useState(-1);
  const scrubIndexShared = useSharedValue(-1);
  // Touch-down Y for a Watch-mode drag — captured in onBegin, read (not
  // relied on via translation math) throughout onUpdate.
  const watchStartYShared = useSharedValue(0);

  const notifyScrub = useCallback(
    (index: number) => {
      setScrubIndex(index);
      if (index === -1 || !chartData) {
        onScrub?.(null);
        return;
      }
      // Scrubbing the last bar while it's live-updating should read the same
      // blended values the candle itself is drawing, not the stale fetch.
      const live = isLiveBar && index === lastIdx;
      onScrub?.({
        index,
        date: chartData.dates[index],
        price: live ? livePrice! : chartData.prices[index],
        open: chartData.opens?.[index],
        high: live && chartData.highs ? Math.max(chartData.highs[index], livePrice!) : chartData.highs?.[index],
        low: live && chartData.lows ? Math.min(chartData.lows[index], livePrice!) : chartData.lows?.[index],
        volume: chartData.volumes?.[index],
      });
    },
    [chartData, onScrub, isLiveBar, lastIdx, livePrice],
  );

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // ── Watch mode: draw a new price level/zone directly on the chart ──────
  // Repurposes the SAME long-press-then-drag gesture that normally drives
  // the crosshair scrub (see scrubGesture below) — plain drag (pan) and
  // pinch (zoom) are completely untouched by Watch mode, so panning/zooming
  // to find the right spot before marking a level still works exactly as
  // it does everywhere else on this chart.
  const [watchMode, setWatchMode] = useState(false);
  // Live pixel Y bounds while a drag is in progress (before release).
  const [watchDraftPx, setWatchDraftPx] = useState<{ startY: number; endY: number } | null>(null);
  // Finalized price range, set on release, awaiting Confirm/Cancel.
  const [watchDraftCommitted, setWatchDraftCommitted] = useState<{ low: number; high: number } | null>(null);
  const [watchDirection, setWatchDirection] = useState<'bullish' | 'bearish' | 'either'>('bullish');
  const [isSavingWatch, setIsSavingWatch] = useState(false);
  const [watchSaveError, setWatchSaveError] = useState<string | null>(null);
  // Id of the existing zone currently being modified — set by tapping a
  // zone's label while in Watch mode (see handleEditZonePress). null means
  // the pending draft (if any) is a brand-new zone, not an edit of one that
  // already exists; confirmWatchDraft branches on this to call
  // onUpdateWatchZone instead of onWatchConfirm.
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);

  // Clears any in-progress/pending draft (and turns Watch mode back off)
  // whenever the caller signals this is now a genuinely different chart —
  // see the `resetKey` prop doc. Deliberately NOT keyed off `data` itself,
  // which changes on every routine live-price poll and would otherwise wipe
  // an awaiting-confirmation draft out from under the user mid-decision.
  useEffect(() => {
    setWatchMode(false);
    setWatchDraftPx(null);
    setWatchDraftCommitted(null);
    setWatchSaveError(null);
    setEditingZoneId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Tapping an existing zone's label while in Watch mode loads it into the
  // same draft/confirm-bar flow used to draw a brand-new zone — dragging on
  // the chart afterward redefines the bounds (beginWatchDraft doesn't touch
  // editingZoneId, so it survives the redraw); leaving it un-dragged and
  // just hitting the confirm bar's "Update" is a no-op save of the same
  // bounds. Direction is copied so the picker starts on whatever it already
  // was, not the live-price-relative default a fresh draw guesses.
  const handleEditZonePress = useCallback((zone: ChartWatchZone) => {
    setWatchDraftCommitted({ low: zone.low, high: zone.high });
    setWatchDirection(zone.direction);
    setEditingZoneId(zone.id);
    setWatchSaveError(null);
  }, []);

  const updateWatchDraft = useCallback((startY: number, endY: number) => {
    setWatchDraftPx({ startY, endY });
  }, []);

  // Starting a fresh drag replaces any earlier pending-confirmation draft
  // (and clears a stale error from a previous failed save) rather than
  // leaving it dangling underneath the new one.
  const beginWatchDraft = useCallback((y: number) => {
    setWatchDraftCommitted(null);
    setWatchSaveError(null);
    setWatchDraftPx({ startY: y, endY: y });
  }, []);

  // Current live price, for defaulting the direction pill — whichever side
  // of the current price the drawn zone mostly sits on.
  const watchCurrentPrice = livePrice ?? ePrices[ePrices.length - 1];

  const commitWatchDraft = useCallback(() => {
    setWatchDraftPx((prev) => {
      if (prev && scale) {
        const pxTop = Math.min(prev.startY, prev.endY);
        const pxBottom = Math.max(prev.startY, prev.endY);
        // Smaller Y (higher on screen) is the higher price.
        const high = scale.priceForY(pxTop);
        const low = scale.priceForY(pxBottom);
        if (Number.isFinite(low) && Number.isFinite(high) && high >= low) {
          setWatchDraftCommitted({ low, high });
          const mid = (low + high) / 2;
          setWatchDirection(watchCurrentPrice != null && mid < watchCurrentPrice ? 'bearish' : 'bullish');
        }
      }
      return null;
    });
  }, [scale, watchCurrentPrice]);

  const cancelWatchDraft = useCallback(() => {
    setWatchDraftCommitted(null);
    setWatchSaveError(null);
    setEditingZoneId(null);
  }, []);

  // Deliberately does NOT clear the band/confirm bar until the save is
  // actually confirmed successful — clearing unconditionally here meant a
  // failed save (bad ticker, backend down, migration not applied, etc.)
  // looked identical to a successful one: the band just vanished with
  // nothing persisted and no visible sign anything went wrong.
  const confirmWatchDraft = useCallback(async () => {
    if (!watchDraftCommitted || isSavingWatch) return;
    const isEditing = !!editingZoneId;
    // No handler wired up at all (shouldn't happen — the button only
    // renders when onWatchConfirm/onUpdateWatchZone is provided) is a
    // failure, not a no-op success — never silently discard the draft.
    if (isEditing ? !onUpdateWatchZone : !onWatchConfirm) {
      setWatchSaveError(isEditing ? "Editing isn't available on this chart" : "Watch isn't available on this chart");
      return;
    }
    setWatchSaveError(null);
    setIsSavingWatch(true);
    try {
      const result = isEditing
        ? await onUpdateWatchZone!(editingZoneId!, { ...watchDraftCommitted, direction: watchDirection })
        : await onWatchConfirm!({ ...watchDraftCommitted, direction: watchDirection });
      if (result === false) {
        setWatchSaveError('Failed to save — try again');
      } else {
        setWatchDraftCommitted(null);
        setEditingZoneId(null);
      }
    } catch (e) {
      setWatchSaveError(e instanceof Error ? e.message : 'Failed to save — try again');
    } finally {
      setIsSavingWatch(false);
    }
  }, [watchDraftCommitted, watchDirection, onWatchConfirm, onUpdateWatchZone, editingZoneId, isSavingWatch]);

  // Delete affordance on each drawn watch zone (the small trash button in
  // its label overlay below) — confirms here since it's a generic "are you
  // sure", then hands off to the caller's actual delete call.
  const handleDeleteZonePress = useCallback((zone: ChartWatchZone) => {
    if (!onDeleteWatchZone) return;
    const priceLabel = zone.high === zone.low
      ? `$${zone.high.toFixed(2)}`
      : `$${zone.low.toFixed(2)}–$${zone.high.toFixed(2)}`;
    Alert.alert(
      'Delete watch zone?',
      `This removes ${priceLabel} from ${zone.direction} watch. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDeleteWatchZone(zone.id) },
      ],
    );
  }, [onDeleteWatchZone]);

  // Chart-body gestures — four distinct interactions, deliberately kept
  // from stepping on one another:
  //   1. Quick tap        → reveal X/Y values at that point (singleTapGesture)
  //   2. Press-and-hold,
  //      then drag         → crosshair inspection, live-updating (scrubGesture) —
  //                          or, in Watch mode, draw a price level/zone instead
  //   3. Any drag          → pan the visible time window, freely in X and Y
  //                          (manipulateGesture) — this must ALWAYS win over
  //                          scrubGesture the instant real movement starts,
  //                          panning is the primary interaction and inspection
  //                          is the secondary one, never the other way around
  //   4. Drag on the Y-axis gutter → expand/compress the price scale (manipulateGesture)
  //   5. Two-finger pinch  → zoom both axes together (pinchGesture)
  // (2) and (3) are disambiguated by MOVEMENT, not time: manipulateGesture
  // is given a tiny (3px) activation offset via activeOffsetX/Y below, so
  // it wins the instant the touch moves at all — even a slow, deliberate
  // drag — rather than only when it crosses the platform's implicit
  // (much larger) default pan threshold within SCRUB_LONG_PRESS_MS. Without
  // that tight offset, a careful/slow single-finger pan could fail to
  // activate manipulateGesture before scrubGesture's timer fired, silently
  // hijacking what was meant to be a pan into a crosshair-lock instead —
  // exactly the "long press conflicts with sliding through the chart" bug
  // this was tuned to fix. scrubGesture only ever wins when the touch stays
  // essentially still (within that 3px) for the full SCRUB_LONG_PRESS_MS.
  // (1) and (2)/(3) are disambiguated by MOVEMENT + DURATION: a tap
  // gesture only completes if the touch releases quickly with minimal
  // movement, which naturally fails the instant real dragging starts.
  const SCRUB_LONG_PRESS_MS = 500;

  // Bar index math is scoped to the visible WINDOW, not the full series —
  // scrubbing/tapping while zoomed should track the bar under the finger
  // on screen, not the bar at that fractional position in the whole
  // fetched dataset.
  const scrubGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .activateAfterLongPress(SCRUB_LONG_PRESS_MS)
        .onBegin((e) => {
          'worklet';
          if (watchMode) {
            watchStartYShared.value = e.y;
            runOnJS(triggerHaptic)();
            runOnJS(beginWatchDraft)(e.y);
            return;
          }
          if (visibleCount < 2 || plotW === 0) return;
          const step = plotW / visibleCount;
          const idx = Math.max(visibleStart, Math.min(visibleEnd, visibleStart + Math.floor(e.x / step)));
          scrubIndexShared.value = idx;
          runOnJS(triggerHaptic)();
          runOnJS(notifyScrub)(idx);
        })
        .onUpdate((e) => {
          'worklet';
          if (watchMode) {
            runOnJS(updateWatchDraft)(watchStartYShared.value, e.y);
            return;
          }
          if (visibleCount < 2 || plotW === 0) return;
          const step = plotW / visibleCount;
          const idx = Math.max(visibleStart, Math.min(visibleEnd, visibleStart + Math.floor(e.x / step)));
          if (idx !== scrubIndexShared.value) {
            scrubIndexShared.value = idx;
            runOnJS(notifyScrub)(idx);
          }
        })
        .onFinalize(() => {
          'worklet';
          if (watchMode) {
            runOnJS(commitWatchDraft)();
            return;
          }
          scrubIndexShared.value = -1;
          runOnJS(notifyScrub)(-1);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchMode, visibleStart, visibleEnd, visibleCount, plotW, notifyScrub, triggerHaptic, beginWatchDraft, updateWatchDraft, commitWatchDraft],
  );

  // Double-tap anywhere resets both axes back to auto-fit. Defined before
  // singleTapGesture below since that one needs to reference it directly
  // (requireExternalGestureToFail) to disambiguate the two.
  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          'worklet';
          runOnJS(resetZoom)();
        }),
    [resetZoom],
  );

  // Single quick tap — reveals the X/Y readout at that point and PINS it
  // there (unlike scrubGesture's crosshair, which clears the moment you
  // release). Stays showing until: another tap moves it, a press-and-hold
  // slide takes over, or a pan/rescale drag begins (manipulateGesture
  // clears it — see its onUpdate below). requireExternalGestureToFail
  // makes this wait to see whether a second tap follows before firing, so
  // a real double-tap (reset) never also fires this as a false single-tap
  // first — the standard gesture-handler pattern for disambiguating the two.
  const singleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(250)
        .requireExternalGestureToFail(doubleTapGesture)
        .onEnd((e) => {
          'worklet';
          if (visibleCount < 2 || plotW === 0) return;
          const step = plotW / visibleCount;
          const idx = Math.max(visibleStart, Math.min(visibleEnd, visibleStart + Math.floor(e.x / step)));
          scrubIndexShared.value = idx;
          runOnJS(triggerHaptic)();
          runOnJS(notifyScrub)(idx);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doubleTapGesture, visibleStart, visibleEnd, visibleCount, plotW, notifyScrub, triggerHaptic],
  );

  // ── Pan/zoom gestures ────────────────────────────────────────────────
  // One plain (no-delay) Pan that branches by where the touch started:
  // the right price-axis gutter rescales Y only, the bottom time-axis row
  // rescales X only, anywhere else on the chart body pans through time.
  // Having no activation delay is what lets it win the race against the
  // long-press-gated scrub gesture above on a quick drag.
  type PanZoomStart = { start: number; end: number; lo: number; hi: number };
  const panStartShared = useSharedValue<PanZoomStart | null>(null);
  const panModeShared = useSharedValue<'time-pan' | 'y-rescale' | 'x-rescale' | null>(null);
  // Last X window actually committed to React state, from whichever of
  // manipulateGesture/pinchGesture is driving it. setXWindow used to fire
  // on EVERY onUpdate frame unconditionally — including the many
  // sub-bar-width frames where newStart/newEnd rounded to the exact same
  // values as last frame — forcing a full SVG re-render (candles, volume,
  // gridlines, bands, zones) on every single pixel of finger movement, not
  // just the frames where the visible window actually changed. On a
  // zoomed-in view (each bar spanning 20-40px), that's dozens of wasted
  // re-renders per real bar-shift, which reads as exactly the "snapped/
  // laggy, can't navigate freely" feel this fixes. Only call setXWindow when
  // the rounded window is actually different from what's already committed.
  const lastXWindowShared = useSharedValue<{ start: number; end: number } | null>(null);

  const manipulateGesture = useMemo(
    () =>
      Gesture.Pan()
        // Single-finger only — without this, an active pan keeps consuming
        // a second finger's touch events too (translation math just blends
        // them in), which starved pinchGesture of ever seeing 2 pointers at
        // once and made two-finger pinch-zoom effectively not work. Failing
        // this out the instant a 2nd finger lands hands both touches over
        // to pinchGesture cleanly (see Gesture.Simultaneous below).
        .maxPointers(1)
        // Tight 3px activation offset — see the gesture-priority comment
        // above scrubGesture: this is what makes ANY real movement, however
        // slow, win the race against the long-press crosshair immediately,
        // instead of only movement that crosses the platform's larger
        // implicit default pan threshold.
        .activeOffsetX([-3, 3])
        .activeOffsetY([-3, 3])
        .onBegin((e) => {
          'worklet';
          if (!scale) return;
          panStartShared.value = { start: visibleStart, end: visibleEnd, lo: scale.lo, hi: scale.hi };
          lastXWindowShared.value = { start: visibleStart, end: visibleEnd };
          if (e.x > plotW) panModeShared.value = 'y-rescale';
          else if (e.y > height - X_AXIS_H) panModeShared.value = 'x-rescale';
          else panModeShared.value = 'time-pan';
        })
        .onUpdate((e) => {
          'worklet';
          const st = panStartShared.value;
          const mode = panModeShared.value;
          if (!st || !mode || plotW === 0) return;
          // This only runs once real movement is underway, which under
          // Gesture.Race only happens for whichever gesture actually won —
          // i.e. it's safe to treat this as "a pan/rescale is genuinely
          // happening now" and clear any pinned tap-reveal or in-progress
          // scrub crosshair still showing from a moment ago.
          if (scrubIndexShared.value !== -1) {
            scrubIndexShared.value = -1;
            runOnJS(notifyScrub)(-1);
          }
          const curCount = st.end - st.start + 1;

          if (mode === 'time-pan') {
            // Drag right → reveal earlier bars (window shifts back).
            const barsShift = (e.translationX / plotW) * curCount;
            let newStart = Math.round(st.start - barsShift);
            let newEnd = newStart + curCount - 1;
            // Hitting this means the drag is trying to reveal bars before
            // index 0 — exactly the "pan past the left edge" moment to kick
            // off loading an earlier day (see fetchEarlierDay). Guarded
            // there against overlapping calls, so firing on every frame of
            // a sustained past-the-edge drag is fine.
            if (newStart < 0) {
              newEnd -= newStart;
              newStart = 0;
              runOnJS(fetchEarlierDay)();
            }
            if (newEnd > count - 1) { newStart -= newEnd - (count - 1); newEnd = count - 1; }
            newStart = Math.max(0, newStart);
            const lastX = lastXWindowShared.value;
            if (!lastX || lastX.start !== newStart || lastX.end !== newEnd) {
              lastXWindowShared.value = { start: newStart, end: newEnd };
              runOnJS(setXWindow)({ start: newStart, end: newEnd });
            }

            // Free vertical pan alongside the horizontal one — drag down
            // reveals higher prices that were scrolled above the fold, same
            // "grab and pull" feel as the X shift above. A near-horizontal
            // drag naturally produces a near-zero Y shift here (proportional
            // to how much vertical movement actually happened), so this
            // doesn't fight a deliberately axis-locked drag. Needed so a
            // price level well outside the auto-fit range (the whole point
            // of Watch mode) is reachable without first having to zoom out.
            if (priceH > 0 && st.hi > st.lo) {
              const priceShift = (e.translationY / priceH) * (st.hi - st.lo);
              runOnJS(setYOverride)({ lo: st.lo + priceShift, hi: st.hi + priceShift });
            }
          } else if (mode === 'x-rescale') {
            // Drag right narrows the visible window (zoom in on time),
            // anchored at the window's current center.
            const factor = clampZoomFactor(1 - e.translationX / plotW);
            const centerIdx = (st.start + st.end) / 2;
            const newCount = Math.max(MIN_VISIBLE_BARS, Math.min(count, Math.round(curCount * factor)));
            let newStart = Math.round(centerIdx - newCount / 2);
            let newEnd = newStart + newCount - 1;
            if (newStart < 0) { newEnd -= newStart; newStart = 0; }
            if (newEnd > count - 1) { newStart -= newEnd - (count - 1); newEnd = count - 1; }
            newStart = Math.max(0, newStart);
            const lastXR = lastXWindowShared.value;
            if (!lastXR || lastXR.start !== newStart || lastXR.end !== newEnd) {
              lastXWindowShared.value = { start: newStart, end: newEnd };
              runOnJS(setXWindow)({ start: newStart, end: newEnd });
            }
          } else {
            // y-rescale — drag down narrows the price range (zoom in),
            // anchored at the domain's current center price.
            if (priceH === 0) return;
            const factor = clampZoomFactor(1 + e.translationY / priceH);
            const curRange = st.hi - st.lo;
            const centerPrice = (st.hi + st.lo) / 2;
            const newRange = curRange * factor;
            runOnJS(setYOverride)({ lo: centerPrice - newRange / 2, hi: centerPrice + newRange / 2 });
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scale, visibleStart, visibleEnd, plotW, priceH, height, count, notifyScrub, fetchEarlierDay],
  );

  // Two-finger pinch — zooms both axes together, centered on the pinch focal
  // point. Composed via Gesture.Simultaneous alongside the pan race below,
  // since it only ever engages with 2 fingers and can't conflict with them.
  const pinchStartShared = useSharedValue<PanZoomStart | null>(null);
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          'worklet';
          pinchStartShared.value = scale ? { start: visibleStart, end: visibleEnd, lo: scale.lo, hi: scale.hi } : null;
          lastXWindowShared.value = scale ? { start: visibleStart, end: visibleEnd } : null;
        })
        .onUpdate((e) => {
          'worklet';
          const st = pinchStartShared.value;
          if (!st || !(e.scale > 0) || plotW === 0) return;
          // Pinching outward (scale > 1) zooms IN — narrower window, tighter range.
          const factor = clampZoomFactor(1 / e.scale);
          const curCount = st.end - st.start + 1;

          const newCount = Math.max(MIN_VISIBLE_BARS, Math.min(count, Math.round(curCount * factor)));
          const focalXFrac = e.focalX / plotW;
          const focalIdx = st.start + focalXFrac * curCount;
          let newStart = Math.round(focalIdx - focalXFrac * newCount);
          let newEnd = newStart + newCount - 1;
          if (newStart < 0) { newEnd -= newStart; newStart = 0; }
          if (newEnd > count - 1) { newStart -= newEnd - (count - 1); newEnd = count - 1; }
          newStart = Math.max(0, newStart);
          const lastXP = lastXWindowShared.value;
          if (!lastXP || lastXP.start !== newStart || lastXP.end !== newEnd) {
            lastXWindowShared.value = { start: newStart, end: newEnd };
            runOnJS(setXWindow)({ start: newStart, end: newEnd });
          }

          if (priceH > 0) {
            const curRange = st.hi - st.lo;
            const newRange = curRange * factor;
            const focalYFrac = e.focalY / priceH;
            const focalPrice = st.hi - focalYFrac * curRange;
            const newHi = focalPrice + focalYFrac * newRange;
            runOnJS(setYOverride)({ lo: newHi - newRange, hi: newHi });
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scale, visibleStart, visibleEnd, plotW, priceH, count],
  );

  const composedGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        pinchGesture,
        // crosshairEnabled === false drops scrubGesture/singleTapGesture out
        // of the race entirely (see useCrosshairEnabled) — pan and reset-zoom
        // still work exactly the same either way.
        crosshairEnabled
          ? Gesture.Race(doubleTapGesture, singleTapGesture, scrubGesture, manipulateGesture)
          : Gesture.Race(doubleTapGesture, manipulateGesture),
      ),
    [pinchGesture, doubleTapGesture, singleTapGesture, scrubGesture, manipulateGesture, crosshairEnabled],
  );

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const scrubbing = scrubIndex >= 0 && scrubIndex < count;
  const labelText = scrubbing
    ? formatScrubLabel(dates[scrubIndex], period)
    : dates.length
      ? new Date(dates[dates.length - 1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;

  // Last-price line: streamed price when available, else the final close.
  const lastClose = prices[prices.length - 1];
  const lastPrice = livePrice ?? lastClose;
  const lastUp = count > 1 ? lastPrice >= prices[count - 2] : true;
  const lastPriceColor = lastUp ? colors.success : colors.error;

  // ── Next-candle countdown (1D only — 5-min bars) ───────────────────────
  // Ticks once a second purely to re-render this label; the actual new bar
  // arrives via the history query's own background refetch (see
  // TickerDetailSheet's refetchIntervalMs) — this is display-only.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (period !== '1D') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [period]);

  const nextCandleSecs = useMemo(() => {
    if (period !== '1D' || dates.length === 0) return null;
    // Derive the bar interval from the data itself (rather than assuming
    // 5 minutes) so this stays correct if the backend's bar size ever
    // changes; falls back to 5 min when there's only one bar to go on.
    const lastMs = new Date(dates[dates.length - 1]).getTime();
    const barMs = dates.length >= 2
      ? lastMs - new Date(dates[dates.length - 2]).getTime()
      : 5 * 60 * 1000;
    if (!(barMs > 0)) return null;
    const nextBarMs = lastMs + barMs;
    return Math.max(0, Math.round((nextBarMs - nowTick) / 1000));
  }, [period, dates, nowTick]);

  const candleCountdownLabel = nextCandleSecs != null
    ? `${Math.floor(nextCandleSecs / 60)}:${String(nextCandleSecs % 60).padStart(2, '0')}`
    : null;

  const candleW = scale ? Math.max(1, Math.min(scale.step * 0.65, 12)) : 0;

  return (
    <SafeAreaView>
      {/* Top row: chart-mode toggle (left) + date / scrub label (right).
          Fixed height so scrubbing never reflows the chart below. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 26, marginBottom: 6 }}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {hasOhlc &&
            (['line', 'candle'] as ChartMode[]).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setModeOverride(m)}
                  hitSlop={6}
                  style={{
                    width: 30,
                    height: 26,
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? colors.surfaceSecondary : 'transparent',
                  }}
                >
                  <Ionicons
                    name={m === 'line' ? 'analytics-outline' : 'stats-chart-outline'}
                    size={15}
                    color={active ? colors.text : colors.textTertiary}
                  />
                </Pressable>
              );
            })}
          {/* Only rendered where a caller actually wired up onWatchConfirm —
              without it, the button would silently no-op: tapping "Watch"
              would resolve an undefined callback as instant "success" with
              nothing to await and nothing saved (no spinner, no error,
              band just clears). See PriceChartFullScreen/charts.tsx for the
              wired-up callers. */}
          {onWatchConfirm && (
            <Pressable
              onPress={() => {
                setWatchMode(v => !v);
                setWatchDraftPx(null);
                setWatchDraftCommitted(null);
                setWatchSaveError(null);
              }}
              hitSlop={6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingHorizontal: 8,
                height: 26,
                borderRadius: 8,
                backgroundColor: watchMode ? colors.accent + '22' : 'transparent',
              }}
            >
              <Ionicons
                name={watchMode ? 'eye' : 'eye-outline'}
                size={14}
                color={watchMode ? colors.accent : colors.textTertiary}
              />
              <Text style={{ fontSize: 11, fontWeight: '700', color: watchMode ? colors.accent : colors.textTertiary }}>
                Watch
              </Text>
            </Pressable>
          )}
          {/* Only rendered when there's actually session-line data to show —
              same "don't render a button with nothing to do" rule as Watch
              above. Off by default (showSessionLines starts false). */}
          {sessionReferenceLines && sessionReferenceLines.length > 0 && (
            <Pressable
              onPress={() => setShowSessionLines(v => !v)}
              hitSlop={6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingHorizontal: 8,
                height: 26,
                borderRadius: 8,
                backgroundColor: showSessionLines ? colors.accent + '22' : 'transparent',
              }}
            >
              <Ionicons
                name={showSessionLines ? 'partly-sunny' : 'partly-sunny-outline'}
                size={14}
                color={showSessionLines ? colors.accent : colors.textTertiary}
              />
              <Text style={{ fontSize: 11, fontWeight: '700', color: showSessionLines ? colors.accent : colors.textTertiary }}>
                Sessions
              </Text>
            </Pressable>
          )}
          {/* Show/hide watched zones (key levels) — ON by default, so this
              only appears once there's actually a zone to hide. Lets a
              ticker's raw price action be viewed without the level overlay,
              without having to delete the level to get there. */}
          {watchZones && watchZones.length > 0 && (
            <Pressable
              onPress={() => setShowWatchZones(!showWatchZones)}
              hitSlop={6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingHorizontal: 8,
                height: 26,
                borderRadius: 8,
                backgroundColor: showWatchZones ? colors.accent + '22' : 'transparent',
              }}
            >
              <Ionicons
                name={showWatchZones ? 'layers' : 'layers-outline'}
                size={14}
                color={showWatchZones ? colors.accent : colors.textTertiary}
              />
              <Text style={{ fontSize: 11, fontWeight: '700', color: showWatchZones ? colors.accent : colors.textTertiary }}>
                Levels
              </Text>
            </Pressable>
          )}
          {isZoomed && (
            <Pressable
              onPress={resetZoom}
              hitSlop={6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingHorizontal: 8,
                height: 26,
                borderRadius: 8,
                backgroundColor: colors.surfaceSecondary,
              }}
            >
              <Ionicons name="contract-outline" size={13} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>Reset</Text>
            </Pressable>
          )}
        </View>
        {watchMode && !watchDraftPx && !watchDraftCommitted ? (
          <Text style={{ color: colors.accent, fontSize: 11.5, fontWeight: '600' }} numberOfLines={1}>
            {onUpdateWatchZone
              ? 'Long-press & drag to mark a level · tap an existing one to edit'
              : 'Long-press & drag to mark a level'}
          </Text>
        ) : labelText && !watchMode ? (
          <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '500' }}>{labelText}</Text>
        ) : null}
      </View>

      <View onLayout={onLayout} style={{ height, width: '100%' }}>
        {isLoading || !hasData || !scale ? (
          !hasData && showEmptyState ? (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                backgroundColor: colors.surfaceSecondary,
              }}
            >
              <Ionicons name="bar-chart-outline" size={36} color={colors.textTertiary} />
              <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 8 }}>
                No chart data available
              </Text>
            </View>
          ) : (
            // Same background as the loaded chart sits on (colors.background,
            // not the lighter surfaceSecondary) — a plain centered spinner
            // over a matching backdrop, not a differently-colored placeholder
            // block, so nothing visibly "pops" when the real chart swaps in.
            <View style={{ flex: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          )
        ) : (
          <GestureDetector gesture={composedGesture}>
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="advPriceFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={lineColor} stopOpacity={0.25} />
                  <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
                </LinearGradient>
              </Defs>

              {/* Horizontal gridlines + y-axis price labels (recessive) */}
              {scale.yTicks.map((t) => {
                const y = scale.yForPrice(t);
                return (
                  <Fragment key={`ytick-${t}`}>
                    <Line x1={0} x2={plotW} y1={y} y2={y} stroke={colors.textTertiary} strokeWidth={1} opacity={0.12} />
                    <SvgText x={plotW + 6} y={y + 3.5} fill={colors.textTertiary} fontSize={10} fontWeight="500">
                      {formatAxisPrice(t)}
                    </SvgText>
                  </Fragment>
                );
              })}

              {/* Faint vertical gridlines — the actual x-axis time labels are
                  drawn last (see below), on an opaque backing, so candle
                  wicks/volume bars drawn after this point never bleed into
                  the date text underneath them. */}
              {scale.xTicks.map((i) => {
                const x = scale.xForIndex(i);
                return (
                  <Line
                    key={`xtick-${i}`}
                    x1={x} x2={x} y1={0} y2={volTop + VOL_H}
                    stroke={colors.textTertiary} strokeWidth={1} opacity={0.07}
                  />
                );
              })}

              {/* ORB band — shaded box between ORH/ORL like the TradingView overlay.
                  Starts at the 09:30 ET bar (orbBandX), not the chart's left
                  edge — see regularSessionStartIndex's doc comment. Clamped
                  to 0 so zooming into a later part of the day (09:30 bar
                  scrolled out of view to the left) doesn't push it negative. */}
              {orbVisible && orbRange && (() => {
                const orbBandX = Math.max(0, scale.xForIndex(regularSessionStartIndex));
                return (
                <>
                  <Rect
                    x={orbBandX}
                    y={scale.yForPrice(orbRange.high)}
                    width={Math.max(0, plotW - orbBandX)}
                    height={Math.max(0, scale.yForPrice(orbRange.low) - scale.yForPrice(orbRange.high))}
                    fill={colors.error}
                    opacity={0.08}
                  />
                  <Line
                    x1={orbBandX} x2={plotW}
                    y1={scale.yForPrice(orbRange.high)} y2={scale.yForPrice(orbRange.high)}
                    stroke={colors.success} strokeWidth={1.25}
                  />
                  <Line
                    x1={orbBandX} x2={plotW}
                    y1={scale.yForPrice(orbRange.low)} y2={scale.yForPrice(orbRange.low)}
                    stroke={colors.error} strokeWidth={1.25}
                  />
                  <Line
                    x1={orbBandX} x2={plotW}
                    y1={scale.yForPrice((orbRange.high + orbRange.low) / 2)}
                    y2={scale.yForPrice((orbRange.high + orbRange.low) / 2)}
                    stroke={colors.textTertiary} strokeWidth={1} strokeDasharray="5,5" opacity={0.6}
                  />
                  <Rect
                    x={plotW - 88} y={scale.yForPrice(orbRange.high) - 19}
                    width={84} height={16} rx={4}
                    fill={colors.background} opacity={0.85}
                  />
                  <SvgText
                    x={plotW - 8} y={scale.yForPrice(orbRange.high) - 7}
                    fill={colors.success} fontSize={10.5} fontWeight="700" textAnchor="end"
                  >
                    {`ORH ${orbRange.high.toFixed(2)}`}
                  </SvgText>
                  <Rect
                    x={plotW - 88} y={scale.yForPrice(orbRange.low) + 3}
                    width={84} height={16} rx={4}
                    fill={colors.background} opacity={0.85}
                  />
                  <SvgText
                    x={plotW - 8} y={scale.yForPrice(orbRange.low) + 15}
                    fill={colors.error} fontSize={10.5} fontWeight="700" textAnchor="end"
                  >
                    {`ORL ${orbRange.low.toFixed(2)}`}
                  </SvgText>
                </>
                );
              })()}

              {/* Reference lines — e.g. entry/TP1/TP2/stop for a simulation
                  or live position. Dashed + left-anchored labels, distinct
                  from the ORB band's solid lines + right-anchored pills. */}
              {effectiveReferenceLines.map((line) => {
                const y = scale.yForPrice(line.price);
                const color = line.color ?? colors.textSecondary;
                return (
                  <Fragment key={`ref-${line.label}`}>
                    <Line
                      x1={0} x2={plotW} y1={y} y2={y}
                      stroke={color} strokeWidth={1.25}
                      strokeDasharray={line.dash ?? '4,4'}
                    />
                    <Rect x={4} y={y - 15} width={line.label.length * 6 + 44} height={16} rx={4} fill={colors.background} opacity={0.85} />
                    <SvgText x={8} y={y - 3} fill={color} fontSize={10.5} fontWeight="700">
                      {`${line.label} ${formatAxisPrice(line.price)}`}
                    </SvgText>
                  </Fragment>
                );
              })}

              {/* Existing watched zones — shaded band, dashed while still
                  'watching', solid once 'confirmed'. Hidden entirely when
                  showWatchZones is off (toolbar toggle, default on). */}
              {effectiveWatchZones?.map((z) => {
                const color = z.direction === 'either' ? colors.accent : z.direction === 'bullish' ? colors.success : colors.error;
                const yHigh = scale.yForPrice(z.high);
                const yLow = scale.yForPrice(z.low);
                const isPoint = z.high === z.low;
                return (
                  <Fragment key={z.id}>
                    {!isPoint && (
                      <Rect x={0} y={yHigh} width={plotW} height={Math.max(1, yLow - yHigh)} fill={color} opacity={0.08} />
                    )}
                    <Line
                      x1={0} x2={plotW} y1={yHigh} y2={yHigh}
                      stroke={color} strokeWidth={1.25}
                      strokeDasharray={z.status === 'watching' ? '4,4' : undefined}
                      opacity={0.85}
                    />
                    {!isPoint && (
                      <Line
                        x1={0} x2={plotW} y1={yLow} y2={yLow}
                        stroke={color} strokeWidth={1.25}
                        strokeDasharray={z.status === 'watching' ? '4,4' : undefined}
                        opacity={0.85}
                      />
                    )}
                  </Fragment>
                );
              })}

              {/* Watch-mode draft — live while dragging, held while a
                  Confirm/Cancel bar is up after release. */}
              {watchMode && (watchDraftPx || watchDraftCommitted) && (() => {
                const color = watchDirection === 'either' ? colors.accent : watchDirection === 'bullish' ? colors.success : colors.error;
                const yTop = watchDraftPx ? Math.min(watchDraftPx.startY, watchDraftPx.endY) : scale.yForPrice(watchDraftCommitted!.high);
                const yBottom = watchDraftPx ? Math.max(watchDraftPx.startY, watchDraftPx.endY) : scale.yForPrice(watchDraftCommitted!.low);
                const priceHigh = watchDraftPx ? scale.priceForY(yTop) : watchDraftCommitted!.high;
                const priceLow = watchDraftPx ? scale.priceForY(yBottom) : watchDraftCommitted!.low;
                return (
                  <Fragment>
                    <Rect x={0} y={yTop} width={plotW} height={Math.max(1, yBottom - yTop)} fill={color} opacity={0.16} />
                    <Line x1={0} x2={plotW} y1={yTop} y2={yTop} stroke={color} strokeWidth={1.5} strokeDasharray="5,3" />
                    <Line x1={0} x2={plotW} y1={yBottom} y2={yBottom} stroke={color} strokeWidth={1.5} strokeDasharray="5,3" />
                    <Rect x={plotW / 2 - 46} y={(yTop + yBottom) / 2 - 10} width={92} height={20} rx={5} fill={colors.background} opacity={0.92} />
                    <SvgText x={plotW / 2} y={(yTop + yBottom) / 2 + 4} fill={color} fontSize={11} fontWeight="700" textAnchor="middle">
                      {priceHigh - priceLow < 0.005
                        ? formatAxisPrice(priceHigh)
                        : `${formatAxisPrice(priceLow)}–${formatAxisPrice(priceHigh)}`}
                    </SvgText>
                  </Fragment>
                );
              })()}

              {/* Price marks */}
              {mode === 'line' ? (
                <>
                  <Path d={areaPath} fill="url(#advPriceFill)" />
                  <Path d={linePath} stroke={lineColor} strokeWidth={2} fill="none" />
                </>
              ) : (
                visibleIndices.map((i) => {
                  const close = ePrices[i];
                  const open = chartData!.opens![i];
                  const up = close >= open;
                  const color = up ? colors.success : colors.error;
                  const x = scale.xForIndex(i);
                  const bodyTop = scale.yForPrice(Math.max(open, close));
                  const bodyH = Math.max(1, Math.abs(scale.yForPrice(open) - scale.yForPrice(close)));
                  return (
                    <Fragment key={`c-${i}`}>
                      <Line
                        x1={x} x2={x}
                        y1={scale.yForPrice(eHighs![i])} y2={scale.yForPrice(eLows![i])}
                        stroke={color} strokeWidth={1}
                      />
                      <Rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} rx={candleW > 3 ? 1 : 0} />
                    </Fragment>
                  );
                })
              )}

              {/* Event markers — point-in-time annotations (e.g. "TP1 hit")
                  drawn on top of the candles/line, below the volume pane. */}
              {eventMarkers?.map((marker, i) => {
                if (marker.index < visibleStart || marker.index > visibleEnd) return null;
                const x = scale.xForIndex(marker.index);
                const y = scale.yForPrice(marker.price);
                const color = marker.color ?? colors.accent;
                const labelW = marker.label.length * 6 + 12;
                return (
                  <Fragment key={`marker-${i}`}>
                    <Circle cx={x} cy={y} r={4} fill={color} stroke={colors.background} strokeWidth={1.5} />
                    <Rect
                      x={Math.min(Math.max(x - labelW / 2, 0), plotW - labelW)}
                      y={y - 22} width={labelW} height={15} rx={4} fill={color}
                    />
                    <SvgText
                      x={Math.min(Math.max(x, labelW / 2), plotW - labelW / 2)}
                      y={y - 11}
                      fill="#FFFFFF" fontSize={9.5} fontWeight="700" textAnchor="middle"
                    >
                      {marker.label}
                    </SvgText>
                  </Fragment>
                );
              })}

              {/* Volume pane, bars colored by bar direction */}
              {scale.maxVolume > 0 &&
                visibleIndices.map((i) => {
                  const v = volumes[i] ?? 0;
                  const h = Math.max(1, (v / scale.maxVolume) * VOL_H);
                  const up = hasOhlc ? ePrices[i] >= chartData!.opens![i] : i === 0 || ePrices[i] >= ePrices[i - 1];
                  return (
                    <Rect
                      key={`v-${i}`}
                      x={scale.xForIndex(i) - candleW / 2}
                      y={volTop + VOL_H - h}
                      width={Math.max(1, candleW)}
                      height={h}
                      fill={up ? colors.success : colors.error}
                      opacity={0.4}
                    />
                  );
                })}

              {/* Last/live price: dotted line + a single tag in the y-axis
                  gutter that holds BOTH the price and the next-candle
                  countdown — one bordered/filled pill, not a separate
                  floating label underneath it. Taller when the countdown is
                  present (1D only), clamped so it can't overflow past the
                  bottom of the chart when price sits near the low. */}
              {lastPrice != null && lastPrice >= scale.lo && lastPrice <= scale.hi && (() => {
                const tagH = candleCountdownLabel ? 30 : 18;
                const tagY = Math.min(
                  scale.yForPrice(lastPrice) - tagH / 2,
                  volTop + VOL_H - 2 - tagH,
                );
                return (
                <>
                  <Line
                    x1={0} x2={plotW}
                    y1={scale.yForPrice(lastPrice)} y2={scale.yForPrice(lastPrice)}
                    stroke={lastPriceColor} strokeWidth={1} strokeDasharray="2,3"
                  />
                  <Rect
                    x={plotW + 2} y={tagY}
                    width={Y_AXIS_W - 4} height={tagH} rx={4} fill={lastPriceColor}
                  />
                  <SvgText
                    x={plotW + Y_AXIS_W / 2} y={tagY + (candleCountdownLabel ? 13 : 12.5)}
                    fill="#FFFFFF" fontSize={10} fontWeight="700" textAnchor="middle"
                  >
                    {formatAxisPrice(lastPrice)}
                  </SvgText>
                  {candleCountdownLabel && (
                    <SvgText
                      x={plotW + Y_AXIS_W / 2} y={tagY + 25}
                      fill="#FFFFFF" fillOpacity={0.85} fontSize={9} fontWeight="600" textAnchor="middle"
                    >
                      {candleCountdownLabel}
                    </SvgText>
                  )}
                </>
                );
              })()}

              {/* X-axis label strip — an opaque backing drawn OVER the candles/
                  volume/gridlines above (not before them), so wicks and volume
                  bars that extend down near the bottom of the chart never
                  visually blend into the date text. Skipped while scrubbing —
                  the crosshair block right below draws its own opaque time/
                  volume pill in the same strip, so this would just be
                  immediately covered anyway. */}
              {!scrubbing && (
                <>
                  <Rect x={0} y={height - X_AXIS_H} width={width} height={X_AXIS_H} fill={colors.background} />
                  {xAxisTicks.map(({ index, label, isBoundary }) => (
                    <SvgText
                      key={`xlabel-${index}`}
                      x={scale.xForIndex(index)}
                      y={height - 6}
                      fill={isBoundary ? colors.textSecondary : colors.textTertiary}
                      fontSize={10}
                      fontWeight={isBoundary ? '700' : '500'}
                      textAnchor="middle"
                    >
                      {label}
                    </SvgText>
                  ))}
                </>
              )}

              {/* Crosshair: vertical + horizontal line, axis pills for both */}
              {scrubbing && (
                <>
                  <Line
                    x1={scale.xForIndex(scrubIndex)} x2={scale.xForIndex(scrubIndex)}
                    y1={0} y2={volTop + VOL_H}
                    stroke={colors.textSecondary} strokeWidth={1} strokeDasharray="4,4"
                  />
                  <Line
                    x1={0} x2={plotW}
                    y1={scale.yForPrice(ePrices[scrubIndex])} y2={scale.yForPrice(ePrices[scrubIndex])}
                    stroke={colors.textSecondary} strokeWidth={1} strokeDasharray="4,4"
                  />
                  {mode === 'line' && (
                    <Circle
                      cx={scale.xForIndex(scrubIndex)} cy={scale.yForPrice(ePrices[scrubIndex])}
                      r={5} fill={lineColor} stroke={colors.background} strokeWidth={2}
                    />
                  )}
                  {/* Price pill on the y-axis */}
                  <Rect
                    x={plotW + 2} y={scale.yForPrice(ePrices[scrubIndex]) - 9}
                    width={Y_AXIS_W - 4} height={18} rx={4} fill={colors.text}
                  />
                  <SvgText
                    x={plotW + Y_AXIS_W / 2} y={scale.yForPrice(ePrices[scrubIndex]) + 3.5}
                    fill={colors.background} fontSize={10} fontWeight="700" textAnchor="middle"
                  >
                    {formatAxisPrice(ePrices[scrubIndex])}
                  </SvgText>
                  {/* Time + volume pill on the x-axis — widens to fit a full
                      date once the scrubbed bar is on a different day than
                      the chart's most recent bar (see formatCrosshairLabel). */}
                  {(() => {
                    const crosshairLabel = formatCrosshairLabel(dates[scrubIndex], period, dates[dates.length - 1]);
                    const pillW = crosshairLabel.length > 6 ? 96 : 68;
                    const halfW = pillW / 2;
                    return (
                      <>
                        <Rect
                          x={Math.min(Math.max(scale.xForIndex(scrubIndex) - halfW, 0), plotW - pillW)}
                          y={height - X_AXIS_H + 2} width={pillW} height={30} rx={4} fill={colors.text}
                        />
                        <SvgText
                          x={Math.min(Math.max(scale.xForIndex(scrubIndex), halfW), plotW - halfW)}
                          y={height - X_AXIS_H + 13}
                          fill={colors.background} fontSize={9.5} fontWeight="600" textAnchor="middle"
                        >
                          {crosshairLabel}
                        </SvgText>
                        {volumes[scrubIndex] != null && (
                          <SvgText
                            x={Math.min(Math.max(scale.xForIndex(scrubIndex), halfW), plotW - halfW)}
                            y={height - X_AXIS_H + 25}
                            fill={colors.background} fontSize={8.5} fontWeight="500"
                            textAnchor="middle" opacity={0.8}
                          >
                            Vol {formatVolume(volumes[scrubIndex])}
                          </SvgText>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </Svg>
          </GestureDetector>
        )}

        {/* Confirm bar — appears once a Watch-mode drag is released, floating
            over the top of the chart. Direction defaults from which side of
            the live price the drawn zone sits on; still editable here before
            committing, since the auto-guess can be wrong for a zone that
            straddles the current price. */}
        {watchDraftCommitted && (
          <View style={{ position: 'absolute', top: 8, left: 8, right: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                padding: 6,
                borderRadius: 12,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: watchSaveError ? colors.error : colors.border,
                shadowColor: '#000',
                shadowOpacity: 0.15,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
                elevation: 4,
              }}
            >
              <View style={{ flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                {(['bullish', 'either', 'bearish'] as const).map((d) => {
                  const active = watchDirection === d;
                  const c = d === 'bullish' ? colors.success : d === 'bearish' ? colors.error : colors.accent;
                  return (
                    <Pressable
                      key={d}
                      onPress={() => setWatchDirection(d)}
                      disabled={isSavingWatch}
                      style={{
                        paddingHorizontal: 8, paddingVertical: 7,
                        backgroundColor: active ? c + '22' : 'transparent',
                      }}
                    >
                      <Ionicons
                        name={d === 'bullish' ? 'trending-up' : d === 'bearish' ? 'trending-down' : 'swap-vertical'}
                        size={14}
                        color={active ? c : colors.textTertiary}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.text }} numberOfLines={1}>
                {editingZoneId ? 'Edit ' : 'Watch '}
                {watchDraftCommitted.high - watchDraftCommitted.low < 0.005
                  ? `$${formatAxisPrice(watchDraftCommitted.high)}`
                  : `$${formatAxisPrice(watchDraftCommitted.low)}–$${formatAxisPrice(watchDraftCommitted.high)}`}
              </Text>
              <Pressable onPress={cancelWatchDraft} disabled={isSavingWatch} hitSlop={6} style={{ padding: 6, opacity: isSavingWatch ? 0.4 : 1 }}>
                <Ionicons name="close" size={18} color={colors.textTertiary} />
              </Pressable>
              <Pressable
                onPress={confirmWatchDraft}
                disabled={isSavingWatch}
                hitSlop={6}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
                  backgroundColor: colors.accent, opacity: isSavingWatch ? 0.7 : 1,
                  minWidth: 66, justifyContent: 'center',
                }}
              >
                {isSavingWatch ? (
                  <ActivityIndicator size="small" color={colors.accentForeground} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={14} color={colors.accentForeground} />
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.accentForeground }}>
                      {editingZoneId ? 'Update' : 'Watch'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
            {watchSaveError && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                marginTop: 5, paddingHorizontal: 10, paddingVertical: 6,
                borderRadius: 8, backgroundColor: colors.error + '18',
              }}>
                <Ionicons name="alert-circle-outline" size={13} color={colors.error} />
                <Text style={{ color: colors.error, fontSize: 11.5, fontWeight: '600', flex: 1 }} numberOfLines={2}>
                  {watchSaveError}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Per-zone label (+ edit/delete once in Watch mode) — a real RN
            touch target layered over the SVG canvas (raw SVG shapes aren't
            reliably tappable across platforms), so it's a plain absolutely-
            positioned sibling here rather than drawn inside <Svg>. Hidden
            along with the zones themselves when showWatchZones is off.
            Edit/delete only appear while watchMode is on — Levels stays a
            pure viewing toggle; Watch is what turns this chart editable. */}
        {showWatchZones && scale && effectiveWatchZones?.map((z) => {
          const color = z.direction === 'either' ? colors.accent : z.direction === 'bullish' ? colors.success : colors.error;
          const yHigh = scale!.yForPrice(z.high);
          const label = z.high === z.low
            ? `$${formatAxisPrice(z.high)}`
            : `$${formatAxisPrice(z.low)}–$${formatAxisPrice(z.high)}`;
          const editable = watchMode && !!onUpdateWatchZone;
          return (
            <View
              key={`zone-label-${z.id}`}
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                top: Math.max(0, yHigh - 20),
                left: 6, right: Y_AXIS_W + 4,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <Pressable
                onPress={editable ? () => handleEditZonePress(z) : undefined}
                disabled={!editable}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: colors.background + 'D9', borderRadius: 5,
                  paddingHorizontal: 5, paddingVertical: 2,
                  borderWidth: 1, borderColor: color + '55',
                }}
              >
                <Ionicons
                  name={z.direction === 'either' ? 'swap-vertical' : z.direction === 'bullish' ? 'trending-up' : 'trending-down'}
                  size={10} color={color}
                />
                <Text style={{ fontSize: 10, fontWeight: '700', color }}>{label}</Text>
                {editable && <Ionicons name="create-outline" size={10} color={color} />}
              </Pressable>
              {onDeleteWatchZone && watchMode && (
                <Pressable
                  onPress={() => handleDeleteZonePress(z)}
                  hitSlop={8}
                  style={{
                    width: 22, height: 22, borderRadius: 11,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: colors.background + 'D9',
                    borderWidth: 1, borderColor: colors.error + '55',
                  }}
                >
                  <Ionicons name="trash-outline" size={12} color={colors.error} />
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
        {PERIODS.map((p) => {
          const active = p === period;
          return (
            <Pressable
              key={p}
              onPress={() => onPeriodChange(p)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
                backgroundColor: active ? colors.accent : 'transparent',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: active ? colors.accentForeground : colors.textSecondary,
                }}
              >
                {p}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
};
