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
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LineChart } from "react-native-chart-kit";
import { useLocalSearchParams } from "expo-router";
import { useTickerQuery } from "@/hooks/queries/ticker/useTickerQuery";
import { useBaseNavigation } from "@/hooks/navigation/useBaseNavigation";
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

  // Chart data from API
  const chartData = stockData.historical_data
    ? {
        labels: stockData.historical_data.dates.map(date => 
          new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        ),
        datasets: [
          {
            data: stockData.historical_data.prices,
            color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
            strokeWidth: 2,
          },
        ],
      }
    : null; // No fallback data - will show "No chart data available" message

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
                  ${stockData.day_high.toFixed(2)}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">Day Low</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  ${stockData.day_low.toFixed(2)}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">52W High</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  ${stockData.year_high.toFixed(2)}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">52W Low</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  ${stockData.year_low.toFixed(2)}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">Volume</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  {stockData.volume.toLocaleString()}
                </Text>
              </View>
              <View className="w-[48%] mb-4">
                <Text className="text-gray-400 text-sm font-medium">Avg Volume</Text>
                <Text className="text-white text-lg font-bold tracking-tight mt-1">
                  {stockData.average_volume.toLocaleString()}
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
      {/* Sentiment Analysis */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <Text className="text-white text-xl font-bold tracking-tight mb-6">
              Sentiment Analysis
            </Text>

            {/* Sentiment Display */}
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-1">
                <Text className="text-gray-400 text-sm font-medium mb-2">Sentiment</Text>
                <Text className={`text-2xl font-bold ${
                  stockData.sentiment.sentiment === 'bullish' ? 'text-green-400' :
                  stockData.sentiment.sentiment === 'bearish' ? 'text-red-400' : 
                  'text-gray-400'
                }`}>
                  {stockData.sentiment.sentiment.toUpperCase()}
                </Text>
                <Text className="text-gray-400 text-sm">
                  Score: {stockData.sentiment_score} | Confidence: {stockData.sentiment_confidence}%
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-gray-400 text-sm font-medium mb-2">Beta</Text>
                <Text className="text-white text-2xl font-bold">
                  {stockData.beta.toFixed(2)}
                </Text>
                <Text className="text-gray-400 text-sm">
                  {stockData.beta > 1 ? "More volatile than market" : "Less volatile than market"}
                </Text>
              </View>
            </View>

            {/* Sentiment Factors */}
            <View className="mt-4 p-4 bg-gray-800/30 rounded-xl">
              <Text className="text-gray-300 text-sm font-medium mb-2">Key Factors</Text>
              <View className="flex-row justify-between">
                <Text className="text-gray-400 text-xs">Price Movement: {stockData.sentiment.factors.price_movement}%</Text>
                <Text className="text-gray-400 text-xs">Beta: {stockData.sentiment.factors.beta}</Text>
                <Text className="text-gray-400 text-xs">P/E: {stockData.sentiment.factors.pe_ratio || 'N/A'}</Text>
              </View>
            </View>
          </View>
        </AppStoreCard>
      </View>

      {/* Market State & Exchange */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-white text-xl font-bold tracking-tight">Market Info</Text>
              <View className={`px-3 py-1 rounded-full border ${
                stockData.market_state === 'OPEN' ? 'bg-green-500/20 border-green-400/30' :
                'bg-red-500/20 border-red-400/30'
              }`}>
                <Text className={`text-sm font-medium ${
                  stockData.market_state === 'OPEN' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {stockData.market_state}
                </Text>
              </View>
            </View>
            <View className="flex-row justify-between">
              <View>
                <Text className="text-gray-400 text-sm font-medium">Exchange</Text>
                <Text className="text-white text-lg font-bold">{stockData.exchange}</Text>
              </View>
              <View>
                <Text className="text-gray-400 text-sm font-medium">Country</Text>
                <Text className="text-white text-lg font-bold">{stockData.country}</Text>
              </View>
            </View>
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
                  ${(stockData.market_cap / 1000000).toFixed(1)}M
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">P/E Ratio</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.pe_ratio ? stockData.pe_ratio.toFixed(2) : 'N/A'}
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">Price to Book</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.price_to_book.toFixed(2)}
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">Dividend Yield</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.dividend_yield ? `${(stockData.dividend_yield * 100).toFixed(2)}%` : 'N/A'}
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">Profit Margins</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {(stockData.profit_margins * 100).toFixed(2)}%
                </Text>
              </View>
            </AppStoreCard>
          </View>
          <View className="w-[48%] mb-4">
            <AppStoreCard variant="compact">
              <View className="p-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">Employees</Text>
                <Text className="text-white text-lg font-bold tracking-tight">
                  {stockData.employees.toLocaleString()}
                </Text>
              </View>
            </AppStoreCard>
          </View>
        </View>
      </View>

      {/* News Data */}
      <View className="mb-8">
        <Text className="text-white text-xl font-bold tracking-tight mb-6 px-2">
          Latest News
        </Text>
        <AppStoreCard variant="featured">
          <View className="p-0">
            {stockData.news_data.slice(0, 3).map((news, index) => (
              <View
                key={news.id}
                className={`p-6 ${index > 0 ? "border-t border-gray-700/50" : ""}`}>
                <Text className="text-white font-bold tracking-wide mb-2">
                  {news.content.title}
                </Text>
                <Text className="text-gray-300 text-sm font-medium mb-2">
                  {news.content.summary}
                </Text>
                <View className="flex-row justify-between items-center">
                  <Text className="text-gray-400 text-xs">
                    {news.content.provider.displayName}
                  </Text>
                  <Text className="text-gray-400 text-xs">
                    {new Date(news.content.pubDate).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </AppStoreCard>
      </View>

      {/* Financial Growth */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-white text-xl font-bold tracking-tight">Growth Metrics</Text>
              <View className="bg-purple-500/20 px-3 py-1 rounded-full border border-purple-400/30">
                <Text className="text-purple-400 text-sm font-medium">Financials</Text>
              </View>
            </View>
            <View className="flex-row justify-between">
              <View className="flex-1 mr-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">Earnings Growth</Text>
                <Text className="text-white text-lg font-bold">
                  {stockData.earnings_growth ? `${(stockData.earnings_growth * 100).toFixed(2)}%` : 'N/A'}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-400 text-sm font-medium mb-1">Revenue Growth</Text>
                <Text className="text-white text-lg font-bold">
                  {stockData.revenue_growth ? `${(stockData.revenue_growth * 100).toFixed(2)}%` : 'N/A'}
                </Text>
              </View>
            </View>
            <View className="mt-4">
              <Text className="text-gray-400 text-sm font-medium mb-1">Return on Equity</Text>
              <Text className="text-white text-lg font-bold">
                {stockData.return_on_equity ? `${(stockData.return_on_equity * 100).toFixed(2)}%` : 'N/A'}
              </Text>
            </View>
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
            <View className="flex-row items-center mb-2">
              {stockData.logo_url && (
                <View className="w-8 h-8 rounded-lg bg-gray-800/50 mr-3 border border-gray-700/30 overflow-hidden">
                  <Image
                    source={{ uri: stockData.logo_url }}
                    className="w-full h-full"
                    resizeMode="contain"
                  />
                </View>
              )}
              <Text className="text-gray-400 text-sm font-medium">
                {stockData.company_name}
              </Text>
            </View>
            <Text className="text-white text-3xl font-black tracking-tight mt-1">
              {stockData.ticker}
            </Text>
            <Text className="text-gray-400 text-sm font-medium mt-1">{stockData.sector}</Text>
          </View>
          <View className="items-end">
            <Text className="text-white text-3xl font-black tracking-tight">
              ${stockData.current_price.toFixed(2)} {stockData.currency}
            </Text>
            <View className="flex-row items-center mt-1">
              <Ionicons
                name={stockData.price_change >= 0 ? "triangle" : "triangle"}
                size={12}
                color={stockData.price_change >= 0 ? "#22C55E" : "#EF4444"}
                style={{
                  transform: [
                    { rotate: stockData.price_change >= 0 ? "0deg" : "180deg" },
                  ],
                }}
              />
              <Text
                className={`ml-2 font-bold tracking-wide ${
                  stockData.price_change >= 0 ? "text-green-400" : "text-red-400"
                }`}>
                {stockData.price_change >= 0 ? "+" : ""}
                {stockData.price_change.toFixed(2)} (
                {stockData.price_change_percent.toFixed(2)}%)
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