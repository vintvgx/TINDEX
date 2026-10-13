import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet, AppState, useWindowDimensions } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useThemeColors } from '@/lib/useColorScheme';
import { useIsFocused } from '@react-navigation/native';
import { useSparkQuery, sparkNeedsRefresh } from '@/hooks/queries/ticker/useSparkQuery';
import { useMarketStream } from '@/hooks/useMarketStream';
import { isOptionsSessionOpen } from '@/lib/marketHours';
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
import { isSimId } from '@/lib/devSim/simPositions';

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
 *
 * Freshness: only the chart you're looking at stays live — it refetches as
 * you land on it (if its bars are >15s old), polls every 60s, and its last
 * point follows the live price stream during the session. Neighbor pages
 * load once so a swipe lands on a drawn chart. Nothing polls while the
 * charts page isn't the card's current view, Home isn't focused, or the app
 * is in the background. After the close, bars fetched since it are final —
 * no refetches until the next open. While the visible chart is fetching, a
 * small spinner shows left of the expand button (never over the chart).
 */

const FALLBACK_TICKERS = ['SPY', 'QQQ', 'IWM'];
const COUNTER_VISIBLE_MS = 8000;
const INTERVAL_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, wk: 7 * 86_400_000, mo: 31 * 86_400_000 };

function intervalMs(interval: string | undefined): number | null {
  const m = interval?.match(/^(\d+)(m|h|d|wk|mo)$/);
  return m ? Number(m[1]) * INTERVAL_MS[m[2]] : null;
}

/**
 * Spark bars → the plotted line, ending at "now".
 *
 * Intraday bars are stamped at their START but a close is the price at the
 * bar's END — so each close is plotted at start + interval, with the first
 * bar's open as the starting point. On 5m bars at 3:42 the points run
 * …3:35, 3:40, 3:42: the last one is the forming 3:40 bar, re-stamped to now
 * and taking the live price when streaming. Once a bar's window has passed,
 * the live price extends the line to now instead. Daily+ bars keep their
 * dates (index-spaced axis); only their last close follows the live price.
 */
function toLine(
  dates: string[], closes: number[], open: number | null | undefined,
  live: number | undefined, interval: string | undefined,
) {
  const n = Math.min(dates.length, closes.length);
  if (n === 0) return { dates: [] as string[], prices: [] as number[] };
  const span = intervalMs(interval);
  const now = Date.now();
  const hasLive = live != null && live > 0;

  if (span == null || span >= INTERVAL_MS.d) {
    const lastStart = new Date(dates[n - 1]).getTime();
    const prices = closes.slice(0, n);
    if (!hasLive) return { dates: dates.slice(0, n), prices };
    if (span != null && now < lastStart + span) return { dates: dates.slice(0, n), prices: [...prices.slice(0, -1), live] };
    return { dates: [...dates.slice(0, n), new Date(now).toISOString()], prices: [...prices, live] };
  }

  const ends = dates.slice(0, n).map((d) => new Date(d).getTime() + span);
  const prices = closes.slice(0, n);
  if (ends[n - 1] > now) {
    ends[n - 1] = now;
    if (hasLive) prices[n - 1] = live;
  } else if (hasLive) {
    ends.push(now);
    prices.push(live);
  }
  if (open != null && open > 0) {
    ends.unshift(new Date(dates[0]).getTime());
    prices.unshift(open);
  }
  return { dates: ends.map((t) => new Date(t).toISOString()), prices };
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}
/** Last ticker shown — survives this page unmounting (see activeTicker). */
let lastActiveTicker: string | null = null;

/** The minimized Home card steps the deck's ticker with an up/down swipe —
 *  the mounted deck registers here (see DynamicCard's collapsed strip). */
let stepListener: ((dir: 1 | -1) => void) | null = null;
export function stepChartsTicker(dir: 1 | -1): void {
  stepListener?.(dir);
}

