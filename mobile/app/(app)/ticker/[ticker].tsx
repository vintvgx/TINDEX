import type React from "react";
import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StatusBar,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useTickerQuery } from "@/hooks/queries/ticker/useTickerQuery";
import { useBaseNavigation } from "@/hooks/navigation/useBaseNavigation";
import { SummaryTab } from "@/common/components/ticker/SummaryTab";
import { AnalyticsTab } from "@/common/components/ticker/AnalyticsTab";
import { FinancialsTab } from "@/common/components/ticker/FinancialsTab";
import { StockInfoHeader } from "@/common/components/ticker/StockInfoHeader";
import { TabNavigation } from "@/common/components/ticker/TabNavigation";
import { OptionsCard } from "@/common/components/ticker/OptionsTab";

export default function TickerScreen() {
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  console.log("[ticker] TICKER", ticker);
  
  // State to control cache usage - when false, forces fresh data fetch
  const [useCache, setUseCache] = useState(true);
  // Track if we're in a refresh cycle to properly reset useCache after completion
  const isRefreshingRef = useRef(false);
  
  const {
    data: tickerResponse,
    isLoading,
    error,
  } = useTickerQuery(ticker || "", useCache);

  // Reset useCache to true after refresh completes (when loading finishes)
  useEffect(() => {
    if (!isLoading && isRefreshingRef.current && !useCache) {
      // Query completed, reset cache flag for future queries
      setUseCache(true);
      isRefreshingRef.current = false;
    }
  }, [isLoading, useCache]);

  const [activeTab, setActiveTab] = useState<
    "Summary" | "Analytics" | "Financials" | "Options"
  >("Summary");
  const [selectedPeriod, setSelectedPeriod] = useState("1D");

  const stockData = tickerResponse?.data;

  const { navigateBack } = useBaseNavigation();

  const handleBack = () => {
    navigateBack();
  };

  /**
   * Handles refresh action by bypassing cache and refetching ticker data.
   * Sets useCache to false, which triggers a new query with fresh data from backend.
   * React Query automatically refetches when the queryKey changes (useCache is part of it).
   * The useEffect hook will reset useCache to true after the query completes.
   */
  const handleRefetch = () => {
    if (isLoading) return; // Prevent multiple simultaneous refreshes
    
    // Mark that we're refreshing and set useCache to false
    isRefreshingRef.current = true;
    setUseCache(false);
    // React Query will automatically refetch when useCache changes (new queryKey)
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

  const renderSummaryTab = () => (
    <ScrollView
      className="flex-1 px-5"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}>
      <SummaryTab
        stockData={stockData}
        selectedPeriod={selectedPeriod}
        onPeriodChange={setSelectedPeriod}
      />
    </ScrollView>
  );

  const renderAnalyticsTab = () => (
    <ScrollView
      className="flex-1 px-5"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}>
      <AnalyticsTab stockData={stockData} />
    </ScrollView>
  );

  const renderFinancialsTab = () => (
    <ScrollView
      className="flex-1 px-5"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}>
      <FinancialsTab stockData={stockData} />
    </ScrollView>
  );

  const renderOptionsTab = () => {
    const optionsData = stockData?.options_analysis;

    if (
      !optionsData?.has_opportunities ||
      !optionsData?.opportunities?.length
    ) {
      return (
        <View className="flex-1 justify-center items-center px-8">
          <View className="bg-gray-900/50 rounded-3xl p-8 border border-gray-800/30">
            <Ionicons name="analytics-outline" size={48} color="#6B7280" />
            <Text className="mt-6 text-xl font-bold text-white text-center">
              No Options Available
            </Text>
            <Text className="mt-2 text-sm text-gray-400 text-center leading-6">
              {stockData?.has_options === false
                ? "This ticker does not have options trading available."
                : "No options opportunities found at this time."}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}>
        {optionsData.opportunities.map((option, index) => (
          <OptionsCard key={option.contractSymbol || index} option={option} />
        ))}
      </ScrollView>
    );
  };

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
            className="w-10 h-10 bg-gray-800/60 rounded-2xl flex items-center justify-center border border-gray-700/30">
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View className="flex-row items-center">
          <Pressable 
            className="w-10 h-10 bg-gray-800/60 rounded-2xl flex items-center justify-center mr-3 border border-gray-700/30"
            onPress={handleRefetch}
            disabled={isLoading}
          >
              <Ionicons 
                name={isLoading ? "hourglass-outline" : "refresh-circle-outline"} 
                size={20} 
                color={isLoading ? "#6B7280" : "#44efef"} 
              />
            </Pressable>
            <Pressable className="w-10 h-10 bg-gray-800/60 rounded-2xl flex items-center justify-center mr-3 border border-gray-700/30">
              <Ionicons name="heart-outline" size={20} color="#EF4444" />
            </Pressable>
            <Pressable className="w-10 h-10 bg-gray-800/60 rounded-2xl flex items-center justify-center border border-gray-700/30">
              <Ionicons name="share-outline" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Stock Info */}
        <StockInfoHeader stockData={stockData} />

        {/* Tab Navigation */}
        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
      </View>

      {/* Tab Content */}
      <View className="flex-1">
        {activeTab === "Summary" && renderSummaryTab()}
        {activeTab === "Analytics" && renderAnalyticsTab()}
        {activeTab === "Financials" && renderFinancialsTab()}
        {activeTab === "Options" && renderOptionsTab()}
      </View>
    </SafeAreaView>
  );
}
