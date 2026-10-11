import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useThemeColors } from '@/lib/useColorScheme';
import { useSparkQuery } from '@/hooks/queries/ticker/useSparkQuery';
import { useUserORBFollows } from '@/hooks/mutations/ticker/tickerORB';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import { useMorningBrief } from '@/hooks/queries/brief/useMorningBrief';
import { useKeyLevels } from '@/hooks/queries/priceLevels/useKeyLevels';
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
 * down pages tickers, endlessly in both directions (no first/last page);
 * a "1/N" counter shows for 8s after each swipe. The expand button at the
 * card's top right opens the current ticker in the full chart.
 *
 * Order: open positions (live, then paper) → today's morning-brief plays →
 * tickers with a watched zone → the rest of the followed list. Each ticker
 * appears once, at its highest tier.
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
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const pageWidth = width - 28;
  const { data: follows } = useUserORBFollows();
  const { prefs } = useChartDisplayPrefs();
  const period = prefs.homeChartPeriod;
  const allowed = intervalCycleFor(ALLOWED_INTERVALS[period]);
  const interval = allowed.includes(prefs.homeChartInterval) ? prefs.homeChartInterval : DEFAULT_INTERVAL[period];

  const allLive = useLivePositionsData('live');
  const allPaper = useLivePositionsData('paper');
  const { data: brief } = useMorningBrief();
  const { data: keyLevels } = useKeyLevels();
  const tickers = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (ts: Iterable<string>) => {
      for (const raw of ts) {
        const t = raw.toUpperCase();
        if (!seen.has(t)) { seen.add(t); out.push(t); }
      }
    };
    add(allLive.filteredPositions.map((p) => p.ticker).sort());
    add(allPaper.filteredPositions.map((p) => p.ticker).sort());
    add((brief?.plays ?? []).map((p) => p.ticker));
    add((keyLevels ?? [])
      .filter((l) => l.status === 'watching' || l.status === 'confirmed')
      .map((l) => l.ticker)
      .sort());
    add((follows ?? []).map((f) => f.ticker));
    return out.length > 0 ? out : FALLBACK_TICKERS;
  }, [allLive.filteredPositions, allPaper.filteredPositions, brief, keyLevels, follows]);

  // Tracked by ticker, not index, so a reorder (a position opens, the brief
  // lands) keeps you on the same chart.
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const n = tickers.length;
  const realIndex = Math.max(0, activeTicker ? tickers.indexOf(activeTicker) : 0);
  const current = tickers[realIndex] ?? '';
  const [stats, setStats] = useState<Record<string, { price: number | null; changePct: number | null }>>({});

  const onStats = useCallback((ticker: string, price: number | null, changePct: number | null) => {
    setStats((s) => {
      const prev = s[ticker];
      if (prev && prev.price === price && prev.changePct === changePct) return s;
      return { ...s, [ticker]: { price, changePct } };
    });
  }, []);

  useEffect(() => {
    const s = stats[current];
    onActiveTicker({ ticker: current, price: s?.price ?? null, changePct: s?.changePct ?? null });
  }, [current, stats, onActiveTicker]);

  // "1/N" counter — fades in on a swipe, out 8s after the last one.
  const counterOpacity = useSharedValue(0);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    counterOpacity.value = withTiming(1, { duration: 150 });
    counterOpacity.value = withDelay(COUNTER_VISIBLE_MS, withTiming(0, { duration: 400 }));
  }, [realIndex, counterOpacity]);
  const counterStyle = useAnimatedStyle(() => ({ opacity: counterOpacity.value }));

  // Endless paging: the list is rendered three times over and the scroll
  // position is kept in the middle copy — landing on a page in the first or
  // last copy jumps (without animation) to the same ticker in the middle,
  // so there's always another page above and below.
  const loop = n > 1;
  const data = useMemo(() => (loop ? [...tickers, ...tickers, ...tickers] : tickers), [loop, tickers]);
  const pageH = height - 28;
  const listRef = useRef<FlatList<string>>(null);
  const middleOffset = useCallback((i: number) => (loop ? (n + i) * pageH : i * pageH), [loop, n, pageH]);

  // A changed list (order/size) re-centres on the current ticker.
  const tickersKey = tickers.join(',');
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: middleOffset(realIndex), animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey, pageH]);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / pageH);
    const real = loop ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1);
    setActiveTicker(tickers[real]);
    if (loop && (i < n || i >= 2 * n)) {
      listRef.current?.scrollToOffset({ offset: middleOffset(real), animated: false });
    }
  }, [loop, n, pageH, tickers, middleOffset]);

  return (
    <View style={{ width: pageWidth }}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(t, i) => `${t}-${i}`}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        style={{ height: pageH }}
        renderItem={({ item }) => (
          <TickerPage ticker={item} height={pageH} width={pageWidth} period={period} interval={interval} onStats={onStats} />
        )}
        initialScrollIndex={loop ? n + realIndex : realIndex}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
      />
      {/* Full chart for the current ticker — the card's top-right corner,
          not inside the chart. */}
      <Pressable
        onPress={() => current && openChartOverlay(current)}
        hitSlop={10}
        accessibilityLabel={`Open ${current} in the full chart`}
        style={[styles.expand, { backgroundColor: colors.surfaceSecondary + 'E6' }]}
      >
        <Ionicons name="expand-outline" size={16} color={colors.textSecondary} />
      </Pressable>
      {n > 1 && (
        <Animated.View pointerEvents="none" style={[styles.counter, counterStyle]}>
          <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', color: '#fff' }]}>
            {realIndex + 1}/{n}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  expand: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    top: 14,
    right: 48,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
