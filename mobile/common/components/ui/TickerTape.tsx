/**
 * TickerTape — thin dark auto-scrolling market strip pinned to the very top of
 * the app, above the AppHeader (CollectPure-style).
 *
 * Tap anywhere on the tape to cycle the data source:
 *   Market Stream → Trending → Gainers → Losers → Active → (loop)
 *
 * On each tap the current marquee fades out, the new mode's title fades in at the
 * center, then — once that mode's data is ready — the title fades out and the new
 * marquee fades in. "Market Stream" is the live websocket feed; the rest come
 * from the Yahoo watchlists endpoint.
 *
 * Coloring:
 *   • Market Stream — a ticker's price is green above its ORB high, red below its
 *     ORB low, and the default color while inside the range or outside market
 *     hours (no ORB levels set).
 *   • Movers modes — price colored green/red by the day's percent change.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useWatchlists } from '@/hooks/queries/watchlist/useWatchlist';
import { useORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import type { WatchlistStock } from '@/common/types/watchlist';

// Live-stream symbols (SPY arrives on its own field; the rest via livePrices).
const STREAM_TICKERS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN'];
const SCROLL_SPEED_PX_PER_SEC = 45;

type ModeKey = 'stream' | 'trending' | 'gainers' | 'losers' | 'most_active';
const MODES: { key: ModeKey; label: string }[] = [
  { key: 'stream', label: 'Market Stream' },
  { key: 'trending', label: 'Trending' },
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
  { key: 'most_active', label: 'Active' },
];

interface TapeItem {
  symbol: string;
  value: string;
  valueColor?: string;
}

const fmtPct = (c: number | null | undefined): string => {
  if (c == null) return '';
  return c >= 0 ? `+${c.toFixed(2)}%` : `${c.toFixed(2)}%`;
};

function TapeRow({
  items,
  onWidth,
  colors,
}: {
  items: TapeItem[];
  onWidth?: (w: number) => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View
      style={styles.row}
      onLayout={onWidth ? e => onWidth(e.nativeEvent.layout.width) : undefined}
    >
      {items.map((item, i) => (
        <View key={`${item.symbol}-${i}`} style={styles.item}>
          <Text style={[styles.symbol, { color: colors.tapeText }]}>${item.symbol}</Text>
          <Text style={[styles.value, { color: item.valueColor ?? colors.tapeText }]}>
            {item.value}
          </Text>
          <Text style={[styles.dot, { color: colors.tapeMuted }]}>•</Text>
        </View>
      ))}
    </View>
  );
}

export function TickerTape() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const [modeIndex, setModeIndex] = useState(0);
  const mode = MODES[modeIndex];

  // ── Data sources ──────────────────────────────────────────────────────────
  const { livePrices, spy, vix, sentiment, connected } = useMarketStream(STREAM_TICKERS);
  const { data: watchlists, isLoading: watchlistsLoading } = useWatchlists();
  const { data: orbData } = useORBMonitoringState(false, false);

  const orbMap = useMemo(() => {
    const m = new Map<string, { high: number | null; low: number | null }>();
    for (const item of (orbData ?? [])) {
      m.set(item.ticker, { high: item.orb_high ?? null, low: item.orb_low ?? null });
    }
    return m;
  }, [orbData]);

  const streamColor = (ticker: string, price: number | null): string => {
    const orb = orbMap.get(ticker);
    if (!orb || price == null || (orb.high == null && orb.low == null)) return colors.tapeText;
    if (orb.high != null && price > orb.high) return colors.tapeUp;
    if (orb.low != null && price < orb.low) return colors.tapeDown;
    return colors.tapeText; // inside range — leave as-is
  };

  // Items for the active mode.
  const items = useMemo<TapeItem[]>(() => {
    if (mode.key === 'stream') {
      const out: TapeItem[] = [];
      if (vix != null) out.push({ symbol: 'VIX', value: vix.toFixed(2), valueColor: colors.tapeMuted });
      for (const sym of STREAM_TICKERS) {
        const price = sym === 'SPY' ? spy : livePrices[sym];
        if (price != null) out.push({ symbol: sym, value: `$${price.toFixed(2)}`, valueColor: streamColor(sym, price) });
      }
      if (sentiment?.label) out.push({ symbol: 'MOOD', value: sentiment.label, valueColor: colors.tapeMuted });
      return out;
    }
    const list: WatchlistStock[] = (watchlists?.watchlists?.[mode.key]?.data as WatchlistStock[]) ?? [];
    return list.map(s => {
      const chg = s.change_percent ?? s.change ?? null;
      const color = chg == null ? colors.tapeText : chg >= 0 ? colors.tapeUp : colors.tapeDown;
      const price = s.price != null ? `$${s.price.toFixed(2)}` : '—';
      const pct = fmtPct(chg);
      return { symbol: s.ticker, value: pct ? `${price} ${pct}` : price, valueColor: color };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.key, livePrices, spy, vix, sentiment, watchlists, orbMap, colors]);

  const currentLoading = mode.key !== 'stream'
    && (watchlistsLoading || ((watchlists?.watchlists?.[mode.key]?.data?.length ?? 0) === 0));

  // Placeholder so the tape is never empty.
  const display = items.length > 0
    ? items
    : STREAM_TICKERS.map(s => ({ symbol: s, value: '—' as string }));

  // ── Marquee scroll ──────────────────────────────────────────────────────────
  const translateX = useRef(new Animated.Value(0)).current;
  const [rowWidth, setRowWidth] = useState(0);

  useEffect(() => {
    if (rowWidth <= 0) return;
    translateX.setValue(0);
    const duration = (rowWidth / SCROLL_SPEED_PX_PER_SEC) * 1000;
    const anim = Animated.loop(
      Animated.timing(translateX, {
        toValue: -rowWidth,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [rowWidth, translateX]);

  const handleWidth = (w: number) => {
    // Ignore sub-pixel jitter from live price digit changes to avoid scroll resets.
    setRowWidth(prev => (Math.abs(prev - w) > 2 ? w : prev));
  };

  // ── Mode-switch transition ───────────────────────────────────────────────────
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const [titleText, setTitleText] = useState('');
  const [awaitingReveal, setAwaitingReveal] = useState(false);
  const [forceReveal, setForceReveal] = useState(false);
  const transitioningRef = useRef(false);
  const maxWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cycle = () => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    const next = (modeIndex + 1) % MODES.length;
    setTitleText(MODES[next].label);
    setForceReveal(false);
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(titleOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => {
      setModeIndex(next);       // swap data while the marquee is hidden
      setAwaitingReveal(true);
      // Safety: reveal even if the data never finishes loading.
      maxWaitRef.current = setTimeout(() => setForceReveal(true), 2500);
    });
  };

  // Reveal the new marquee once its data is ready (or after the safety timeout).
  useEffect(() => {
    if (!awaitingReveal) return;
    if (currentLoading && !forceReveal) return;
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 0, duration: 240, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(contentOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start(() => {
        setAwaitingReveal(false);
        transitioningRef.current = false;
      });
    }, 280); // hold the title briefly so it reads
    return () => clearTimeout(t);
  }, [awaitingReveal, currentLoading, forceReveal, titleOpacity, contentOpacity]);

  useEffect(() => () => { if (maxWaitRef.current) clearTimeout(maxWaitRef.current); }, []);

  return (
    <View style={{ backgroundColor: colors.tape, paddingTop: insets.top }}>
      <Pressable style={styles.tape} onPress={cycle} accessibilityRole="button" accessibilityLabel={`Ticker tape: ${mode.label}. Tap to change.`}>
        <View style={[styles.liveDot, { backgroundColor: connected ? colors.tapeUp : colors.tapeMuted }]} />

        {/* Marquee */}
        <Animated.View style={[styles.track, { opacity: contentOpacity, transform: [{ translateX }] }]}>
          <TapeRow items={display} onWidth={handleWidth} colors={colors} />
          <TapeRow items={display} colors={colors} />
        </Animated.View>

        {/* Centered mode title (during a transition) */}
        <Animated.View style={[styles.titleOverlay, { opacity: titleOpacity }]} pointerEvents="none">
          <Text style={[styles.titleText, { color: colors.tapeText }]}>{titleText}</Text>
        </Animated.View>

        {/* Tap affordance */}
        <View style={[styles.cycleHint, { backgroundColor: colors.tape }]} pointerEvents="none">
          <Ionicons name="swap-horizontal" size={13} color={colors.tapeMuted} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tape: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 12,
    marginRight: 4,
    zIndex: 2,
  },
  track: {
    flexDirection: 'row',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  symbol: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginRight: 5,
  },
  value: {
    fontSize: 11,
    fontWeight: '500',
  },
  dot: {
    fontSize: 11,
    marginHorizontal: 10,
  },
  titleOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  cycleHint: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
});