function TickerPage({ ticker, height, width, period, interval, active, livePrice, onStats }: {
  ticker: string; height: number; width: number; period: PricePeriod; interval: string;
  /** The chart you're looking at — the only one that polls. */
  active: boolean;
  /** Streamed price for this ticker (active page, regular session only). */
  livePrice?: number;
  onStats: (ticker: string, price: number | null, changePct: number | null) => void;
}) {
  const colors = useThemeColors();
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useSparkQuery(ticker, period, { interval, active });
  const stale = !!data?.stale;

  // Landing on a chart (swipe, or the card coming back into view): catch up
  // if its bars are out of date (sparkNeedsRefresh — never after the close
  // once they've been fetched since it). A first load fetches anyway.
  useEffect(() => {
    if (active && dataUpdatedAt > 0 && sparkNeedsRefresh(dataUpdatedAt)) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // A stale copy may be a different session's bars — no live tail on it.
  const series = useMemo(
    () => toLine(data?.data?.dates ?? [], data?.data?.closes ?? [], data?.data?.open,
      stale ? undefined : livePrice, data?.data?.interval),
    [data, stale, livePrice],
  );
  const { prices, dates } = series;

  const price = prices.length > 0 ? prices[prices.length - 1] : null;
  const changePct = prices.length > 1 ? ((prices[prices.length - 1] / prices[0]) - 1) * 100 : null;
  const up = (changePct ?? 0) >= 0;

  useEffect(() => {
    onStats(ticker, price, changePct);
  }, [ticker, price, changePct, onStats]);

  return (
    <View style={{ width, height, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 22 }}>
      {active && isFetching && (
        <View pointerEvents="none" style={styles.fetching}>
          <ActivityIndicator size="small" color={colors.textTertiary} />
        </View>
      )}
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
        <LinePriceChart
          dates={dates}
          prices={prices}
          period={period}
          height={height - 96}
          isLoading={isLoading}
          positive={up}
        />
      </View>
    </View>
  );
}

export function DynamicChartsView({ onActiveTicker, height, visible = true }: {
  onActiveTicker: (info: TickerInfo) => void;
  height: number;
  /** The card's current view (expanded or collapsed) — off-screen as a
   *  pager neighbor, nothing polls or streams. */
  visible?: boolean;
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
    // Dev sim positions don't add chart pages (they'd fetch real charts).
    add(allLive.filteredPositions.filter((p) => !isSimId(p.strategy_id)).map((p) => p.ticker).sort());
    add(allPaper.filteredPositions.filter((p) => !isSimId(p.strategy_id)).map((p) => p.ticker).sort());
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
  // Seeded from the last one shown: the Home pager unmounts this page when
  // you swipe two pages away (A0), and coming back should land on the same
  // chart, not the first.
  const [activeTicker, setActiveTickerState] = useState<string | null>(() => lastActiveTicker);
  const setActiveTicker = useCallback((t: string | null) => {
    lastActiveTicker = t;
    setActiveTickerState(t);
  }, []);
  const n = tickers.length;
  const realIndex = Math.max(0, activeTicker ? tickers.indexOf(activeTicker) : 0);
  const current = tickers[realIndex] ?? '';
  const focused = useIsFocused();
  const appActive = useAppActive();
  const live = visible && focused && appActive;
  const { livePrices, connected } = useMarketStream(current ? [current] : [], {
    enabled: live && !!current && isOptionsSessionOpen(),
  });
  const livePrice = live && connected && isOptionsSessionOpen() ? livePrices[current] : undefined;

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
  }, [loop, n, pageH, tickers, middleOffset, setActiveTicker]);

  // Collapsed-card swipe → next / previous ticker, and keep the (hidden)
  // deck scrolled to it so expanding shows the same chart.
  const stepRef = useRef<(dir: 1 | -1) => void>(() => {});
  stepRef.current = (dir) => {
    if (n < 2) return;
    const next = (((realIndex + dir) % n) + n) % n;
    setActiveTicker(tickers[next]);
    listRef.current?.scrollToOffset({ offset: middleOffset(next), animated: false });
  };
  useEffect(() => {
    const fn = (dir: 1 | -1) => stepRef.current(dir);
    stepListener = fn;
    return () => { if (stepListener === fn) stepListener = null; };
  }, []);

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
          <TickerPage
            ticker={item}
            height={pageH}
            width={pageWidth}
            period={period}
            interval={interval}
            active={live && item === current}
            livePrice={item === current ? livePrice : undefined}
            onStats={onStats}
          />
        )}
        // Re-render the mounted pages when the active ticker / live price moves.
        extraData={`${current}|${live}|${livePrice ?? ''}`}
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
  /** Left of the expand button (top 10, right 10, 30×30). */
  fetching: {
    position: 'absolute',
    top: 10,
    right: 44,
    height: 30,
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    top: 14,
    right: 74,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
