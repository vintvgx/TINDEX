import type React from 'react';
import { Fragment, useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, LayoutChangeEvent } from 'react-native';
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
}

// ── Layout constants ─────────────────────────────────────────────────────
const Y_AXIS_W = 54; // right gutter for price labels
const X_AXIS_H = 20; // bottom row for time labels
const VOL_H = 44; // volume pane height
const PANE_GAP = 6; // gap between price pane and volume pane

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

  const plotW = Math.max(0, width - Y_AXIS_W);
  const priceH = Math.max(0, height - X_AXIS_H - VOL_H - PANE_GAP);
  const volTop = priceH + PANE_GAP;

  // ORB band only means anything on the trading day it was computed for.
  const orbVisible = !!(showOrbRange && orbRange && period === '1D');

  const scale = useMemo(() => {
    if (!hasData) return null;

    let min = hasOhlc ? Math.min(...eLows!) : Math.min(...ePrices);
    let max = hasOhlc ? Math.max(...eHighs!) : Math.max(...ePrices);
    // The y-domain must contain the ORB band even after a breakout has
    // carried price well away from it — seeing price relative to the range
    // is the whole point of the overlay.
    if (orbVisible && orbRange) {
      min = Math.min(min, orbRange.low);
      max = Math.max(max, orbRange.high);
    }
    const pad = (max - min) * 0.06 || 1;
    const lo = min - pad;
    const hi = max + pad;

    const step = plotW / ePrices.length;
    const xForIndex = (i: number) => (i + 0.5) * step;
    const yForPrice = (p: number) => priceH - ((p - lo) / (hi - lo)) * priceH;

    // Y ticks on round numbers within the padded domain.
    const tickStep = niceStep(hi - lo, 4);
    const yTicks: number[] = [];
    for (let t = Math.ceil(lo / tickStep) * tickStep; t <= hi; t += tickStep) yTicks.push(t);

    // ~4 evenly spaced x labels, snapped to data indices.
    const xTickCount = Math.min(4, ePrices.length);
    const xTicks: number[] = [];
    for (let k = 0; k < xTickCount; k++) {
      xTicks.push(Math.round(((k + 0.5) / xTickCount) * (ePrices.length - 1)));
    }

    const maxVolume = volumes.length ? Math.max(...volumes) : 0;

    return { lo, hi, step, xForIndex, yForPrice, yTicks, xTicks, maxVolume };
  }, [hasData, hasOhlc, ePrices, eHighs, eLows, volumes, plotW, priceH, orbVisible, orbRange]);

  // Line-mode path built from closes — the last point tracks the live tick.
  const { linePath, areaPath } = useMemo(() => {
    if (!scale || mode !== 'line') return { linePath: '', areaPath: '' };
    let p = '';
    ePrices.forEach((price, i) => {
      p += `${i === 0 ? 'M' : ' L'}${scale.xForIndex(i)},${scale.yForPrice(price)}`;
    });
    const area = `${p} L${scale.xForIndex(ePrices.length - 1)},${priceH} L${scale.xForIndex(0)},${priceH} Z`;
    return { linePath: p, areaPath: area };
  }, [scale, mode, ePrices, priceH]);

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

  const count = prices.length;
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(150)
        .onBegin((e) => {
          'worklet';
          if (count < 2 || plotW === 0) return;
          const step = plotW / count;
          const idx = Math.max(0, Math.min(count - 1, Math.floor(e.x / step)));
          scrubIndexShared.value = idx;
          runOnJS(triggerHaptic)();
          runOnJS(notifyScrub)(idx);
        })
        .onUpdate((e) => {
          'worklet';
          if (count < 2 || plotW === 0) return;
          const step = plotW / count;
          const idx = Math.max(0, Math.min(count - 1, Math.floor(e.x / step)));
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
    [count, plotW, notifyScrub, triggerHaptic],
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

  const candleW = scale ? Math.max(1, Math.min(scale.step * 0.65, 12)) : 0;

  return (
    <View>
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
        </View>
        {labelText && (
          <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '500' }}>{labelText}</Text>
        )}
      </View>

      <View onLayout={onLayout} style={{ height, width: '100%' }}>
        {isLoading || !hasData || !scale ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 16,
              backgroundColor: colors.surfaceSecondary,
            }}
          >
            {!isLoading && (
              <>
                <Ionicons name="bar-chart-outline" size={36} color={colors.textTertiary} />
                <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 8 }}>
                  No chart data available
                </Text>
              </>
            )}
          </View>
        ) : (
          <GestureDetector gesture={gesture}>
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

              {/* Faint vertical gridlines + x-axis time labels */}
              {scale.xTicks.map((i) => {
                const x = scale.xForIndex(i);
                return (
                  <Fragment key={`xtick-${i}`}>
                    <Line x1={x} x2={x} y1={0} y2={volTop + VOL_H} stroke={colors.textTertiary} strokeWidth={1} opacity={0.07} />
                    <SvgText
                      x={x}
                      y={height - 6}
                      fill={colors.textTertiary}
                      fontSize={10}
                      fontWeight="500"
                      textAnchor="middle"
                    >
                      {formatXLabel(dates[i], period)}
                    </SvgText>
                  </Fragment>
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

              {/* Price marks */}
              {mode === 'line' ? (
                <>
                  <Path d={areaPath} fill="url(#advPriceFill)" />
                  <Path d={linePath} stroke={lineColor} strokeWidth={2} fill="none" />
                </>
              ) : (
                ePrices.map((close, i) => {
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

              {/* Volume pane, bars colored by bar direction */}
              {scale.maxVolume > 0 &&
                volumes.map((v, i) => {
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
                  {/* Time pill on the x-axis */}
                  <Rect
                    x={Math.min(Math.max(scale.xForIndex(scrubIndex) - 34, 0), plotW - 68)}
                    y={height - X_AXIS_H} width={68} height={16} rx={4} fill={colors.text}
                  />
                  <SvgText
                    x={Math.min(Math.max(scale.xForIndex(scrubIndex), 34), plotW - 34)}
                    y={height - X_AXIS_H + 11.5}
                    fill={colors.background} fontSize={9.5} fontWeight="600" textAnchor="middle"
                  >
                    {formatXLabel(dates[scrubIndex], period)}
                  </SvgText>
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
    </View>
  );
};
