import type React from 'react';
import { Fragment, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, LayoutChangeEvent, SafeAreaView, ActivityIndicator } from 'react-native';
import Svg, { Path, Rect, Line, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
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

interface AdvancedPriceChartProps {
  data: TickerHistoryData | undefined;
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
  /** Point-in-time annotations drawn on top of the price marks. */
  eventMarkers?: ChartEventMarker[] | null;
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
  eventMarkers,
}) => {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);

  const prices = useMemo(() => data?.prices ?? [], [data]);
  const dates = useMemo(() => data?.dates ?? [], [data]);
  const volumes = useMemo(() => data?.volumes ?? [], [data]);

  // OHLC is only usable if every array lines up with closes — a partial or
  // stale-cached payload silently degrades to line mode instead of drawing
  // misaligned candles.
  const hasOhlc =
    !!data &&
    Array.isArray(data.opens) &&
    Array.isArray(data.highs) &&
    Array.isArray(data.lows) &&
    data.opens.length === prices.length &&
    data.highs.length === prices.length &&
    data.lows.length === prices.length;

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
    const base = data!.highs!;
    if (!isLiveBar) return base;
    const next = base.slice();
    next[lastIdx] = Math.max(base[lastIdx], livePrice!);
    return next;
  }, [hasOhlc, data, isLiveBar, lastIdx, livePrice]);

  const eLows = useMemo<number[] | undefined>(() => {
    if (!hasOhlc) return undefined;
    const base = data!.lows!;
    if (!isLiveBar) return base;
    const next = base.slice();
    next[lastIdx] = Math.min(base[lastIdx], livePrice!);
    return next;
  }, [hasOhlc, data, isLiveBar, lastIdx, livePrice]);

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
    // Reference lines (entry/TP/stop) must stay visible even before price
    // has actually approached them — same reasoning as the ORB band above.
    if (referenceLines?.length) {
      for (const line of referenceLines) {
        min = Math.min(min, line.price);
        max = Math.max(max, line.price);
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

    // Y ticks on round numbers within the domain.
    const tickStep = niceStep(hi - lo, 4);
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

    return { lo, hi, step, xForIndex, yForPrice, yTicks, xTicks, maxVolume };
  }, [hasData, hasOhlc, ePrices, eHighs, eLows, volumes, plotW, priceH, orbVisible, orbRange, referenceLines, yOverride, visibleIndices, visibleStart, visibleCount]);

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

  const notifyScrub = useCallback(
    (index: number) => {
      setScrubIndex(index);
      if (index === -1 || !data) {
        onScrub?.(null);
        return;
      }
      // Scrubbing the last bar while it's live-updating should read the same
      // blended values the candle itself is drawing, not the stale fetch.
      const live = isLiveBar && index === lastIdx;
      onScrub?.({
        index,
        date: data.dates[index],
        price: live ? livePrice! : data.prices[index],
        open: data.opens?.[index],
        high: live && data.highs ? Math.max(data.highs[index], livePrice!) : data.highs?.[index],
        low: live && data.lows ? Math.min(data.lows[index], livePrice!) : data.lows?.[index],
        volume: data.volumes?.[index],
      });
    },
    [data, onScrub, isLiveBar, lastIdx, livePrice],
  );

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // Chart-body gestures — four distinct interactions, deliberately kept
  // from stepping on one another:
  //   1. Quick tap        → reveal X/Y values at that point (singleTapGesture)
  //   2. Press-and-hold,
  //      then drag         → slide through data, live-updating (scrubGesture)
  //   3. Immediate drag    → scroll/pan the visible time window (manipulateGesture)
  //   4. Drag on the Y-axis gutter → expand/compress the price scale (manipulateGesture)
  // (2) and (3) are disambiguated by TIME: manipulateGesture has no
  // activation delay so it wins a race against scrubGesture on any drag
  // that starts moving right away; scrubGesture only wins if the touch
  // stays still for `SCRUB_LONG_PRESS_MS` before moving. That threshold
  // needs to clear ordinary touch-down hesitation (people often rest a
  // finger briefly before committing to a drag direction) without making
  // a deliberate hold feel sluggish — 350ms is the balance point; the
  // previous 150ms was short enough that normal pre-drag hesitation alone
  // satisfied it, so scrub kept winning drags it shouldn't have.
  // (1) and (2)/(3) are disambiguated by MOVEMENT + DURATION: a tap
  // gesture only completes if the touch releases quickly with minimal
  // movement, which naturally fails the instant real dragging starts.
  const SCRUB_LONG_PRESS_MS = 350;

  // Bar index math is scoped to the visible WINDOW, not the full series —
  // scrubbing/tapping while zoomed should track the bar under the finger
  // on screen, not the bar at that fractional position in the whole
  // fetched dataset.
  const scrubGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(SCRUB_LONG_PRESS_MS)
        .onBegin((e) => {
          'worklet';
          if (visibleCount < 2 || plotW === 0) return;
          const step = plotW / visibleCount;
          const idx = Math.max(visibleStart, Math.min(visibleEnd, visibleStart + Math.floor(e.x / step)));
          scrubIndexShared.value = idx;
          runOnJS(triggerHaptic)();
          runOnJS(notifyScrub)(idx);
        })
        .onUpdate((e) => {
          'worklet';
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
          scrubIndexShared.value = -1;
          runOnJS(notifyScrub)(-1);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleStart, visibleEnd, visibleCount, plotW, notifyScrub, triggerHaptic],
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

  const manipulateGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          'worklet';
          if (!scale) return;
          panStartShared.value = { start: visibleStart, end: visibleEnd, lo: scale.lo, hi: scale.hi };
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
            if (newStart < 0) { newEnd -= newStart; newStart = 0; }
            if (newEnd > count - 1) { newStart -= newEnd - (count - 1); newEnd = count - 1; }
            newStart = Math.max(0, newStart);
            runOnJS(setXWindow)({ start: newStart, end: newEnd });
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
            runOnJS(setXWindow)({ start: newStart, end: newEnd });
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
    [scale, visibleStart, visibleEnd, plotW, priceH, height, count, notifyScrub],
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
          runOnJS(setXWindow)({ start: newStart, end: newEnd });

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
        Gesture.Race(doubleTapGesture, singleTapGesture, scrubGesture, manipulateGesture),
      ),
    [pinchGesture, doubleTapGesture, singleTapGesture, scrubGesture, manipulateGesture],
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
        {labelText && (
          <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '500' }}>{labelText}</Text>
        )}
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

              {/* ORB band — shaded box between ORH/ORL like the TradingView overlay */}
              {orbVisible && orbRange && (
                <>
                  <Rect
                    x={0}
                    y={scale.yForPrice(orbRange.high)}
                    width={plotW}
                    height={Math.max(0, scale.yForPrice(orbRange.low) - scale.yForPrice(orbRange.high))}
                    fill={colors.error}
                    opacity={0.08}
                  />
                  <Line
                    x1={0} x2={plotW}
                    y1={scale.yForPrice(orbRange.high)} y2={scale.yForPrice(orbRange.high)}
                    stroke={colors.success} strokeWidth={1.25}
                  />
                  <Line
                    x1={0} x2={plotW}
                    y1={scale.yForPrice(orbRange.low)} y2={scale.yForPrice(orbRange.low)}
                    stroke={colors.error} strokeWidth={1.25}
                  />
                  <Line
                    x1={0} x2={plotW}
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
              )}

              {/* Reference lines — e.g. entry/TP1/TP2/stop for a simulation
                  or live position. Dashed + left-anchored labels, distinct
                  from the ORB band's solid lines + right-anchored pills. */}
              {referenceLines?.map((line) => {
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

              {/* Price marks */}
              {mode === 'line' ? (
                <>
                  <Path d={areaPath} fill="url(#advPriceFill)" />
                  <Path d={linePath} stroke={lineColor} strokeWidth={2} fill="none" />
                </>
              ) : (
                visibleIndices.map((i) => {
                  const close = ePrices[i];
                  const open = data!.opens![i];
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
                  const up = hasOhlc ? ePrices[i] >= data!.opens![i] : i === 0 || ePrices[i] >= ePrices[i - 1];
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

              {/* Last/live price: dotted line + tag in the y-axis gutter */}
              {lastPrice != null && lastPrice >= scale.lo && lastPrice <= scale.hi && (
                <>
                  <Line
                    x1={0} x2={plotW}
                    y1={scale.yForPrice(lastPrice)} y2={scale.yForPrice(lastPrice)}
                    stroke={lastPriceColor} strokeWidth={1} strokeDasharray="2,3"
                  />
                  <Rect
                    x={plotW + 2} y={scale.yForPrice(lastPrice) - 9}
                    width={Y_AXIS_W - 4} height={18} rx={4} fill={lastPriceColor}
                  />
                  <SvgText
                    x={plotW + Y_AXIS_W / 2} y={scale.yForPrice(lastPrice) + 3.5}
                    fill="#FFFFFF" fontSize={10} fontWeight="700" textAnchor="middle"
                  >
                    {formatAxisPrice(lastPrice)}
                  </SvgText>
                  {/* Countdown to the next 5-min candle, just below the
                      last-price tag — clamped so it can't overflow past the
                      bottom of the chart when price sits near the low. */}
                  {candleCountdownLabel && (
                    <SvgText
                      x={plotW + Y_AXIS_W / 2}
                      y={Math.min(scale.yForPrice(lastPrice) + 20, volTop + VOL_H - 2)}
                      fill={colors.textTertiary} fontSize={9} fontWeight="600" textAnchor="middle"
                    >
                      {candleCountdownLabel}
                    </SvgText>
                  )}
                </>
              )}

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
                  {scale.xTicks.map((i) => (
                    <SvgText
                      key={`xlabel-${i}`}
                      x={scale.xForIndex(i)}
                      y={height - 6}
                      fill={colors.textTertiary}
                      fontSize={10}
                      fontWeight="500"
                      textAnchor="middle"
                    >
                      {formatXLabel(dates[i], period)}
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
                  {/* Time + volume pill on the x-axis */}
                  <Rect
                    x={Math.min(Math.max(scale.xForIndex(scrubIndex) - 34, 0), plotW - 68)}
                    y={height - X_AXIS_H + 2} width={68} height={30} rx={4} fill={colors.text}
                  />
                  <SvgText
                    x={Math.min(Math.max(scale.xForIndex(scrubIndex), 34), plotW - 34)}
                    y={height - X_AXIS_H + 13}
                    fill={colors.background} fontSize={9.5} fontWeight="600" textAnchor="middle"
                  >
                    {formatXLabel(dates[scrubIndex], period)}
                  </SvgText>
                  {volumes[scrubIndex] != null && (
                    <SvgText
                      x={Math.min(Math.max(scale.xForIndex(scrubIndex), 34), plotW - 34)}
                      y={height - X_AXIS_H + 25}
                      fill={colors.background} fontSize={8.5} fontWeight="500"
                      textAnchor="middle" opacity={0.8}
                    >
                      Vol {formatVolume(volumes[scrubIndex])}
                    </SvgText>
                  )}
                </>
              )}
            </Svg>
          </GestureDetector>
        )}
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
