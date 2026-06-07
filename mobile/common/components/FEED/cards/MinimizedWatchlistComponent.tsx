import { WatchlistStock } from '@/common/types';
import { UnifiedTrendingStocksProps } from '@/common/types/trending';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { useThemeColors } from '@/lib/useColorScheme';
import type React from 'react';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

const ITEM_WIDTH  = 160;
const ITEM_GAP    = 8;
const ITEM_STRIDE = ITEM_WIDTH + ITEM_GAP;

// Auto-scroll speed: pixels every TICK_MS milliseconds
const TICK_MS  = 32;
const TICK_PX  = 4; // 125 px/s

type TabKey = 'trending' | 'gainers' | 'losers' | 'most_active';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'trending',    label: 'Trending' },
  { key: 'gainers',     label: 'Gainers'  },
  { key: 'losers',      label: 'Losers'   },
  { key: 'most_active', label: 'Active'   },
];

const formatChange = (c: number | null | undefined): string => {
  if (c == null) return '';
  return c >= 0 ? `+${c.toFixed(2)}%` : `${c.toFixed(2)}%`;
};

const formatPrice = (p: number | null | undefined): string => {
  if (p == null) return '—';
  return `$${p.toFixed(2)}`;
};

// ─── Individual chip ─────────────────────────────────────────────────────────

