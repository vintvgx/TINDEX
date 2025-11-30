import { Icon } from "@/common/components/ui/icon";
import { WatchlistStock } from "@/common/types";
import { UnifiedTrendingStocksProps } from "@/common/types/trending";
import { useBaseNavigation } from "@/hooks/navigation/useBaseNavigation";
import { Info, TrendingUp } from "lucide-react-native";
import type React from "react";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  configureReanimatedLogger,
  ReanimatedLogLevel,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from "react-native-reanimated";

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false, // disable strict mode to silence warning
  // [Reanimated] Reading from `value` during component render. Please ensure that you don't access the `value` property nor use `get` method of a
  // shared value while React is rendering a component.
});

const STOCK_ITEM_WIDTH = 200; // Width of each stock item in minimized view
const AUTO_SCROLL_DURATION = 3000; // 3 seconds per stock
const AUTO_SCROLL_PAUSE_DURATION = 2000; // 2 seconds pause after user interaction

export const MinimizedWatchlistComponent: React.FC<
  UnifiedTrendingStocksProps
> = ({
  watchlists,
  isLoading,
  error,
  isQueryClientReady,
  openSetWatchlistModal,
  profile,
  onErrorOrNoDataChange
}) => {
  const autoScrollX = useSharedValue(0);
  const scrollViewRef = useRef<ScrollView>(null);

  // Animated style for the scrolling container
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: autoScrollX.value }],
    };
  });

  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const { toTicker } = useBaseNavigation();

  const userInteractionTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // const date = stocks?.timestamp
  //   ? new Date(stocks.timestamp).toLocaleString()
  //   : "";

  // Format volume helper - handles both string and number types
  const formatVolume = (volume: string | number | null | undefined): string => {
    if (volume === null || volume === undefined) return "N/A";
    
    const num = typeof volume === "string" 
      ? Number.parseFloat(volume.replace(/,/g, ""))
      : volume;
    
    if (Number.isNaN(num) || num === 0) return "N/A";
    
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toString();
  };

  // Format change helper - handles number types (change is always number | null in WatchlistStock)
  const formatChange = (change: number | null | undefined): string => {
    if (change === null || change === undefined) return "N/A";
    
    // Format number with + or - sign and 2 decimal places
    return change >= 0 ? `+${change.toFixed(2)}` : change.toFixed(2);
  };

  // Format price helper
  const formatPrice = (price: number | null | undefined): string => {
    if (price === null || price === undefined) return "N/A";
    return `$${price.toFixed(2)}`;
  };

  // Get the current watchlist type
  const watchlistType = profile?.minimized_watchlist || 'trending';

  // Get the subtitle based on watchlist type
  const watchlistSubtitle = useMemo(() => {
    switch (watchlistType) {
      case 'gainers':
        return 'Biggest Gainers';
      case 'trending':
        return 'Trending';
      case 'most_active':
        return 'Most Active';
      case 'favorites':
        return 'Favorites';
      default:
        return 'Trending';
    }
  }, [watchlistType]);

  // Determine which data to show based on selected watchlist
  // Use useMemo to optimize and ensure reactivity to profile/watchlists changes
  const watchlistData = useMemo(() => {
    // If still loading or no data, return empty array
    if (isLoading || !watchlists?.watchlists) {
      return [];
    }

    switch (watchlistType) {
      case 'gainers':
        return watchlists.watchlists.gainers?.data || [];
      case 'trending':
        return watchlists.watchlists.trending?.data || [];
      case 'most_active':
        return watchlists.watchlists.most_active?.data || [];
      // TODO watchlist types are not yet implemented in the API
      // case 'insider_buying':
      // case 'congress_trading':
      // case 'top_gainers':
      // case 'top_losers':
      case 'favorites':
        return []; // Favorites not yet implemented
      default:
        return watchlists.watchlists.trending?.data || [];
    }
  }, [watchlistType, watchlists, isLoading]);

  // Use the watchlistData as stocks
  const stocks: WatchlistStock[] = watchlistData;

  // Auto-scroll animation - always scrolls regardless of scroll position
  // TDX-39 Updated code to have component always scrolling regardless of position of the screen
  useEffect(() => {
    if (
      stocks &&
      stocks.length > 0 &&
      autoScrollEnabled &&
      !isUserScrolling &&
      isQueryClientReady &&
      !isLoading
    ) {
      const totalWidth = stocks.length * STOCK_ITEM_WIDTH;

      // Start auto-scroll animation - scroll from left to right
      autoScrollX.value = withRepeat(
        withTiming(-totalWidth, {
          duration: AUTO_SCROLL_DURATION * stocks.length,
        }),
        -1, // Infinite repeat
        false // Don't reverse
      );
    } else {
      // Stop auto-scroll when conditions aren't met
      autoScrollX.value = withTiming(autoScrollX.value, { duration: 0 });
    }
  }, [
    stocks,
    autoScrollEnabled,
    isUserScrolling,
    isQueryClientReady,
    isLoading,
    autoScrollX,
  ]);

  // Handle user scroll interaction
  const handleScrollBeginDrag = () => {
    setIsUserScrolling(true);
    setAutoScrollEnabled(false);

    // Clear any existing timeout
    if (userInteractionTimeoutRef.current) {
      clearTimeout(userInteractionTimeoutRef.current);
    }
  };

  const handleScrollEndDrag = () => {
    // Set timeout to resume auto-scroll after user stops interacting
    userInteractionTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
      setAutoScrollEnabled(true);
    }, AUTO_SCROLL_PAUSE_DURATION);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (userInteractionTimeoutRef.current) {
        clearTimeout(userInteractionTimeoutRef.current);
      }
    };
  }, []);

  // Navigation handler using the navigation service
  const handleNavigation = (ticker: string) => {
    console.log("Navigating to [ticker]:", ticker);
    toTicker(ticker);
  };

  // Notify parent about error or no data state
  // This must be called before any early returns to satisfy React Hooks rules
  useEffect(() => {
    const hasNoData = !stocks || stocks.length === 0;
    const hasError = !!error;
    onErrorOrNoDataChange?.(hasError || hasNoData);
  }, [error, stocks, onErrorOrNoDataChange]);

  // Error state
  if (error) {
    return (
      <View className="mx-5 mb-4">
        <BlurView
          intensity={25}
          tint="dark"
          className="rounded-3xl overflow-hidden border border-white/10"
        >
          <View className="bg-black/20 p-7">
            <View className="flex-row items-center justify-between mb-6">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 bg-red-500/20 rounded-2xl flex items-center justify-center mr-4">
                  <Icon as={TrendingUp} className="text-red-400 size-5" />
                </View>
                <View>
                  <Text className="text-white text-xl font-bold tracking-tight">
                    Trending Stocks
                  </Text>
                  <Text className="text-gray-400 text-sm font-medium">
                    {watchlistSubtitle}
                  </Text>
                </View>
              </View>
              <Pressable onPress={openSetWatchlistModal}>
                <Icon as={Info} className="text-white size-7"/>
              </Pressable>
            </View>
            <Text className="text-red-400 font-semibold">
              Failed to load trending stocks
            </Text>
          </View>
        </BlurView>
      </View>
    );
  }

  // No data state
  if (!stocks || stocks.length === 0) {
    return (
      <View className="mx-5 mb-4">
        <BlurView
          intensity={25}
          tint="dark"
          className="rounded-3xl overflow-hidden border border-white/10"
        >
          <View className="bg-black/20 px-5 pt-5 pb-5">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 bg-blue-500/20 rounded-2xl flex items-center justify-center mr-4">
                  <Icon as={TrendingUp} className="text-blue-400 size-5" />
                </View>
                <View>
                  <Text className="text-white text-xl font-bold tracking-tight">
                    Trending Stocks
                  </Text>
                  <Text className="text-gray-400 text-sm font-medium">
                    {watchlistSubtitle}
                  </Text>
                </View>
              </View>
              <Pressable onPress={openSetWatchlistModal}>
                <Icon as={Info} className="text-white size-7"/>
              </Pressable>
            </View>
            <Text className="text-gray-400 text-sm">No data available</Text>
          </View>
        </BlurView>
      </View>
    );
  }

  // Create duplicated stocks for seamless looping
  const duplicatedStocks = [...stocks, ...stocks];

  return (
    <View className="mx-5 mb-4">
      <BlurView
        intensity={25}
        tint="dark"
        className="rounded-3xl overflow-hidden border border-white/10"
      >
        <View className="bg-black/20">
          {/* Header section with padding */}
          <View className="px-5 pt-5 pb-0">
            <View className="flex-row items-center justify-between mb-6">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 bg-blue-500/20 rounded-2xl flex items-center justify-center mr-4">
                  <Icon as={TrendingUp} className="text-blue-400 size-5" />
                </View>
                <View>
                  <Text className="text-white text-xl font-bold tracking-tight">
                    Trending Stocks
                  </Text>
                  <Text className="text-gray-400 text-sm font-medium">
                    {watchlistSubtitle}
                  </Text>
                </View>
              </View>
              <Pressable onPress={openSetWatchlistModal}>
              <Icon as={Info} className="text-white size-7"/>
              </Pressable>
            </View>
          </View>
          
          {/* Scrolling list section - edge to edge */}
          <View className="h-16 pb-4 justify-center overflow-hidden">
            {!isQueryClientReady || isLoading ? (
              <View className="px-5 flex-row items-center">
                <ActivityIndicator size="small" color="#007AFF" />
                <Text className="ml-3 text-gray-400 font-medium">
                  {!isQueryClientReady ? "Initializing..." : "Loading..."}
                </Text>
              </View>
            ) : (
              <Animated.View
                style={{ width: "100%", height: "100%" }}>
                <ScrollView
                  ref={scrollViewRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 20 }}
                  decelerationRate="fast"
                  style={{ flex: 1 }}
                  onScrollBeginDrag={handleScrollBeginDrag}
                  onScrollEndDrag={handleScrollEndDrag}
                  scrollEventThrottle={16}>
                  <Animated.View
                    style={[
                      {
                        flexDirection: "row",
                        alignItems: "center",
                        paddingLeft: 24,
                      },
                      animatedStyle,
                    ]}>
                    {duplicatedStocks.map((stock, index) => (
                      <Pressable
                        key={`${stock.ticker}-${index}`}
                        onPress={() => handleNavigation(stock.ticker)}>
                        <View
                          className="flex-row items-center bg-gray-700/40 rounded-xl px-4 py-2 mr-4 border border-gray-600/30"
                          style={{ minWidth: STOCK_ITEM_WIDTH }}>
                          {/* Stock Ticker */}
                          <View className="flex-row items-center mr-4">
                            <View className="w-2 h-2 bg-blue-400 rounded-full mr-2" />
                            <Text className="text-white font-bold text-sm tracking-wide">
                              {stock.ticker}
                            </Text>
                          </View>

                          {/* Price */}
                          <Text className="text-white font-semibold text-sm mr-3">
                            {formatPrice(stock.price)}
                          </Text>

                          {/* Change */}
                          <View className="flex-row items-center mr-3">
                            {(() => {
                              // Prefer change_percent, fallback to change, or null if both are null
                              const changeValue: number | null = 
                                stock.change_percent ?? stock.change ?? null;
                              const isPositive = changeValue !== null && changeValue >= 0;
                              
                              return (
                                <Text
                                  className={`font-bold text-xs ${
                                    isPositive ? "text-green-400" : "text-red-400"
                                  }`}>
                                  {formatChange(changeValue)}
                                </Text>
                              );
                            })()}
                          </View>

                          {/* Volume */}
                          <Text className="text-gray-400 text-xs font-medium">
                            {formatVolume(stock.volume)}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </Animated.View>
                </ScrollView>
              </Animated.View>
            )}
          </View>
        </View>
      </BlurView>
    </View>
  );
};
