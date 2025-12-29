/**
 * Updates Tab Component
 * Displays ticker updates (tweet-like posts) for a specific ticker
 */

import type React from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { useTickerUpdatesQuery } from "@/hooks/queries/ticker/useTickerUpdatesQuery";
import { UnifiedPostCard, type FeedItemType } from "@/common/components/FEED/cards/UnifiedPostCard";

interface UpdatesTabProps {
  ticker: string;
}

export const UpdatesTab: React.FC<UpdatesTabProps> = ({ ticker }) => {
  const {
    data: tickerUpdates,
    isLoading,
    error,
  } = useTickerUpdatesQuery(ticker);

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center">
        <ActivityIndicator size="large" color="#007AFF" />
        <Text className="mt-4 text-gray-400">Loading updates...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 justify-center items-center px-8">
        <Text className="text-red-400 text-center">
          Error loading updates: {error instanceof Error ? error.message : "Unknown error"}
        </Text>
      </View>
    );
  }

  if (!tickerUpdates || tickerUpdates.length === 0) {
    return (
      <View className="flex-1 justify-center items-center px-8">
        <View className="bg-gray-900/50 rounded-3xl p-8 border border-gray-800/30">
          <Text className="text-xl font-bold text-white text-center mb-2">
            No Current Updates
          </Text>
          <Text className="text-sm text-gray-400 text-center leading-6">
            Generate a tweet to see updates for {ticker}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}>
      {tickerUpdates.map((update, index) => {
        const feedItem: FeedItemType = {
          type: "update",
          data: update,
        };
        return (
          <UnifiedPostCard
            key={update.id}
            item={feedItem}
            isLast={index === tickerUpdates.length - 1}
          />
        );
      })}
    </ScrollView>
  );
};

