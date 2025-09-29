"use client";

import type React from "react";
import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LineChart } from "react-native-chart-kit";
import { useLocalSearchParams, router } from "expo-router";
import { useTickerQuery } from "@/hooks/queries/ticker/useTickerQuery";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";
import { AppStoreCard } from "@/common/components/ui/AppStoreCard";

const { width } = Dimensions.get("window");

export default function TickerScreen() {
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  console.log("[ticker] TICKER", ticker);
  const {
    data: tickerResponse,
    isLoading,
    error,
  } = useTickerQuery(ticker || "");

  const [activeTab, setActiveTab] = useState<
    "Summary" | "Analytics" | "Financials"
  >("Summary");
  const [selectedPeriod, setSelectedPeriod] = useState("1D");

  const periods = ["1D", "1W", "1M", "YTD", "1Y", "5Y", "Max"];

  const stockData = tickerResponse?.data;

  const { navigateBack } = useBaseNavigation();

  const handleBack = () => {
    navigateBack();
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <View className="absolute inset-0 bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/10" />
        <View className="flex-1 justify-center items-center px-8">
          <View className="bg-gray-900/50 rounded-3xl p-8 border border-gray-800/30">
            <ActivityIndicator size="large" color="#007AFF" />
            <Text className="mt-6 text-lg text-gray-300 font-semibold text-center tracking-wide">
              Loading {ticker}...
            </Text>
            <Text className="mt-2 text-sm text-gray-500 text-center font-medium">
              Fetching ticker data
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Error state or if there is no data to be displayed 
  if (error || !stockData) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <View className="absolute inset-0 bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/10" />
        <View className="flex-1 justify-center items-center px-8">
          <View className="bg-gray-900/30 rounded-3xl p-12 border border-gray-800/30 text-center">
            <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
            <Text className="mt-6 text-2xl font-black text-white mb-4 text-center tracking-tight">
              Error Loading Ticker
            </Text>
            <Text className="text-base text-gray-400 text-center leading-7 font-medium mb-6">
              {error instanceof Error ? error.message : "Something went wrong"}
            </Text>
            <Pressable
              onPress={handleBack}
              className="bg-gradient-to-br from-blue-500 to-blue-600 px-6 py-3 rounded-2xl shadow-lg shadow-blue-500/30 border border-blue-400/20">
              <Text className="text-white font-bold text-center">Go Back</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Chart data from API or fallback
  const chartData = stockData.chartData
    ? {
        labels: stockData.chartData.labels,
        datasets: [
          {
            data: stockData.chartData.prices,
            color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
            strokeWidth: 2,
          },
        ],
      }
    : {
        labels: ["Sep 19", "Sep 20", "Sep 21", "Sep 22", "Sep 23"],
        datasets: [
          {
            data: [
              stockData.price * 0.98,
              stockData.price * 1.02,
              stockData.price * 0.99,
              stockData.price * 1.01,
              stockData.price,
            ],
            color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
            strokeWidth: 2,
          },
        ],
      };

  const renderTabButton = (tab: "Summary" | "Analytics" | "Financials") => (
    <Pressable
      onPress={() => setActiveTab(tab)}
      className={`px-4 py-2 ${activeTab === tab ? "border-b-2 border-blue-400" : ""}`}>
      <Text
        className={`text-lg font-medium ${activeTab === tab ? "text-white" : "text-gray-400"}`}>
        {tab}
      </Text>
    </Pressable>
  );

  const renderSummaryTab = () => (
    <ScrollView 
      className="flex-1 px-5" 
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}
    >
      {/* Chart Section */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <Text className="text-white text-xl font-bold tracking-tight mb-6">
              Price Chart
            </Text>
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
                labelColor: (opacity = 1) => `rgba(156, 163, 175, ${opacity})`,
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

            {/* Period Buttons */}
            <View className="flex-row justify-between mt-6">
              {periods.map((period) => (
                <Pressable
                  key={period}
                  onPress={() => setSelectedPeriod(period)}
                  className={`px-3 py-2 rounded-lg ${
                    selectedPeriod === period 
                      ? "bg-blue-500/20 border border-blue-400/30" 
                      : "bg-transparent"
                  }`}>
                  <Text
                    className={`text-sm font-medium ${
                      selectedPeriod === period ? "text-blue-400" : "text-gray-400"
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
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">Day High</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  ${stockData.dayHigh?.toFixed(2)}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">Day Low</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  ${stockData.dayLow?.toFixed(2)}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">52W High</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  ${stockData.yearHigh?.toFixed(2)}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">52W Low</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  ${stockData.yearLow?.toFixed(2)}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">Volume</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  {stockData.volume}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">Avg Volume</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  {stockData.avgVolume}
                </Text>
              </View>
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
            <View className="flex-row items-center mb-4">
              <View className="bg-blue-500/20 px-3 py-1 rounded-full mr-3 border border-blue-400/30">
                <Text className="text-blue-400 text-sm font-medium">
                  {stockData.sector}
                </Text>
              </View>
              <View className="bg-gray-700/60 px-3 py-1 rounded-full border border-gray-600/30">
                <Text className="text-gray-300 text-sm font-medium">
                  {stockData.industry}
                </Text>
              </View>
            </View>
            <Text className="text-gray-300 leading-7 mb-6 font-medium">
              {stockData.description}
            </Text>

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
    </ScrollView>
  );

  const renderAnalyticsTab = () => (
    <ScrollView 
      className="flex-1 px-5" 
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}
    >
      {/* Price Target Alert */}
      <View className="mb-8">
        <AppStoreCard variant="compact">
          <View className="p-6">
            <View className="flex-row items-center">
              <View className="bg-blue-500 rounded-full p-2 mr-4">
                <Ionicons name="information" size={16} color="#fff" />
              </View>
              <Text className="text-gray-300 flex-1 font-medium leading-6">
                Average price target is{" "}
                {(
                  ((stockData.priceTarget?.average || stockData.price) /
                    stockData.price) *
                    100 -
                  100
                ).toFixed(1)}
                % from the last close price, within the monthly volatility of{" "}
                {stockData.priceTarget?.volatility?.toFixed(1)}%.
              </Text>
            </View>
          </View>
        </AppStoreCard>
      </View>

      {/* Analyst Recommendations */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <Text className="text-white text-xl font-bold tracking-tight mb-6">
              Analyst Recommendations
            </Text>

            {/* Recommendations Chart */}
            <View className="flex-row justify-between items-end h-32 mb-4">
              {Object.entries(stockData.analystRecommendations || {}).map(
                ([category, count], index) => {
                  const maxCount = Math.max(
                    ...Object.values(stockData.analystRecommendations || {})
                  );
                  const height = (count / maxCount) * 100;

                  return (
                    <View key={category} className="flex-1 items-center mx-1">
                      <View className="w-full flex-col justify-end h-full">
                        <View
                          className="bg-gradient-to-t from-blue-500 to-blue-400 w-full rounded-t-lg mb-1 shadow-lg"
                          style={{ height: `${height}%` }}
                        />
                      </View>
                      <Text className="text-xs text-gray-400 text-center mt-2 font-medium">
                        {category.replace(/([A-Z])/g, " $1").trim()}
                      </Text>
                      <Text className="text-xs text-white font-bold">
                        {count}
                      </Text>
                    </View>
                  );
                }
              )}
            </View>
          </View>
        </AppStoreCard>
      </View>

      {/* Beta */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <Text className="text-white text-xl font-bold tracking-tight mb-4">Beta</Text>
            <Text className="text-white text-3xl font-black tracking-tight mb-2">
              {stockData.beta?.toFixed(2)}
            </Text>
            <Text className="text-gray-400 font-medium">
              {(stockData.beta || 0) > 1
                ? "More volatile than market"
                : "Less volatile than market"}
            </Text>
          </View>
        </AppStoreCard>
      </View>
    </ScrollView>
  );

  const renderFinancialsTab = () => (
    <ScrollView 
      className="flex-1 px-5" 
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}
    >
      {/* Key Metrics */}
      <View className="mb-8">
        <Text className="text-white text-xl font-bold tracking-tight mb-6 px-2">
          Key Metrics
        </Text>
        <View className="flex-row flex-wrap justify-between">
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">Market Cap</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.marketCap}
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">Enterprise Value</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.enterpriseValue}
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">P/E Ratio</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.peRatio}
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">EV / EBITDA</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.evEbitda}
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">Dividend Yield</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.dividendYield}
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">EPS (TTM)</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.eps}
                </Text>
              </View>
            </AppStoreCard>
          </View>
        </View>
      </View>

      {/* Events */}
      <View className="mb-8">
        <Text className="text-white text-xl font-bold tracking-tight mb-6 px-2">
          Upcoming Events
        </Text>
        <AppStoreCard variant="featured">
          <View className="p-0">
            {(stockData.events || []).map((event, index) => (
              <View
                key={index}
                className={`p-6 flex-row justify-between items-center ${
                  index > 0 ? "border-t border-gray-700/50" : ""
                }`}>
                <Text className="text-white font-bold tracking-wide">{event.date}</Text>
                <Text className="text-gray-300 flex-1 ml-4 font-medium">{event.event}</Text>
              </View>
            ))}
          </View>
        </AppStoreCard>
      </View>

      {/* Earnings */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-white text-xl font-bold tracking-tight">Earnings</Text>
              <View className="bg-purple-500/20 px-3 py-1 rounded-full border border-purple-400/30">
                <Text className="text-purple-400 text-sm font-medium">Summary</Text>
              </View>
            </View>
            <Text className="text-gray-400 text-sm font-medium mb-2">
              {stockData.earnings?.quarter}
            </Text>
            <Text className="text-gray-300 leading-7 font-medium">
              {stockData.earnings?.summary}
            </Text>
          </View>
        </AppStoreCard>
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView className="flex-1 bg-black">
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Subtle background gradient */}
      <View className="absolute inset-0 bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/10" />

      {/* Header */}
      <View className="bg-black/95 backdrop-blur-xl pt-4 pb-4 px-6 border-b border-gray-800/50">
        <View className="flex-row items-center justify-between mb-6">
          <Pressable 
            onPress={handleBack} 
            className="w-10 h-10 bg-gray-800/60 rounded-2xl flex items-center justify-center border border-gray-700/30"
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View className="flex-row items-center">
            <Pressable className="w-10 h-10 bg-gray-800/60 rounded-2xl flex items-center justify-center mr-3 border border-gray-700/30">
              <Ionicons name="heart-outline" size={20} color="#EF4444" />
            </Pressable>
            <Pressable className="w-10 h-10 bg-gray-800/60 rounded-2xl flex items-center justify-center border border-gray-700/30">
              <Ionicons name="share-outline" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Stock Info */}
        <View className="flex-row items-center mb-6">
          <View className="flex-1">
            <Text className="text-gray-400 text-sm font-medium">
              {stockData.companyName}
            </Text>
            <Text className="text-white text-3xl font-black tracking-tight mt-1">
              {stockData.ticker}
            </Text>
            <Text className="text-gray-400 text-sm font-medium mt-1">{stockData.sector}</Text>
          </View>
          <View className="items-end">
            <Text className="text-white text-3xl font-black tracking-tight">
              ${stockData.price.toFixed(2)}
            </Text>
            <View className="flex-row items-center mt-1">
              <Ionicons
                name={stockData.change >= 0 ? "triangle" : "triangle"}
                size={12}
                color={stockData.change >= 0 ? "#22C55E" : "#EF4444"}
                style={{
                  transform: [
                    { rotate: stockData.change >= 0 ? "0deg" : "180deg" },
                  ],
                }}
              />
              <Text
                className={`ml-2 font-bold tracking-wide ${
                  stockData.change >= 0 ? "text-green-400" : "text-red-400"
                }`}>
                {stockData.change >= 0 ? "+" : ""}
                {stockData.change.toFixed(2)} (
                {stockData.changePercent.toFixed(2)}%)
              </Text>
            </View>
          </View>
        </View>

        {/* Tabs */}
        <View className="flex-row justify-around border-b border-gray-700/50">
          {renderTabButton("Summary")}
          {renderTabButton("Analytics")}
          {renderTabButton("Financials")}
        </View>
      </View>

      {/* Tab Content */}
      <View className="flex-1">
        {activeTab === "Summary" && renderSummaryTab()}
        {activeTab === "Analytics" && renderAnalyticsTab()}
        {activeTab === "Financials" && renderFinancialsTab()}
      </View>
    </SafeAreaView>
  );
}