import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useThemeColors } from '@/lib/useColorScheme';
import { useSparkQuery } from '@/hooks/queries/ticker/useSparkQuery';
import { useUserORBFollows } from '@/hooks/mutations/ticker/tickerORB';
import { useChartDisplayPrefs } from '@/hooks/useChartDisplayPrefs';
import { ALLOWED_INTERVALS, DEFAULT_INTERVAL, INTERVAL_LABEL } from '@/lib/chartIntervals';
import { intervalCycleFor } from '@/common/components/ticker/TimeframeChips';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import { LinePriceChart } from '@/common/components/ticker/LinePriceChart';
import { openChartOverlay } from '@/common/components/ui/ChartOverlayContext';
import type { TickerInfo } from '../DynamicCard';

/**
 * Dynamic card "charts" view: one line chart per followed ticker — the
 * shared LinePriceChart (same chart as the ticker sheet): price/time axes,
 * current-price tag, long-press scrub, and expand → full chart. Timeframe comes
 * from Profile → Home chart timeframe (default 1D · 15m). On 1D the x-axis
 * always spans the full 9:30–4:00 session, so at the open the line starts
 * at the left edge and grows through the day (Robinhood-style). Swipe up/
 * down pages tickers; a "1/N" counter shows for 8s after each swipe.
 */

const FALLBACK_TICKERS = ['SPY', 'QQQ', 'IWM'];
const COUNTER_VISIBLE_MS = 8000;

function TickerPage({ ticker, height, width, period, interval, onStats }: {
  ticker: string; height: number; width: number; period: PricePeriod; interval: string;
  onStats: (ticker: string, price: number | null, changePct: number | null) => void;
}) {
  const colors = useThemeColors();
  const { data } = useSparkQuery(ticker, period, 60_000);
  const prices = data?.data?.closes ?? [];
  const dates = data?.data?.dates ?? [];

  const price = prices.length > 0 ? prices[prices.length - 1] : null;
  const changePct = prices.length > 1 ? ((prices[prices.length - 1] / prices[0]) - 1) * 100 : null;
  const up = (changePct ?? 0) >= 0;

  useEffect(() => {
    onStats(ticker, price, changePct);
  }, [ticker, price, changePct, onStats]);

  return (
    <View style={{ width, height, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 22 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <Text style={[styles.mono, { fontSize: 22, fontWeight: '800', color: colors.text }]}>{ticker}</Text>
        {price != null && (
          <Text style={[styles.mono, { fontSize: 20, color: colors.textSecondary }]}>${price.toFixed(2)}</Text>
        )}
        {changePct != null && (
          <View style={{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: (up ? colors.success : colors.error) + '1E' }}>
            <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: up ? colors.success : colors.error }]}>
              {up ? '+' : ''}{changePct.toFixed(2)}%
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary, marginTop: 2 }]}>
        {period} · {INTERVAL_LABEL[interval] ?? interval}
      </Text>
      <View style={{ flex: 1, justifyContent: 'center', marginTop: 8 }}>
        {prices.length > 0 ? (
          <LinePriceChart
            dates={dates}
            prices={prices}
            period={period}
            height={height - 96}
            positive={up}
            onExpand={() => openChartOverlay(ticker)}
          />
        ) : (
          <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center' }}>Loading chart…</Text>
        )}
      </View>
    </View>
  );
}

export function DynamicChartsView({ onActiveTicker, height }: {
  onActiveTicker: (info: TickerInfo) => void;
  height: number;
}) {
  const { width } = useWindowDimensions();
  const pageWidth = width - 28;
  const { data: follows } = useUserORBFollows();
  const { prefs } = useChartDisplayPrefs();
  const period = prefs.homeChartPeriod;
  const allowed = intervalCycleFor(ALLOWED_INTERVALS[period]);
  const interval = allowed.includes(prefs.homeChartInterval) ? prefs.homeChartInterval : DEFAULT_INTERVAL[period];

  const tickers = useMemo(() => {
    const list = (follows ?? []).map((f) => f.ticker.toUpperCase());
    return list.length > 0 ? list : FALLBACK_TICKERS;
  }, [follows]);
  const [active, setActive] = useState(0);
  const [stats, setStats] = useState<Record<string, { price: number | null; changePct: number | null }>>({});

  const onStats = useCallback((ticker: string, price: number | null, changePct: number | null) => {
    setStats((s) => {
      const prev = s[ticker];
      if (prev && prev.price === price && prev.changePct === changePct) return s;
      return { ...s, [ticker]: { price, changePct } };
    });
  }, []);

  const activeTicker = tickers[active] ?? '';
  useEffect(() => {
    const s = stats[activeTicker];
    onActiveTicker({ ticker: activeTicker, price: s?.price ?? null, changePct: s?.changePct ?? null });
  }, [activeTicker, stats, onActiveTicker]);

  // "1/N" counter — fades in on a swipe, out 8s after the last one.
  const counterOpacity = useSharedValue(0);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    counterOpacity.value = withTiming(1, { duration: 150 });
    counterOpacity.value = withDelay(COUNTER_VISIBLE_MS, withTiming(0, { duration: 400 }));
  }, [active, counterOpacity]);
  const counterStyle = useAnimatedStyle(() => ({ opacity: counterOpacity.value }));

  const onViewableChanged = useCallback(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setActive(i);
  }, []);

  const pageH = height - 28;
  return (
    <View style={{ width: pageWidth }}>
      <FlatList
        data={tickers}
        keyExtractor={(t) => t}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        style={{ height: pageH }}
        renderItem={({ item }) => (
          <TickerPage ticker={item} height={pageH} width={pageWidth} period={period} interval={interval} onStats={onStats} />
        )}
        onViewableItemsChanged={onViewableChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
      />
      {tickers.length > 1 && (
        <Animated.View pointerEvents="none" style={[styles.counter, counterStyle]}>
          <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', color: '#fff' }]}>
            {active + 1}/{tickers.length}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  counter: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
