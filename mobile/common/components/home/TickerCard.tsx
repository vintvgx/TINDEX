import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useThemeColors, useAppColorScheme } from '@/lib/useColorScheme';
import { useChartDisplayPrefs } from '@/hooks/useChartDisplayPrefs';
import { useSparkQuery } from '@/hooks/queries/ticker/useSparkQuery';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useChartTechnicals } from '@/common/components/ticker/ChartTechnicals';
import { resolveLens, isEnterTier, fmtScore, tierMeta } from '@/common/components/ticker/compositeMeta';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { isMarketHours } from '@/lib/marketHours';
import { Glass } from '@/common/components/ui/WheelTabBar';
import {
  useChartOverlay,
  lastTickerCardRect,
  chartOverlayRendered,
  type ChartOriginRect,
} from '@/common/components/ui/ChartOverlayContext';

/**
 * 0.8 ticker card — floats above the TabNavBar pill (spec §3.2). Shows the
 * last ticker opened in the chart (SPY on a fresh install): logo, price,
 * day %, the signal pill when an enterable verdict is live, a 5m sparkline
 * of today's closes and a chevron-up. Tap → the full-screen chart.
 *
 * The tape context is empty while the chart is closed, so the card reads its
 * own data: the spark query (same day-% math as the Home deck's
 * DynamicChartsView), the market stream for the live price, and the chart's
 * own technicals query (shared react-query cache key — no new endpoint).
 */

export type TickerCardRect = ChartOriginRect;

/** Window rect of the card at the last tap (`.current`) — the chart
 *  overlay's expand animation starts from here (0.8 chart transition).
 *  Defined in ChartOverlayContext (avoids an import cycle). */
export { lastTickerCardRect };

const SPARK_W = 64;
const SPARK_H = 30;
const SPARK_PAD = 3;