function StockChip({
  stock,
  colors,
  onPress,
}: {
  stock: WatchlistStock;
  colors: any;
  onPress: () => void;
}) {
  const changeVal = stock.change_percent ?? stock.change ?? null;
  const isPos     = changeVal != null && changeVal >= 0;
  const changeColor = isPos ? colors.success : colors.error;

  return (
    <Pressable onPress={onPress}>
      <View style={{
        width: ITEM_WIDTH,
        marginRight: ITEM_GAP,
        backgroundColor: colors.surfaceSecondary,
        borderRadius: 12,
        paddingHorizontal: 11,
        paddingVertical: 9,
      }}>
        {/* Row 1 — ticker + dot */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
            {stock.ticker}
          </Text>
          <View style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: changeVal == null ? colors.textTertiary : (isPos ? colors.success : colors.error),
          }} />
        </View>

        {/* Row 2 — price */}
        <Text style={{ color: colors.textSecondary, fontWeight: '500', fontSize: 12, marginBottom: 2 }} numberOfLines={1}>
          {formatPrice(stock.price)}
        </Text>

        {/* Row 3 — change % */}
        {changeVal != null && (
          <Text style={{ color: changeColor, fontWeight: '600', fontSize: 11 }} numberOfLines={1}>
            {formatChange(changeVal)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const MinimizedWatchlistComponent: React.FC<UnifiedTrendingStocksProps> = ({
  watchlists,
  isLoading,
  error,
  isQueryClientReady,
  openSetWatchlistModal: _openSetWatchlistModal,
  profile: _profile,
  onErrorOrNoDataChange,
}) => {
  const colors       = useThemeColors();
  const { toTicker } = useBaseNavigation();
  const [activeTab, setActiveTab] = useState<TabKey>('trending');

  const scrollRef   = useRef<ScrollView>(null);
  const scrollXRef  = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const draggingRef = useRef(false);
  const readyRef    = useRef(false);

  const watchlistData = useMemo<WatchlistStock[]>(() => {
    if (isLoading || !watchlists?.watchlists) return [];
    return (watchlists.watchlists as any)[activeTab]?.data || [];
  }, [activeTab, watchlists, isLoading]);

  const totalWidth = watchlistData.length * ITEM_STRIDE;

  useEffect(() => {
    const hasNoData = watchlistData.length === 0;
    onErrorOrNoDataChange?.(!!error || hasNoData);
  }, [error, watchlistData, onErrorOrNoDataChange]);

  // ── Auto-scroll via setInterval + ScrollView.scrollTo ────────────────────
  const startScroll = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!readyRef.current || totalWidth === 0) return;

    timerRef.current = setInterval(() => {
      if (draggingRef.current || !scrollRef.current) return;
      scrollXRef.current += TICK_PX;
      // Seamless loop: when we've scrolled one full set, snap back instantly
      if (scrollXRef.current >= totalWidth) {
        scrollXRef.current -= totalWidth;
        scrollRef.current.scrollTo({ x: scrollXRef.current, animated: false });
      } else {
        scrollRef.current.scrollTo({ x: scrollXRef.current, animated: false });
      }
    }, TICK_MS);
  }, [totalWidth]);

  const stopScroll = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // Restart scroll whenever data or tab changes
  useEffect(() => {
    scrollXRef.current = 0;
    scrollRef.current?.scrollTo({ x: 0, animated: false });
    stopScroll();
    if (isQueryClientReady && !isLoading && watchlistData.length > 0) {
      // Short delay so ScrollView has measured its content
      const t = setTimeout(() => { readyRef.current = true; startScroll(); }, 300);
      return () => clearTimeout(t);
    }
    return stopScroll;
  }, [watchlistData, activeTab, isQueryClientReady, isLoading, startScroll, stopScroll]);

  // Cleanup on unmount
  useEffect(() => () => stopScroll(), [stopScroll]);

  // ── PanResponder — lets user drag the ticker; pauses auto-scroll ─────────
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) =>
      Math.abs(gs.dx) > 4 && Math.abs(gs.dx) > Math.abs(gs.dy),
    onPanResponderGrant: () => {
      draggingRef.current = true;
      stopScroll();
    },
    onPanResponderMove: (_, gs) => {
      if (!scrollRef.current) return;
      const newX = scrollXRef.current - gs.dx;
      // Allow scrolling in both directions; keep within doubled content
      const clamped = Math.max(0, Math.min(totalWidth * 2 - ITEM_WIDTH, newX));
      scrollRef.current.scrollTo({ x: clamped, animated: false });
    },
    onPanResponderRelease: (_, gs) => {
      // Commit the drag offset into scrollXRef
      scrollXRef.current = Math.max(
        0,
        Math.min(totalWidth - 1, scrollXRef.current - gs.dx),
      );
      // Normalise into [0, totalWidth) for seamless continuation
      scrollXRef.current = ((scrollXRef.current % totalWidth) + totalWidth) % totalWidth;
      draggingRef.current = false;
      // Resume auto-scroll after 1.5s
      const t = setTimeout(startScroll, 1500);
      return () => clearTimeout(t);
    },
    onPanResponderTerminate: () => {
      draggingRef.current = false;
      setTimeout(startScroll, 1500);
    },
  }), [totalWidth, startScroll, stopScroll]);

  // Duplicated items for seamless loop
  const displayStocks = useMemo(
    () => [...watchlistData, ...watchlistData],
    [watchlistData],
  );

  const containerStyle = {
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden' as const,
  };

  if (error) {
    return (
      <View style={containerStyle}>
        <View style={{ padding: 16 }}>
          <Text style={{ color: colors.error, fontWeight: '600', fontSize: 14 }}>
            Failed to load market data
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      {/* Tab pills */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 6 }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
                backgroundColor: isActive ? colors.accent + '22' : colors.surfaceSecondary,
                borderWidth: 1,
                borderColor: isActive ? colors.accent + '66' : 'transparent',
              }}
            >
              <Text style={{
                fontSize: 11,
                fontWeight: isActive ? '700' : '500',
                color: isActive ? colors.accent : colors.textSecondary,
              }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Ticker row */}
      <View style={{ height: 80, marginBottom: 12 }}>
        {!isQueryClientReady || isLoading ? (
          <View style={{ paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', height: '100%', gap: 8 }}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              {!isQueryClientReady ? 'Initializing…' : 'Loading…'}
            </Text>
          </View>
        ) : watchlistData.length === 0 ? (
          <View style={{ paddingHorizontal: 16, justifyContent: 'center', height: '100%' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>No data available</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }} {...panResponder.panHandlers}>
            <ScrollView
              ref={scrollRef}
              horizontal
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingLeft: 14, paddingRight: 6 }}
              scrollEventThrottle={16}
            >
              {displayStocks.map((stock, index) => (
                <StockChip
                  key={`${stock.ticker}-${index}`}
                  stock={stock}
                  colors={colors}
                  onPress={() => toTicker(stock.ticker)}
                />
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
};
