import { WatchlistStock } from '@/common/types';
import { UnifiedTrendingStocksProps } from '@/common/types/trending';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { useThemeColors } from '@/lib/useColorScheme';
import type React from 'react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  configureReanimatedLogger,
  ReanimatedLogLevel,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

const ITEM_WIDTH  = 180;
const ITEM_GAP    = 8;
const ITEM_STRIDE = ITEM_WIDTH + ITEM_GAP;
// pixels/ms — controls scroll speed
const SCROLL_SPEED_PX_MS = 0.06;

type TabKey = 'trending' | 'gainers' | 'losers' | 'most_active';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'trending',    label: 'Trending'  },
  { key: 'gainers',     label: 'Gainers'   },
  { key: 'losers',      label: 'Losers'    },
  { key: 'most_active', label: 'Active'    },
];

const formatChange = (c: number | null | undefined): string => {
  if (c == null) return 'N/A';
  return c >= 0 ? `+${c.toFixed(2)}%` : `${c.toFixed(2)}%`;
};

const formatPrice = (p: number | null | undefined): string => {
  if (p == null) return 'N/A';
  return `$${p.toFixed(2)}`;
};

export const MinimizedWatchlistComponent: React.FC<UnifiedTrendingStocksProps> = ({
  watchlists,
  isLoading,
  error,
  isQueryClientReady,
  openSetWatchlistModal: _openSetWatchlistModal,
  profile: _profile,
  onErrorOrNoDataChange,
}) => {
  const colors = useThemeColors();
  const translateX = useSharedValue(0);
  const { toTicker } = useBaseNavigation();
  const [activeTab, setActiveTab] = useState<TabKey>('trending');
  const isPausedRef = useRef(false);

  const watchlistData = useMemo<WatchlistStock[]>(() => {
    if (isLoading || !watchlists?.watchlists) return [];
    return watchlists.watchlists[activeTab]?.data || [];
  }, [activeTab, watchlists, isLoading]);

  useEffect(() => {
    const hasNoData = watchlistData.length === 0;
    onErrorOrNoDataChange?.(!!error || hasNoData);
  }, [error, watchlistData, onErrorOrNoDataChange]);

  // Start / restart the marquee whenever data or tab changes.
  // Uses pure translateX — no ScrollView involved — so there's no
  // competing scroll offset and the loop is seamless.
  useEffect(() => {
    cancelAnimation(translateX);
    if (watchlistData.length === 0 || !isQueryClientReady || isLoading) {
      translateX.value = 0;
      return;
    }
    const totalWidth = watchlistData.length * ITEM_STRIDE;
    const duration   = totalWidth / SCROLL_SPEED_PX_MS;
    translateX.value = 0;
    translateX.value = withRepeat(
      withTiming(-totalWidth, { duration }),
      -1,
      false,
    );
  }, [watchlistData, isQueryClientReady, isLoading, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const pauseScroll = () => {
    if (!isPausedRef.current) {
      isPausedRef.current = true;
      cancelAnimation(translateX);
    }
  };

  const resumeScroll = () => {
    if (isPausedRef.current) {
      isPausedRef.current = false;
      if (watchlistData.length === 0) return;
      const totalWidth = watchlistData.length * ITEM_STRIDE;
      const duration   = totalWidth / SCROLL_SPEED_PX_MS;
      // Resume from current position to end, then loop from beginning
      const remaining = Math.abs(totalWidth + translateX.value);
      const remainingDuration = remaining / SCROLL_SPEED_PX_MS;
      translateX.value = withRepeat(
        withTiming(-totalWidth, { duration: remainingDuration }),
        -1,
        false,
      );
      // Re-trigger the full-loop effect after one pass
      setTimeout(() => {
        if (!isPausedRef.current) {
          translateX.value = 0;
          translateX.value = withRepeat(
            withTiming(-totalWidth, { duration }),
            -1,
            false,
          );
        }
      }, remainingDuration);
    }
  };

  // Duplicated list for seamless loop (second copy is identical to first)
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
      {/* Tab row */}
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

      {/* Scrolling ticker */}
      <View style={{ height: 48, marginBottom: 12, overflow: 'hidden', justifyContent: 'center' }}>
        {!isQueryClientReady || isLoading ? (
          <View style={{ paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              {!isQueryClientReady ? 'Initializing…' : 'Loading…'}
            </Text>
          </View>
        ) : watchlistData.length === 0 ? (
          <View style={{ paddingHorizontal: 16 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>No data available</Text>
          </View>
        ) : (
          <Pressable
            onPressIn={pauseScroll}
            onPressOut={resumeScroll}
            style={{ flex: 1 }}
          >
            <Animated.View
              style={[
                { flexDirection: 'row', alignItems: 'center', paddingLeft: 16 },
                animatedStyle,
              ]}
            >
              {displayStocks.map((stock, index) => {
                const changeVal = stock.change_percent ?? stock.change ?? null;
                const isPos = changeVal != null && changeVal >= 0;
                return (
                  <Pressable
                    key={`${stock.ticker}-${index}`}
                    onPress={() => toTicker(stock.ticker)}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: colors.surfaceSecondary,
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        marginRight: ITEM_GAP,
                        width: ITEM_WIDTH,
                        gap: 8,
                      }}
                    >
                      <View style={{
                        width: 6, height: 6, borderRadius: 3,
                        backgroundColor: isPos ? colors.success : colors.error,
                      }} />
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                        {stock.ticker}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontWeight: '500', fontSize: 12 }}>
                        {formatPrice(stock.price)}
                      </Text>
                      <Text style={{ color: isPos ? colors.success : colors.error, fontWeight: '600', fontSize: 11, marginLeft: 'auto' }}>
                        {formatChange(changeVal)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Animated.View>
          </Pressable>
        )}
      </View>
    </View>
  );
};
