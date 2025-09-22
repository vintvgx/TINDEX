"use client";

import { AppStoreCard } from "@/components/ui/AppStoreCard";
import { Icon } from "@/components/ui/icon";
import { SortBy } from "@/types/blogPosts/create";
import { UnifiedTrendingStocksProps } from "@/types/trending";
import { TrendingUp } from "lucide-react-native";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  interpolate,
  Extrapolation,
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from "react-native-reanimated";

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false, // disable strict mode to silence warning
  // [Reanimated] Reading from `value` during component render. Please ensure that you don't access the `value` property nor use `get` method of a
  // shared value while React is rendering a component.
});

const SCROLL_THRESHOLD = 50;
const MINIMIZED_HEIGHT = 80;
const FULL_HEIGHT = 280;
const CONTENT_SWITCH_THRESHOLD = 40; // When to switch content (before reaching minimized height)

const STOCK_ITEM_WIDTH = 200; // Width of each stock item in minimized view
const AUTO_SCROLL_DURATION = 3000; // 3 seconds per stock
const AUTO_SCROLL_PAUSE_DURATION = 2000; // 2 seconds pause after user interaction

const sortOptions = [
  { value: "volume", label: "Volume" },
  { value: "change", label: "Change" },
  { value: "pe", label: "P/E Ratio" },
  { value: "marketcap", label: "Market Cap" },
];

export const UnifiedTrendingStocksCard: React.FC<
  UnifiedTrendingStocksProps
