import React, { useMemo, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, useAppColorScheme } from '@/lib/useColorScheme';
import { useChartDisplayPrefs } from '@/hooks/useChartDisplayPrefs';
import { useSparkQuery } from '@/hooks/queries/ticker/useSparkQuery';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useChartTechnicals } from '@/common/components/ticker/ChartTechnicals';
import { resolveLens, isEnterTier, fmtScore, tierMeta } from '@/common/components/ticker/compositeMeta';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { Glass } from '@/common/components/ui/WheelTabBar';
import { useChartOverlay } from '@/common/components/ui/ChartOverlayContext';

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

export interface TickerCardRect { x: number; y: number; width: number; height: number }

/** Window rect of the card at the last tap (`.current`) — the chart
 *  overlay's expand animation starts from here (0.8 chart transition). */
export const lastTickerCardRect: { current: TickerCardRect | null } = { current: null };

const SPARK_W = 64;
const SPARK_H = 30;
const SPARK_PAD = 3;

function sparkPath(closes: number[]): string | null {
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
  return closes
    .map((c, i) => {
      const x = SPARK_PAD + (i / (closes.length - 1)) * w;
      const y = SPARK_PAD + (1 - (c - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function TickerCard({ onLayout }: { onLayout?: (height: number) => void }) {
  const colors = useThemeColors();
  const { isDarkColorScheme: isDark } = useAppColorScheme();
  const { prefs } = useChartDisplayPrefs();
  const ticker = (prefs.lastChartTicker ?? 'SPY').toUpperCase();
  const { openChart } = useChartOverlay();
  const ref = useRef<View>(null);

  const { data: spark } = useSparkQuery(ticker, '1D', { interval: '5m' });
  const rawCloses = spark?.data?.closes;
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
  const technicals = useChartTechnicals(ticker, true);
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

  const onPress = () => {
    const node = ref.current;
    if (node) {
      node.measureInWindow((x, y, width, height) => {
        lastTickerCardRect.current = { x, y, width, height };
      });
    }
    openChart(ticker);
  };

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
      accessibilityRole="button"
      accessibilityLabel={`Expand ${ticker} chart`}
      style={({ pressed }) => [styles.card, styles.shadow, pressed && { transform: [{ scale: 0.985 }] }]}
    >
      <Glass radius={20} isDark={isDark} />
      <TickerLogo
        uri={`https://financialmodelingprep.com/image-stock/${ticker}.png`}
        ticker={ticker}
        size={34}
        borderRadius={10}
      />
      <View style={styles.main}>
        <View style={styles.row}>
          <Text style={[styles.sym, { color: colors.text }]}>{ticker}</Text>
          {price != null && (
            <Text style={[styles.px, { color: colors.text }]}>{price.toFixed(2)}</Text>
          )}
        </View>
        <View style={[styles.row, { marginTop: 2 }]}>
          {changePct != null && (
            <Text style={[styles.pct, { color: changeColor }]}>
              {up ? '+' : ''}{changePct.toFixed(2)}% today
            </Text>
          )}
          {signal && (
            <View style={[styles.sigPill, { backgroundColor: signal.color + '22', borderColor: signal.color }]}>
              <Text style={[styles.sigText, { color: signal.color }]} numberOfLines={1}>{signal.text}</Text>
            </View>
          )}
        </View>
      </View>
      <Svg width={SPARK_W} height={SPARK_H}>
        {path && (
          <Path d={path} stroke={changeColor} strokeWidth={1.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        )}
      </Svg>
      <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  main: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sym: { fontSize: 15, fontWeight: '700' },
  px: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pct: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sigPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9,
    borderWidth: 1,
    flexShrink: 1,
  },
  sigText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
});
