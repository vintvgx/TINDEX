"use client"

import type React from "react"
import { useState } from "react"
import { View, Text, ScrollView, Pressable, StatusBar, Dimensions, ActivityIndicator } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LineChart } from "react-native-chart-kit"
import { useLocalSearchParams, router } from "expo-router"
import { useTickerQuery } from "@/hooks/queries/ticker/useTickerQuery"

const { width } = Dimensions.get("window")

export default function TickerScreen() {
  const { ticker } = useLocalSearchParams<{ ticker: string }>()
  console.log("[ticker] TICKER", ticker)
  const { data: tickerResponse, isLoading, error } = useTickerQuery(ticker || '')
  
  const [activeTab, setActiveTab] = useState<"Summary" | "Analytics" | "Financials">("Summary")
  const [selectedPeriod, setSelectedPeriod] = useState("1D")

  const periods = ["1D", "1W", "1M", "YTD", "1Y", "5Y", "Max"]

  const stockData = tickerResponse?.data

  const handleBack = () => {
    console.log("Back button pressed [ticker]")
    router.back()
  }

  // Loading state
  if (isLoading || !stockData) {
    return (
      <View className="flex-1 bg-gray-50 justify-center items-center">
        <ActivityIndicator size="large" color="#007AFF" />
        <Text className="mt-4 text-gray-600">Loading {ticker}...</Text>
      </View>
    )
  }

  // Error state
  if (error) {
    return (
      <View className="flex-1 bg-gray-50 justify-center items-center px-4">
        <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
        <Text className="mt-4 text-red-600 text-lg font-semibold">Error loading ticker data</Text>
        <Text className="mt-2 text-gray-600 text-center">
          {error instanceof Error ? error.message : 'Something went wrong'}
        </Text>
        <Pressable 
          onPress={handleBack}
          className="mt-6 bg-blue-500 px-6 py-3 rounded-lg"
        >
          <Text className="text-white font-semibold">Go Back</Text>
        </Pressable>
      </View>
    )
  }

  // Chart data from API or fallback
  const chartData = stockData.chartData ? {
    labels: stockData.chartData.labels,
    datasets: [{
      data: stockData.chartData.prices,
      color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
      strokeWidth: 2,
    }],
  } : {
    labels: ["Sep 19", "Sep 20", "Sep 21", "Sep 22", "Sep 23"],
    datasets: [{
      data: [stockData.price * 0.98, stockData.price * 1.02, stockData.price * 0.99, stockData.price * 1.01, stockData.price],
      color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
      strokeWidth: 2,
    }],
  }

  const renderTabButton = (tab: "Summary" | "Analytics" | "Financials") => (
    <Pressable
      onPress={() => setActiveTab(tab)}
      className={`px-4 py-2 ${activeTab === tab ? "border-b-2 border-black" : ""}`}
    >
      <Text className={`text-lg font-medium ${activeTab === tab ? "text-black" : "text-gray-500"}`}>{tab}</Text>
    </Pressable>
  )

  const renderSummaryTab = () => (
    <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
      {/* Chart Section */}
      <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
        <LineChart
          data={chartData}
          width={width - 60}
          height={200}
          chartConfig={{
            backgroundColor: "#ffffff",
            backgroundGradientFrom: "#ffffff",
            backgroundGradientTo: "#ffffff",
            decimalPlaces: 2,
            color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
            labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
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
        <View className="flex-row justify-between mt-4">
          {periods.map((period) => (
            <Pressable
              key={period}
              onPress={() => setSelectedPeriod(period)}
              className={`px-3 py-2 rounded-lg ${selectedPeriod === period ? "bg-gray-200" : "bg-transparent"}`}
            >
              <Text className={`text-sm font-medium ${selectedPeriod === period ? "text-black" : "text-gray-600"}`}>
                {period}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Key Stats */}
      <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
        <Text className="text-xl font-bold text-gray-900 mb-4">Key Statistics</Text>
        <View className="flex-row flex-wrap justify-between">
          <View className="w-[48%] mb-3">
            <Text className="text-gray-600 text-sm">Day High</Text>
            <Text className="text-black text-lg font-bold">${stockData.dayHigh?.toFixed(2)}</Text>
          </View>
          <View className="w-[48%] mb-3">
            <Text className="text-gray-600 text-sm">Day Low</Text>
            <Text className="text-black text-lg font-bold">${stockData.dayLow?.toFixed(2)}</Text>
          </View>
          <View className="w-[48%] mb-3">
            <Text className="text-gray-600 text-sm">52W High</Text>
            <Text className="text-black text-lg font-bold">${stockData.yearHigh?.toFixed(2)}</Text>
          </View>
          <View className="w-[48%] mb-3">
            <Text className="text-gray-600 text-sm">52W Low</Text>
            <Text className="text-black text-lg font-bold">${stockData.yearLow?.toFixed(2)}</Text>
          </View>
          <View className="w-[48%] mb-3">
            <Text className="text-gray-600 text-sm">Volume</Text>
            <Text className="text-black text-lg font-bold">{stockData.volume}</Text>
          </View>
          <View className="w-[48%] mb-3">
            <Text className="text-gray-600 text-sm">Avg Volume</Text>
            <Text className="text-black text-lg font-bold">{stockData.avgVolume}</Text>
          </View>
        </View>
      </View>

      {/* About Section */}
      <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
        <Text className="text-xl font-bold text-gray-900 mb-3">About {stockData.ticker}</Text>
        <View className="flex-row items-center mb-3">
          <View className="bg-blue-100 px-3 py-1 rounded-full mr-2">
            <Text className="text-blue-700 text-sm font-medium">{stockData.sector}</Text>
          </View>
          <View className="bg-gray-100 px-3 py-1 rounded-full">
            <Text className="text-gray-700 text-sm font-medium">{stockData.industry}</Text>
          </View>
        </View>
        <Text className="text-gray-700 leading-6 mb-4">
          {stockData.description}
        </Text>

        {/* Action Buttons */}
        <View className="flex-row justify-between">
          <Pressable className="flex-1 bg-green-100 border-2 border-green-300 rounded-full py-3 mr-2">
            <Text className="text-green-700 font-semibold text-center">Bull Case</Text>
          </Pressable>
          <Pressable className="flex-1 bg-orange-100 border-2 border-orange-300 rounded-full py-3 mx-1">
            <Text className="text-orange-700 font-semibold text-center">Bear Case</Text>
          </Pressable>
          <Pressable className="flex-1 bg-purple-100 border-2 border-purple-300 rounded-full py-3 ml-2">
            <Text className="text-purple-700 font-semibold text-center">Ask Claire</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  )

  const renderAnalyticsTab = () => (
    <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
      {/* Price Target Alert */}
      <View className="bg-gray-100 rounded-2xl p-4 mb-4">
        <View className="flex-row items-center">
          <View className="bg-gray-400 rounded-full p-2 mr-3">
            <Text className="text-white font-bold text-xs">i</Text>
          </View>
          <Text className="text-gray-800 flex-1">
            Average price target is {((stockData.priceTarget?.average || stockData.price) / stockData.price * 100 - 100).toFixed(1)}% 
            {' '}from the last close price, within the monthly volatility of {stockData.priceTarget?.volatility?.toFixed(1)}%.
          </Text>
        </View>
      </View>

      {/* Analyst Recommendations */}
      <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
        <Text className="text-xl font-bold text-gray-900 mb-4">Analyst Recommendations</Text>
        
        {/* Recommendations Chart */}
        <View className="flex-row justify-between items-end h-32 mb-4">
          {Object.entries(stockData.analystRecommendations || {}).map(([category, count], index) => {
            const maxCount = Math.max(...Object.values(stockData.analystRecommendations || {}))
            const height = (count / maxCount) * 100
            
            return (
              <View key={category} className="flex-1 items-center mx-1">
                <View className="w-full flex-col justify-end h-full">
                  <View 
                    className="bg-blue-400 w-full rounded-t-md mb-1" 
                    style={{ height: `${height}%` }}
                  />
                </View>
                <Text className="text-xs text-gray-600 text-center mt-2">
                  {category.replace(/([A-Z])/g, ' $1').trim()}
                </Text>
                <Text className="text-xs text-gray-800 font-bold">{count}</Text>
              </View>
            )
          })}
        </View>
      </View>

      {/* Beta */}
      <View className="bg-white rounded-2xl p-4 mb-6 shadow-sm">
        <Text className="text-xl font-bold text-gray-900 mb-4">Beta</Text>
        <Text className="text-3xl font-bold text-black mb-2">{stockData.beta?.toFixed(2)}</Text>
        <Text className="text-gray-600">
          {(stockData.beta || 0) > 1 ? 'More volatile than market' : 'Less volatile than market'}
        </Text>
      </View>
    </ScrollView>
  )

  const renderFinancialsTab = () => (
    <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
      {/* Key Metrics */}
      <View className="mb-6">
        <Text className="text-xl font-bold text-gray-900 mb-4">Key Metrics</Text>
        <View className="flex-row flex-wrap justify-between">
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">Market Cap</Text>
            <Text className="text-black text-lg font-bold">{stockData.marketCap}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">Enterprise Value</Text>
            <Text className="text-black text-lg font-bold">{stockData.enterpriseValue}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">P/E Ratio</Text>
            <Text className="text-black text-lg font-bold">{stockData.peRatio}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">EV / EBITDA</Text>
            <Text className="text-black text-lg font-bold">{stockData.evEbitda}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">Dividend Yield</Text>
            <Text className="text-black text-lg font-bold">{stockData.dividendYield}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">EPS (TTM)</Text>
            <Text className="text-black text-lg font-bold">{stockData.eps}</Text>
          </View>
        </View>
      </View>

      {/* Events */}
      <View className="mb-6">
        <Text className="text-xl font-bold text-gray-900 mb-4">Upcoming Events</Text>
        <View className="bg-white rounded-2xl shadow-sm">
          {(stockData.events || []).map((event, index) => (
            <View
              key={index}
              className={`p-4 flex-row justify-between items-center ${index > 0 ? "border-t border-gray-100" : ""}`}
            >
              <Text className="text-gray-900 font-medium">{event.date}</Text>
              <Text className="text-gray-700 flex-1 ml-4">{event.event}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Earnings */}
      <View className="mb-6">
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-xl font-bold text-gray-900">Earnings</Text>
          <View className="bg-purple-100 px-3 py-1 rounded-full">
            <Text className="text-purple-700 text-sm font-medium">Summary</Text>
          </View>
        </View>
        <Text className="text-gray-600 text-sm mb-2">{stockData.earnings?.quarter}</Text>
        <Text className="text-gray-800 leading-6 mb-4">
          {stockData.earnings?.summary}
        </Text>
      </View>
    </ScrollView>
  )

  return (
    <View className="flex-1 bg-gray-50">
      <StatusBar barStyle="dark-content" backgroundColor="#F9FAFB" />

      {/* Header */}
      <View className="bg-white pt-12 pb-4 px-4 shadow-sm">
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={handleBack} className="p-2">
            <Ionicons name="arrow-back" size={24} color="#000" />
          </Pressable>
          <View className="flex-row items-center">
            <Pressable className="p-2 mr-2">
              <Ionicons name="heart-outline" size={24} color="#EF4444" />
            </Pressable>
            <Pressable className="p-2">
              <Ionicons name="share-outline" size={24} color="#000" />
            </Pressable>
          </View>
        </View>

        {/* Stock Info */}
        <View className="flex-row items-center mb-4">
          <View className="flex-1">
            <Text className="text-gray-600 text-sm">{stockData.companyName}</Text>
            <Text className="text-black text-2xl font-bold">{stockData.ticker}</Text>
            <Text className="text-gray-600 text-sm">{stockData.sector}</Text>
          </View>
          <View className="items-end">
            <Text className="text-black text-2xl font-bold">${stockData.price.toFixed(2)}</Text>
            <View className="flex-row items-center">
              <Ionicons
                name={stockData.change >= 0 ? "triangle" : "triangle"}
                size={12}
                color={stockData.change >= 0 ? "#22C55E" : "#EF4444"}
                style={{ transform: [{ rotate: stockData.change >= 0 ? "0deg" : "180deg" }] }}
              />
              <Text className={`ml-1 font-medium ${stockData.change >= 0 ? "text-green-600" : "text-red-600"}`}>
                {stockData.change >= 0 ? '+' : ''}{stockData.change.toFixed(2)} ({stockData.changePercent.toFixed(2)}%)
              </Text>
            </View>
          </View>
        </View>

        {/* Tabs */}
        <View className="flex-row justify-around border-b border-gray-200">
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
    </View>
  )
} 