> = ({
  stocks,
  isLoading,
  error,
  selectedSortBy,
  onSortChange,
  isQueryClientReady,
  scrollY,
}) => {
  const animatedScrollY = useSharedValue(0);
  const isMinimized = useSharedValue(false);
  const autoScrollX = useSharedValue(0);
  const scrollViewRef = useRef<ScrollView>(null);

  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const userInteractionTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const date = stocks?.timestamp
    ? new Date(stocks.timestamp).toLocaleString()
    : "";

  // Format volume helper
  const formatVolume = (volume: string) => {
    const num = Number.parseFloat(volume.replace(/,/g, ""));
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return volume;
  };

  // Update scroll position
  useEffect(() => {
    animatedScrollY.value = withTiming(scrollY, { duration: 100 });
    const shouldMinimize = scrollY > SCROLL_THRESHOLD;
    if (shouldMinimize !== isMinimized.value) {
      isMinimized.value = shouldMinimize;
    }
  }, [scrollY, animatedScrollY, isMinimized]);

  // Auto-scroll animation for minimized view
  useEffect(() => {
    if (
      stocks?.data &&
      stocks.data.length > 0 &&
      isMinimized.value &&
      autoScrollEnabled &&
      !isUserScrolling
    ) {
      const totalWidth = stocks.data.length * STOCK_ITEM_WIDTH;

      // Start auto-scroll animation - scroll from left to right
      autoScrollX.value = withRepeat(
        withTiming(-totalWidth, {
          duration: AUTO_SCROLL_DURATION * stocks.data.length,
        }),
        -1, // Infinite repeat
        false // Don't reverse
      );
    } else {
      // Stop auto-scroll when conditions aren't met
      autoScrollX.value = withTiming(autoScrollX.value, { duration: 0 });
    }
  }, [
    stocks?.data,
    isMinimized.value,
    autoScrollEnabled,
    isUserScrolling,
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

  // Animated styles for the container - Progressive height reduction
  const containerAnimatedStyle = useAnimatedStyle(() => {
    // Progressive height reduction starts immediately when scrolling begins
    const height = interpolate(
      animatedScrollY.value,
      [0, SCROLL_THRESHOLD],
      [FULL_HEIGHT, MINIMIZED_HEIGHT],
      Extrapolation.CLAMP
    );

    return {
      height: withTiming(height, { duration: 200 }),
    };
  });

  // Animated styles for full content - Fades out as height reduces
  const fullContentAnimatedStyle = useAnimatedStyle(() => {
    // Content starts fading when height reduction begins
    const opacity = interpolate(
      animatedScrollY.value,
      [0, CONTENT_SWITCH_THRESHOLD],
      [1, 0],
      Extrapolation.CLAMP
    );

    // Scale down slightly as it fades
    const scale = interpolate(
      animatedScrollY.value,
      [0, CONTENT_SWITCH_THRESHOLD],
      [1, 0.95],
      Extrapolation.CLAMP
    );

    return {
      opacity: withTiming(opacity, { duration: 150 }),
      transform: [
        {
          scale: withTiming(scale, { duration: 150 }),
        },
      ],
    };
  });

  // Animated styles for minimized content - Fades in as full content fades out
  const minimizedContentAnimatedStyle = useAnimatedStyle(() => {
    // Minimized content starts appearing when full content starts fading
    const opacity = interpolate(
      animatedScrollY.value,
      [0, CONTENT_SWITCH_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP
    );

    // Slide up slightly as it appears
    const translateY = interpolate(
      animatedScrollY.value,
      [0, CONTENT_SWITCH_THRESHOLD],
      [10, 0],
      Extrapolation.CLAMP
    );

    return {
      opacity: withTiming(opacity, { duration: 200 }),
      transform: [
        {
          translateY: withTiming(translateY, { duration: 200 }),
        },
      ],
    };
  });

  // Loading state
  if (!isQueryClientReady || isLoading) {
    return (
      <View className="mx-5 mb-4">
        <AppStoreCard variant="compact">
          <View className="p-7">
            <View className="flex-row items-center mb-6">
              <View className="w-10 h-10 bg-blue-500/20 rounded-2xl flex items-center justify-center mr-4">
                <Icon as={TrendingUp} className="text-blue-400 size-5" />
              </View>
              <View>
                <Text className="text-white text-xl font-bold tracking-tight">
                  Trending Stocks
                </Text>
                <Text className="text-gray-400 text-sm font-medium">
                  Market leaders
                </Text>
              </View>
            </View>
            <View className="flex-row items-center">
              <ActivityIndicator size="small" color="#007AFF" />
              <Text className="ml-3 text-gray-400 font-medium">
                {!isQueryClientReady ? "Initializing..." : "Loading..."}
              </Text>
            </View>
          </View>
        </AppStoreCard>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View className="mx-5 mb-4">
        <AppStoreCard variant="compact">
          <View className="p-7">
            <View className="flex-row items-center mb-6">
              <View className="w-10 h-10 bg-red-500/20 rounded-2xl flex items-center justify-center mr-4">
                <Icon as={TrendingUp} className="text-red-400 size-5" />
              </View>
              <View>
                <Text className="text-white text-xl font-bold tracking-tight">
                  Trending Stocks
                </Text>
                <Text className="text-gray-400 text-sm font-medium">
                  Market leaders
                </Text>
              </View>
            </View>
            <Text className="text-red-400 font-semibold">
              Failed to load trending stocks
            </Text>
          </View>
        </AppStoreCard>
      </View>
    );
  }

  // No data state
  if (!stocks?.data || stocks.data.length === 0) {
    return (
      <View className="mx-5 mb-4">
        <View className="bg-gray-800/60 rounded-2xl px-4 py-3 border border-gray-700/30">
          <Text className="text-white text-sm font-bold">Trending Stocks</Text>
          <Text className="text-gray-400 text-xs mt-1">No data available</Text>
        </View>
      </View>
    );
  }

  // Create duplicated stocks for seamless looping
  const duplicatedStocks = [...stocks.data, ...stocks.data];

  return (
    <View className="mx-5 mb-4">
      <Animated.View
        style={containerAnimatedStyle}
        className="relative overflow-hidden">
        {/* Full Content */}
        <Animated.View
          style={[
            fullContentAnimatedStyle,
            { position: "absolute", width: "100%", height: "100%" },
          ]}>
          <AppStoreCard variant="featured">
            <View className="p-4">
              {/* Header with title */}
              <View className="flex-row justify-between items-center mb-8">
                <View className="flex-row items-center">
                  <View>
                    <Text className="text-white text-2xl font-bold tracking-tight">
                      Trending Stocks
                    </Text>
                    <Text className="text-gray-400 text-sm font-medium mt-1">
                      Market leaders by {selectedSortBy}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Stocks horizontal scroll */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 28 }}
                decelerationRate="fast">
                {stocks.data.slice(0, 5).map((stock) => (
                  <View
                    key={stock.ticker}
                    className="bg-gradient-to-br from-gray-800/60 to-gray-800/40 p-5 rounded-2xl mr-5 min-w-[170px] border border-gray-700/30 backdrop-blur-sm">
                    <View className="flex-row justify-between items-start mb-3">
                      <Text className="font-black text-white text-lg tracking-tight">
                        {stock.ticker}
                      </Text>
                      <View className="w-2.5 h-2.5 bg-blue-500 rounded-full shadow-sm shadow-blue-500/50" />
                    </View>

                    <Text
                      className="text-xs text-gray-400 mb-4 leading-5 font-medium"
                      numberOfLines={2}>
                      {stock.company}
                    </Text>

                    <View className="space-y-2">
                      <Text className="text-2xl font-black text-white tracking-tight">
                        ${stock.price}
                      </Text>
                      <Text
                        className={`text-sm font-bold ${
                          stock.change.startsWith("+") ||
                          !stock.change.startsWith("-")
                            ? "text-green-400"
                            : "text-red-400"
                        }`}>
                        {stock.change}
                      </Text>
                      <Text className="text-xs text-gray-500 mt-3 font-medium">
                        Vol: {stock.volume}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
              <Text className="text-gray-400 text-sm font-medium mt-1">
                Retrieved: {date}
              </Text>
            </View>
          </AppStoreCard>
        </Animated.View>

        {/* Minimized Content */}
        <Animated.View
          style={[
            minimizedContentAnimatedStyle,
            { position: "absolute", width: "100%", height: "100%" },
          ]}>
          <View className="bg-gray-800/60 rounded-2xl px-4 py-3 border border-gray-700/30 h-full justify-center">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-white text-sm font-bold">
                Trending Stocks
              </Text>
              <View className="flex-row items-center space-x-1">
                {/* //TODO replace with Live animation when real time data is implemented */}
                {/* <View className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse mr-0.5" />
                <Text className="text-blue-400 text-xs font-medium">Live</Text> */}
                <Text className="text-gray-400 text-sm font-medium mt-1">
                Retrieved: {date}
              </Text>
              </View>
            </View>

            <ScrollView
              ref={scrollViewRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 16 }}
              decelerationRate="fast"
              style={{ flex: 1 }}
              onScrollBeginDrag={handleScrollBeginDrag}
              onScrollEndDrag={handleScrollEndDrag}
              scrollEventThrottle={16}>
              <Animated.View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  transform: [{ translateX: autoScrollX }],
                }}>
                {duplicatedStocks.map((stock, index) => (
                  <View
                    key={`${stock.ticker}-${index}`}
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
                      ${stock.price}
                    </Text>

                    {/* Change */}
                    <View className="flex-row items-center mr-3">
                      <Text
                        className={`font-bold text-xs ${
                          stock.change.startsWith("+") ||
                          !stock.change.startsWith("-")
                            ? "text-green-400"
                            : "text-red-400"
                        }`}>
                        {stock.change}
                      </Text>
                    </View>

                    {/* Volume */}
                    <Text className="text-gray-400 text-xs font-medium">
                      {formatVolume(stock.volume)}
                    </Text>
                  </View>
                ))}
              </Animated.View>
            </ScrollView>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
};
