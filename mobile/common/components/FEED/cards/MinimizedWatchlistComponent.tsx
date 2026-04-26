import { WatchlistStock } from '@/common/types';
import { UnifiedTrendingStocksProps } from '@/common/types/trending';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { useThemeColors } from '@/lib/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import type React from 'react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  configureReanimatedLogger,
  ReanimatedLogLevel,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

const STOCK_ITEM_WIDTH = 180;
const AUTO_SCROLL_DURATION = 3000;
const AUTO_SCROLL_PAUSE_DURATION = 2000;

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
  openSetWatchlistModal,
  profile,
  onErrorOrNoDataChange,
}) => {
  const colors = useThemeColors();
  const autoScrollX = useSharedValue(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const { toTicker } = useBaseNavigation();
  const userInteractionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: autoScrollX.value }] }));

  const watchlistType = profile?.minimized_watchlist || 'trending';

  const watchlistLabel = useMemo(() => {
    const labels: Record<string, string> = {
      gainers: 'Top Gainers',
      trending: 'Trending',
      most_active: 'Most Active',
      favorites: 'Favorites',
    };
    return labels[watchlistType] ?? 'Trending';
  }, [watchlistType]);

  const watchlistData = useMemo<WatchlistStock[]>(() => {
    if (isLoading || !watchlists?.watchlists) return [];
    switch (watchlistType) {
      case 'gainers': return watchlists.watchlists.gainers?.data || [];
      case 'trending': return watchlists.watchlists.trending?.data || [];
      case 'most_active': return watchlists.watchlists.most_active?.data || [];
      default: return watchlists.watchlists.trending?.data || [];
    }
  }, [watchlistType, watchlists, isLoading]);

  useEffect(() => {
    const hasNoData = !watchlistData || watchlistData.length === 0;
    onErrorOrNoDataChange?.(!!error || hasNoData);
  }, [error, watchlistData, onErrorOrNoDataChange]);

  useEffect(() => {
    if (watchlistData.length > 0 && autoScrollEnabled && !isUserScrolling && isQueryClientReady && !isLoading) {
      autoScrollX.value = withRepeat(
        withTiming(-watchlistData.length * STOCK_ITEM_WIDTH, {
          duration: AUTO_SCROLL_DURATION * watchlistData.length,
        }),
        -1,
        false
      );
    } else {
      autoScrollX.value = withTiming(autoScrollX.value, { duration: 0 });
    }
  }, [watchlistData, autoScrollEnabled, isUserScrolling, isQueryClientReady, isLoading, autoScrollX]);

  useEffect(() => () => { userInteractionTimeoutRef.current && clearTimeout(userInteractionTimeoutRef.current); }, []);

  const handleScrollBeginDrag = () => {
    setIsUserScrolling(true);
    setAutoScrollEnabled(false);
    userInteractionTimeoutRef.current && clearTimeout(userInteractionTimeoutRef.current);
  };

  const handleScrollEndDrag = () => {
    userInteractionTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
      setAutoScrollEnabled(true);
    }, AUTO_SCROLL_PAUSE_DURATION);
  };

  const duplicatedStocks = [...watchlistData, ...watchlistData];

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
        <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.error, fontWeight: '600', fontSize: 14 }}>
            Failed to load market data
          </Text>
          <Pressable onPress={openSetWatchlistModal}>
            <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>
    );
  }

  if (!watchlistData || watchlistData.length === 0) {
    return (
      <View style={containerStyle}>
        <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>Market Watch</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>No data available</Text>
          </View>
          <Pressable onPress={openSetWatchlistModal}>
            <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>Market Watch</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>{watchlistLabel}</Text>
        </View>
        <Pressable
          onPress={openSetWatchlistModal}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.iconButton,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="settings-outline" size={14} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Scrolling ticker list */}
      <View style={{ height: 48, marginBottom: 12, overflow: 'hidden', justifyContent: 'center' }}>
        {!isQueryClientReady || isLoading ? (
          <View style={{ paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              {!isQueryClientReady ? 'Initializing…' : 'Loading…'}
            </Text>
          </View>
        ) : (
          <Animated.View style={{ width: '100%', height: '100%' }}>
            <ScrollView
              ref={scrollViewRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 16 }}
              decelerationRate="fast"
              style={{ flex: 1 }}
              onScrollBeginDrag={handleScrollBeginDrag}
              onScrollEndDrag={handleScrollEndDrag}
              scrollEventThrottle={16}
            >
              <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16 }, animatedStyle]}>
                {duplicatedStocks.map((stock, index) => {
                  const changeVal = stock.change_percent ?? stock.change ?? null;
                  const isPos = changeVal != null && changeVal >= 0;
                  return (
                    <Pressable key={`${stock.ticker}-${index}`} onPress={() => toTicker(stock.ticker)}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: colors.surfaceSecondary,
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          marginRight: 8,
                          minWidth: STOCK_ITEM_WIDTH,
                          gap: 8,
                        }}
                      >
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isPos ? colors.success : colors.error }} />
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{stock.ticker}</Text>
                        <Text style={{ color: colors.textSecondary, fontWeight: '500', fontSize: 13 }}>{formatPrice(stock.price)}</Text>
                        <Text style={{ color: isPos ? colors.success : colors.error, fontWeight: '600', fontSize: 12 }}>
                          {formatChange(changeVal)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </Animated.View>
            </ScrollView>
          </Animated.View>
        )}
      </View>
    </View>
  );
};