function sparkPath(closes: number[]): { d: string; end: { x: number; y: number } } | null {
  if (closes.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const c of closes) {
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const span = max - min || 1;
  const w = SPARK_W - SPARK_PAD * 2;
  const h = SPARK_H - SPARK_PAD * 2;
  const pts = closes.map((c, i) => ({
    x: SPARK_PAD + (i / (closes.length - 1)) * w,
    y: SPARK_PAD + (1 - (c - min) / span) * h,
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return { d, end: pts[pts.length - 1] };
}

export function TickerCard({ onLayout, layoutKey }: {
  onLayout?: (height: number) => void;
  /** Changes when the parent (TabNavBar) moves the card without the card's
   *  own frame changing — floating vs in-flow screens — so it re-measures. */
  layoutKey?: string | number | boolean;
}) {
  const colors = useThemeColors();
  const { isDarkColorScheme: isDark } = useAppColorScheme();
  const { prefs, loaded: prefsLoaded } = useChartDisplayPrefs();
  const ticker = (prefs.lastChartTicker ?? 'SPY').toUpperCase();
  const { openChart } = useChartOverlay();
  const ref = useRef<View>(null);

  const { data: spark, isPlaceholderData } = useSparkQuery(ticker, '1D', { interval: '5m' });
  // keepPreviousData hands back the PREVIOUS ticker's history while this
  // ticker's loads — never label it as this ticker.
  const rawCloses = isPlaceholderData ? undefined : spark?.data?.closes;
  const closes = useMemo(() => rawCloses ?? [], [rawCloses]);
  const { livePrices } = useMarketStream([ticker]);
  const live = livePrices[ticker];
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
  const price = live ?? lastClose;
  // Same math as DynamicChartsView (last / first − 1), with the live price
  // as "last" when the stream has one.
  const changePct = price != null && closes.length > 1 ? (price / closes[0] - 1) * 100 : null;
  const up = (changePct ?? 0) >= 0;
  const changeColor = up ? colors.success : colors.error;

  // The chart's technicals query (same key → shared cache with charts.tsx).
  // Market hours only: the card is mounted on every tab all session, and each
  // run re-runs the gate (1m bars + 2y dailies) on a 60s poll.
  const technicals = useChartTechnicals(ticker, isMarketHours());
  const signal = useMemo(() => {
    const v = resolveLens(technicals.data);
    if (!v || !v.comp || (v.side !== 'CALL' && v.side !== 'PUT')) return null;
    if (!isEnterTier(v.comp.tier)) return null; // WAIT — no live verdict
    return {
      text: `${v.side} ${fmtScore(v.comp.total)} ${tierMeta(v.comp.tier, colors).short}`,
      color: v.side === 'CALL' ? colors.success : colors.error,
    };
  }, [technicals.data, colors]);

  const path = useMemo(() => sparkPath(closes), [closes]);

  // Before prefs load the card shows the SPY default — open with no ticker
  // so charts.tsx restores the saved one instead of overwriting it with SPY.
  const openTicker = prefsLoaded ? ticker : null;

  /** Record the card's window rect — only while the chart is neither open
   *  nor animating (`chartOverlayRendered`): then Home is scaled, so the
   *  measurement would be transformed. */
  const measure = (then?: (rect: ChartOriginRect | null) => void) => {
    const node = ref.current;
    if (!node || chartOverlayRendered.current) {
      then?.(lastTickerCardRect.current);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      if (chartOverlayRendered.current) {
        then?.(lastTickerCardRect.current);
        return;
      }
      const rect = { x, y, width, height };
      lastTickerCardRect.current = rect;
      then?.(rect);
    });
  };

  // The rect is kept fresh from layout (onLayout + layoutKey below), so a tap
  // opens synchronously from it — no async measure on the press path. Only
  // before the first measurement lands: measure, then open in the callback.
  // Mid-collapse taps also land here and reuse the last (unscaled) rect.
  const onPress = () => {
    const rect = lastTickerCardRect.current;
    if (rect) openChart(openTicker, rect);
    else measure((r) => openChart(openTicker, r));
  };

  // Parent re-layout that doesn't change the card's own frame: re-measure
  // once it has settled.
  useEffect(() => {
    if (layoutKey === undefined) return;
    const raf = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(raf);
  }, [layoutKey]);

  // Press feedback on an inner Animated.View — never a Pressable style
  // function: NativeWind's css-interop (0.1.22) treats a function `style` as
  // an inline style object, spreads it to `{}`, and that `{}` replaces the
  // function — the card lost every style and stacked as a column.
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onPressIn={() => { scale.value = withTiming(0.985, { duration: 90 }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration: 140 }); }}
      onLayout={(e) => {
        onLayout?.(e.nativeEvent.layout.height);
        // Keep the rect fresh so openChartOverlay() callers (ticker sheet,
        // deck, digest) expand from the real card, not the fallback box.
        measure();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Expand ${ticker} chart`}
      style={styles.shadow}
    >
      <Animated.View style={[styles.card, pressStyle]}>
        <Glass radius={20} isDark={isDark} />
        <TickerLogo
          uri={`https://financialmodelingprep.com/image-stock/${ticker}.png`}
          ticker={ticker}
          size={34}
          borderRadius={17}
        />
        <View style={styles.main}>
          <View style={styles.line1}>
            <Text style={[styles.sym, { color: colors.text }]} numberOfLines={1}>{ticker}</Text>
            {price != null && (
              <Text style={[styles.px, { color: colors.text }]} numberOfLines={1}>{price.toFixed(2)}</Text>
            )}
          </View>
          <View style={styles.line2}>
            {changePct != null && (
              <Text style={[styles.pct, { color: changeColor }]} numberOfLines={1}>
                {up ? '+' : ''}{changePct.toFixed(2)}% today
              </Text>
            )}
            {signal && (
              <View style={[styles.sigPill, { backgroundColor: signal.color + '26' }]}>
                <Text style={[styles.sigText, { color: signal.color }]} numberOfLines={1}>{signal.text}</Text>
              </View>
            )}
          </View>
        </View>
        <Svg width={SPARK_W} height={SPARK_H} style={styles.spark}>
          {path && (
            <>
              <Path d={path.d} stroke={changeColor} strokeWidth={1.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              <Circle cx={path.end.x} cy={path.end.y} r={2.4} fill={changeColor} />
            </>
          )}
        </Svg>
        <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Outer Pressable: static style only (see pressStyle above).
  shadow: {
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  // Inner row — ~56pt tall: 34 logo / two text lines + 2×10 padding.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  main: { flex: 1, minWidth: 0, gap: 1 },
  line1: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  line2: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sym: { fontSize: 15, fontWeight: '700' },
  px: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pct: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sigPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    flexShrink: 1,
  },
  sigText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  spark: { marginLeft: 'auto' },
});
