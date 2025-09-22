"use client";

import { AppStoreCard } from "@/components/ui/AppStoreCard";
import { Icon } from "@/components/ui/icon";
import { SortBy } from "@/types/blogPosts/create";
import { TrendingStocksCardProps } from "@/types/trending";
import { TrendingUp } from "lucide-react-native";
import type React from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

const sortOptions = [
  { value: "volume", label: "Volume" },
  { value: "change", label: "Change" },
  { value: "pe", label: "P/E Ratio" },
  { value: "marketcap", label: "Market Cap" },
];

export const TrendingStocksCard: React.FC<TrendingStocksCardProps> = ({
  stocks,
  isLoading,
  error,
  selectedSortBy,
  onSortChange,
  isQueryClientReady,
}) => {
  const selectedOption = sortOptions.find(
    (option) => option.value === selectedSortBy
  );

  if (!isQueryClientReady) {
    return (
      <View className="mx-5 mb-8">
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
                Initializing...
              </Text>
            </View>
          </View>
        </AppStoreCard>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View className="mx-5 mb-8">
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
            <ActivityIndicator size="small" color="#007AFF" />
          </View>
        </AppStoreCard>
      </View>
    );
  }

  if (error) {
    return (
      <View className="mx-5 mb-8">
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

  if (!stocks?.data) {
    return null;
  }

  return (
    <View className="mx-5 mb-8">
      <AppStoreCard variant="featured">
        <View className="p-7">
          {/* Header with title and dropdown */}
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
            {stocks.data.slice(0, 5).map((stock, index) => (
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
        </View>
      </AppStoreCard>
    </View>
  );
};
