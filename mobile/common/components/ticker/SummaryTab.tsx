"use client";
/**
 * Summary tab displayed within [ticker].tsx
 */

import type React from "react";
import { View, Text, Pressable, Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LineChart } from "react-native-chart-kit";
import { AppStoreCard } from "@/common/components/ui/AppStoreCard";
import type { TickerData } from "@/common/types/blogPosts/ticker";

const { width } = Dimensions.get("window");

interface SummaryTabProps {
  stockData: TickerData;
  selectedPeriod: string;
  onPeriodChange: (period: string) => void;
}

const periods = ["1D", "1W", "1M", "YTD", "1Y", "5Y", "Max"];

export const SummaryTab: React.FC<SummaryTabProps> = ({
  stockData,
  selectedPeriod,
  onPeriodChange,
}) => {
  // Chart data from API
  const chartData = stockData.historical_data
    ? {
        labels: stockData.historical_data.dates.map((date) =>
          new Date(date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        ),
        datasets: [
          {
            data: stockData.historical_data.prices,
            color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
            strokeWidth: 2,
          },
        ],
      }
    : null;

  return (
    <>
      {/* Chart Section */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <Text className="text-white text-xl font-bold tracking-tight mb-6">
              Price Chart
            </Text>
            {chartData ? (
              <LineChart
                data={chartData}
                width={width - 70}
                height={200}
                chartConfig={{
                  backgroundColor: "transparent",
                  backgroundGradientFrom: "#1f2937",
                  backgroundGradientTo: "#111827",
                  decimalPlaces: 2,
                  color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
                  labelColor: (opacity = 1) =>
                    `rgba(156, 163, 175, ${opacity})`,
                  style: {
                    borderRadius: 16,
                  },
                  propsForDots: {
                    r: "0",
                  },
                }}
                bezier
                style={{
                  marginVertical: 8,
                  borderRadius: 16,
                }}
              />
            ) : (
              <View className="h-[200px] bg-gray-800/30 rounded-2xl flex items-center justify-center border border-gray-700/30">
                <Ionicons name="bar-chart-outline" size={48} color="#6B7280" />
                <Text className="text-gray-400 text-lg font-medium mt-4 text-center">
                  No Chart Data Available
                </Text>
                <Text className="text-gray-500 text-sm text-center mt-2">
                  Historical price data could not be loaded
                </Text>
              </View>
            )}

            {/* Period Buttons */}
            <View className="flex-row justify-between mt-6">
              {periods.map((period) => (
                <Pressable
                  key={period}
                  onPress={() => onPeriodChange(period)}
                  className={`px-3 py-2 rounded-lg ${
                    selectedPeriod === period
                      ? "bg-blue-500/20 border border-blue-400/30"
                      : "bg-transparent"
                  }`}>
                  <Text
                    className={`text-sm font-medium ${
                      selectedPeriod === period
                        ? "text-blue-400"
                        : "text-gray-400"
                    }`}>
                    {period}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </AppStoreCard>
      </View>

      {/* Key Stats */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <Text className="text-white text-xl font-bold tracking-tight mb-6">
              Key Statistics
            </Text>
            <View className="flex-row flex-wrap justify-between">
              {/* Day High */}
              {stockData.day_high && (
                <View className="w-[48%] mb-4">
                  <Text className="text-gray-400 text-sm font-medium">
                    Day High
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight mt-1">
                    ${stockData.day_high.toFixed(2)}
                  </Text>
                </View>
              )}

              {/* Day Low */}
              {stockData.day_low && (
                <View className="w-[48%] mb-4">
                  <Text className="text-gray-400 text-sm font-medium">
                    Day Low
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight mt-1">
                    ${stockData.day_low.toFixed(2)}
                  </Text>
                </View>
              )}

              {/* 52W High */}
              {stockData.year_high && (
                <View className="w-[48%] mb-4">
                  <Text className="text-gray-400 text-sm font-medium">
                    52W High
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight mt-1">
                    ${stockData.year_high.toFixed(2)}
                  </Text>
                </View>
              )}

              {/* 52W Low */}
              {stockData.year_low && (
                <View className="w-[48%] mb-4">
                  <Text className="text-gray-400 text-sm font-medium">
                    52W Low
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight mt-1">
                    ${stockData.year_low.toFixed(2)}
                  </Text>
                </View>
              )}

              {/* Volume */}
              {stockData.volume && (
                <View className="w-[48%] mb-4">
                  <Text className="text-gray-400 text-sm font-medium">
                    Volume
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight mt-1">
                    {stockData.volume.toLocaleString()}
                  </Text>
                </View>
              )}

              {/* Average Volume */}
              {stockData.average_volume && (
                <View className="w-[48%] mb-4">
                  <Text className="text-gray-400 text-sm font-medium">
                    Avg Volume
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight mt-1">
                    {stockData.average_volume.toLocaleString()}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </AppStoreCard>
      </View>

      {/* About Section */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <Text className="text-white text-xl font-bold tracking-tight mb-4">
              About {stockData.ticker}
            </Text>
            
            {/* Sector and Industry */}
            <View className="flex-row items-center mb-4">
              {stockData.sector && (
                <View className="bg-blue-500/20 px-3 py-1 rounded-full mr-3 border border-blue-400/30">
                  <Text className="text-blue-400 text-sm font-medium">
                    {stockData.sector}
                  </Text>
                </View>
              )}
              {stockData.industry && (
                <View className="bg-gray-700/60 px-3 py-1 rounded-full border border-gray-600/30">
                  <Text className="text-gray-300 text-sm font-medium">
                    {stockData.industry}
                  </Text>
                </View>
              )}
            </View>

            {/* Description */}
            {stockData.description && (
              <Text className="text-gray-300 leading-7 mb-6 font-medium">
                {stockData.description}
              </Text>
            )}

            {/* Action Buttons */}
            <View className="flex-row justify-between">
              <Pressable className="flex-1 bg-green-500/20 border border-green-400/30 rounded-2xl py-3 mr-2">
                <Text className="text-green-400 font-bold text-center tracking-wide">
                  Bull Case
                </Text>
              </Pressable>
              <Pressable className="flex-1 bg-orange-500/20 border border-orange-400/30 rounded-2xl py-3 mx-1">
                <Text className="text-orange-400 font-bold text-center tracking-wide">
                  Bear Case
                </Text>
              </Pressable>
              <Pressable className="flex-1 bg-purple-500/20 border border-purple-400/30 rounded-2xl py-3 ml-2">
                <Text className="text-purple-400 font-bold text-center tracking-wide">
                  Ask Claire
                </Text>
              </Pressable>
            </View>
          </View>
        </AppStoreCard>
      </View>
    </>
  );
};
