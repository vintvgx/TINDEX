import type React from 'react';
import { useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, LayoutChangeEvent } from 'react-native';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useDerivedValue,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { PricePeriod, TickerHistoryData } from '@/common/types/blogPosts/ticker';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

const PERIODS: PricePeriod[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y'];

export interface ScrubPoint {
  price: number;
  date: string;
  index: number;
}

export interface OrbRangeLines {
  high: number;
  low: number;
}

interface PriceChartProps {
  data: TickerHistoryData | undefined;
  isLoading?: boolean;
  period: PricePeriod;
  onPeriodChange: (period: PricePeriod) => void;
  /** Whether the *unscrubbed* period's price is up or down — drives line/fill color. */
  positive: boolean;
  onScrub?: (point: ScrubPoint | null) => void;
  height?: number;
  /** Today's Opening Range high/low, when available for this ticker. */
  orbRange?: OrbRangeLines | null;
  /** Draws orbRange as two reference lines and expands the y-axis to fit them. No-op if orbRange is null. */
  showOrbRange?: boolean;
}

const DOT_GRID_COLS = 14;
const DOT_GRID_ROWS = 7;

/** Plain date shown when nothing is being scrubbed, e.g. "Jul 19". */
const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Period-aware label shown while scrubbing — adds time for short ranges, year for long ones. */
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

export const PriceChart: React.FC<PriceChartProps> = ({
  data,
  isLoading,
  period,
  onPeriodChange,
  positive,
  onScrub,
  height = 200,
  orbRange,
  showOrbRange,
}) => {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const lineColor = positive ? colors.success : colors.error;

  const prices = useMemo(() => data?.prices ?? [], [data]);
  const dates = useMemo(() => data?.dates ?? [], [data]);
  const hasData = prices.length > 1 && width > 0;

  const { path, areaPath, minPrice, maxPrice } = useMemo(() => {
    if (!hasData) return { path: '', areaPath: '', minPrice: 0, maxPrice: 0 };

    let min = Math.min(...prices);
    let max = Math.max(...prices);
    // When the ORB overlay is on, the y-axis has to fit the ORB band too —
    // otherwise a post-breakout price that's moved well outside the range
    // would push one of the two reference lines off-canvas, exactly when
    // seeing where price sits relative to the range matters most.
    if (showOrbRange && orbRange) {
      min = Math.min(min, orbRange.low);
      max = Math.max(max, orbRange.high);
    }
    // Pad the range 8% so the line doesn't touch the top/bottom edges.
    const padding = (max - min) * 0.08 || 1;
    const paddedMin = min - padding;
    const paddedMax = max + padding;

    const xForIndex = (i: number) => (i / (prices.length - 1)) * width;
    const yForPrice = (p: number) =>
      height - ((p - paddedMin) / (paddedMax - paddedMin)) * height;

    let linePath = '';
    prices.forEach((p, i) => {
      const x = xForIndex(i);
      const y = yForPrice(p);
      linePath += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
    });

    const area = `${linePath} L${width},${height} L0,${height} Z`;

    return { path: linePath, areaPath: area, minPrice: paddedMin, maxPrice: paddedMax };
  }, [hasData, prices, width, height, showOrbRange, orbRange]);

  const yForPrice = (p: number) =>
    maxPrice === minPrice ? height / 2 : height - ((p - minPrice) / (maxPrice - minPrice)) * height;

  // ── Scrub gesture ──────────────────────────────────────────────────────
  // touchIndex: -1 means "not scrubbing". Snaps continuous touch X to the
  // nearest data-point index so the marker always lands exactly on the line.
  const touchIndex = useSharedValue(-1);
  // Mirrors touchIndex on the JS thread, purely so the date label (below)
  // can re-render in place — the fixed-height row it lives in never toggles
  // presence, so the chart above it never reflows while scrubbing.
  const [scrubbed, setScrubbed] = useState<ScrubPoint | null>(null);

  const notifyScrub = useCallback(
    (index: number) => {
      if (index === -1 || !data) {
        setScrubbed(null);
        onScrub?.(null);
        return;
      }
      const point = { price: data.prices[index], date: data.dates[index], index };
      setScrubbed(point);
      onScrub?.(point);
    },
    [data, onScrub],
  );

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const indexFromX = (x: number, count: number, chartWidth: number) => {
    'worklet';
    const clamped = Math.max(0, Math.min(x, chartWidth));
    return Math.round((clamped / chartWidth) * (count - 1));
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(150)
        .onBegin((e) => {
          'worklet';
          if (prices.length < 2 || width === 0) return;
          touchIndex.value = indexFromX(e.x, prices.length, width);
          runOnJS(triggerHaptic)();
          runOnJS(notifyScrub)(touchIndex.value);
        })
        .onUpdate((e) => {
          'worklet';
          if (prices.length < 2 || width === 0) return;
          const next = indexFromX(e.x, prices.length, width);
          if (next !== touchIndex.value) {
            touchIndex.value = next;
            runOnJS(notifyScrub)(next);
          }
        })
        .onFinalize(() => {
          'worklet';
          touchIndex.value = -1;
          runOnJS(notifyScrub)(-1);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prices.length, width, notifyScrub, triggerHaptic],
  );

  const markerX = useDerivedValue(() => {
    if (touchIndex.value === -1 || prices.length < 2) return 0;
    return (touchIndex.value / (prices.length - 1)) * width;
  }, [prices.length, width]);

  const markerY = useDerivedValue(() => {
    if (touchIndex.value === -1 || prices.length < 2 || maxPrice === minPrice) return 0;
    const p = prices[touchIndex.value] ?? 0;
    return height - ((p - minPrice) / (maxPrice - minPrice)) * height;
  }, [prices, minPrice, maxPrice, height]);

  const circleProps = useAnimatedProps(() => ({
    cx: markerX.value,
    cy: markerY.value,
    opacity: touchIndex.value === -1 ? 0 : 1,
  }));

  const lineProps = useAnimatedProps(() => ({
    x1: markerX.value,
    x2: markerX.value,
    opacity: touchIndex.value === -1 ? 0 : 1,
  }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const labelText = scrubbed
    ? formatScrubLabel(scrubbed.date, period)
    : dates.length
      ? formatDate(dates[dates.length - 1])
      : null;

  return (
    <View>
      {/* Fixed-height slot: content changes while scrubbing, but the row
          never appears/disappears, so the chart below it never shifts. */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', height: 16, marginBottom: 6 }}>
        {labelText && (
          <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '500' }}>{labelText}</Text>
        )}
      </View>

      <View onLayout={onLayout} style={{ height, width: '100%' }}>
        {isLoading || !hasData ? (
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
                <LinearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={lineColor} stopOpacity={0.35} />
                  <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
                </LinearGradient>
              </Defs>

              {/* Faint dotted background grid */}
              {Array.from({ length: DOT_GRID_ROWS }).map((_, row) =>
                Array.from({ length: DOT_GRID_COLS }).map((_, col) => (
                  <Circle
                    key={`dot-${row}-${col}`}
                    cx={((col + 0.5) / DOT_GRID_COLS) * width}
                    cy={((row + 0.5) / DOT_GRID_ROWS) * height}
                    r={1}
                    fill={colors.textTertiary}
                    opacity={0.25}
                  />
                )),
              )}

              <Path d={areaPath} fill="url(#priceFill)" />
              <Path d={path} stroke={lineColor} strokeWidth={2} fill="none" />

              {showOrbRange && orbRange && (
                <>
                  <Line
                    x1={0} x2={width}
                    y1={yForPrice(orbRange.high)} y2={yForPrice(orbRange.high)}
                    stroke={colors.success}
                    strokeWidth={1.5}
                    strokeDasharray="6,4"
                  />
                  <SvgText
                    x={4} y={yForPrice(orbRange.high) - 4}
                    fill={colors.success} fontSize={11} fontWeight="700"
                  >
                    ORB Hi ${orbRange.high.toFixed(2)}
                  </SvgText>
                  <Line
                    x1={0} x2={width}
                    y1={yForPrice(orbRange.low)} y2={yForPrice(orbRange.low)}
                    stroke={colors.error}
                    strokeWidth={1.5}
                    strokeDasharray="6,4"
                  />
                  <SvgText
                    x={4} y={yForPrice(orbRange.low) + 14}
                    fill={colors.error} fontSize={11} fontWeight="700"
                  >
                    ORB Lo ${orbRange.low.toFixed(2)}
                  </SvgText>
                </>
              )}

              <AnimatedLine
                animatedProps={lineProps}
                y1={0}
                y2={height}
                stroke={colors.textSecondary}
                strokeWidth={1}
                strokeDasharray="4,4"
              />
              <AnimatedCircle
                animatedProps={circleProps}
                r={5}
                fill={lineColor}
                stroke={colors.background}
                strokeWidth={2}
              />
            </Svg>
          </GestureDetector>
        )}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
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
