"use client";
/**
 * Analytics tab displayed within [ticker].tsx
 */

import type React from "react";
import { View, Text } from "react-native";
import { AppStoreCard } from "@/common/components/ui/AppStoreCard";
import type { TickerData } from "@/common/types/blogPosts/ticker";

interface AnalyticsTabProps {
  stockData: TickerData;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ stockData }) => {
  // Hoist sentiment data to safely handle undefined cases
  const sentiment = stockData.sentiment;
  const sentimentValue = sentiment?.sentiment;
  const sentimentFactors = sentiment?.factors;
  const beta = stockData.beta;
  
  return (
    <>
      {/* Sentiment Analysis */}
      {sentimentValue && (
        <View className="mb-8">
          <AppStoreCard variant="featured">
            <View className="p-6">
              <Text className="text-white text-xl font-bold tracking-tight mb-6">
                Sentiment Analysis
              </Text>

              {/* Sentiment Display */}
              <View className="flex-row items-center justify-between mb-4">
                <View className="flex-1">
                  <Text className="text-gray-400 text-sm font-medium mb-2">
                    Sentiment
                  </Text>
                  <Text
                    className={`text-2xl font-bold ${
                      sentimentValue === "bullish"
                        ? "text-green-400"
                        : sentimentValue === "bearish"
                          ? "text-red-400"
                          : "text-gray-400"
                    }`}>
                    {sentimentValue.toUpperCase()}
                  </Text>
                  <Text className="text-gray-400 text-sm">
                    Score: {sentiment?.score || stockData.sentiment_score || "N/A"} | Confidence:{" "}
                    {sentiment?.confidence || stockData.sentiment_confidence || "N/A"}%
                  </Text>
                </View>
                
                {/* Beta */}
                {beta != null && (
                  <View className="items-end">
                    <Text className="text-gray-400 text-sm font-medium mb-2">
                      Beta
                    </Text>
                    <Text className="text-white text-2xl font-bold">
                      {beta.toFixed(2)}
                    </Text>
                    <Text className="text-gray-400 text-sm">
                      {beta > 1
                        ? "More volatile than market"
                        : "Less volatile than market"}
                    </Text>
                  </View>
                )}
              </View>

              {/* Sentiment Factors */}
              {sentimentFactors && (
                <View className="mt-4 p-4 bg-gray-800/30 rounded-xl">
                  <Text className="text-gray-300 text-sm font-medium mb-2">
                    Key Factors
                  </Text>
                  <View className="flex-row justify-between">
                    <Text className="text-gray-400 text-xs">
                      Price Movement: {sentimentFactors.price_movement}%
                    </Text>
                    <Text className="text-gray-400 text-xs">
                      Beta: {sentimentFactors.beta}
                    </Text>
                    <Text className="text-gray-400 text-xs">
                      P/E: {sentimentFactors.pe_ratio || "N/A"}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </AppStoreCard>
        </View>
      )}

      {/* Market State & Exchange */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-white text-xl font-bold tracking-tight">
                Market Info
              </Text>
              
              {/* Market State */}
              {stockData.market_state && (
                <View
                  className={`px-3 py-1 rounded-full border ${
                    stockData.market_state === "OPEN"
                      ? "bg-green-500/20 border-green-400/30"
                      : "bg-red-500/20 border-red-400/30"
                  }`}>
                  <Text
                    className={`text-sm font-medium ${
                      stockData.market_state === "OPEN"
                        ? "text-green-400"
                        : "text-red-400"
                    }`}>
                    {stockData.market_state}
                  </Text>
                </View>
              )}
            </View>
            
            <View className="flex-row justify-between">
              {/* Exchange */}
              {stockData.exchange && (
                <View>
                  <Text className="text-gray-400 text-sm font-medium">
                    Exchange
                  </Text>
                  <Text className="text-white text-lg font-bold">
                    {stockData.exchange}
                  </Text>
                </View>
              )}
              
              {/* Country */}
              {stockData.country && (
                <View>
                  <Text className="text-gray-400 text-sm font-medium">
                    Country
                  </Text>
                  <Text className="text-white text-lg font-bold">
                    {stockData.country}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </AppStoreCard>
      </View>
    </>
  );
};
