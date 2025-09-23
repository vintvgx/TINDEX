"use client"

import type React from "react"
import { useState } from "react"
import { View, Text, ScrollView, Pressable, StatusBar, Dimensions, Image } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LineChart } from "react-native-chart-kit"

interface StockData {
  ticker: string
  companyName: string
  price: number
  change: number
  changePercent: number
  sector: string
  logo?: string
  marketCap?: string
  enterpriseValue?: string
  peRatio?: string
  evEbitda?: string
  dividendYield?: string
  eps?: string
  description?: string
  analystRecommendations?: {
    strongSell: number
    sell: number
    hold: number
    buy: number
    strongBuy: number
  }
  priceTarget?: {
    average: number
    volatility: number
  }
  events?: Array<{
    date: string
    event: string
  }>
  earnings?: {
    quarter: string
    summary: string
  }
}

interface TickerViewProps {
  stockData: StockData
  onBack: () => void
}

const { width } = Dimensions.get("window")

export const TickerView: React.FC<TickerViewProps> = ({ stockData, onBack }) => {
  const [activeTab, setActiveTab] = useState<"Summary" | "Analytics" | "Financials">("Summary")
  const [selectedPeriod, setSelectedPeriod] = useState("1D")

  const periods = ["1D", "1W", "1M", "YTD", "1Y", "5Y", "Max"]

  // Sample chart data - replace with real data
  const chartData = {
    labels: ["Sep 17", "Sep 18", "Sep 19", "Sep 22"],
    datasets: [
      {
        data: [52, 54, 57, 58.81],
        color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
        strokeWidth: 2,
      },
    ],
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

      {/* Move Alert */}
      <Pressable className="bg-orange-50 rounded-2xl p-4 mb-4 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View className="bg-orange-500 rounded-full p-2 mr-3">
            <Text className="text-white font-bold text-xs">!</Text>
          </View>
          <Text className="text-lg font-medium text-gray-900">Move Alert</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#6B7280" />
      </Pressable>

      {/* About Section */}
      <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-xl font-bold text-gray-900">About {stockData.ticker}</Text>
          <View className="bg-purple-100 px-3 py-1 rounded-full">
            <Text className="text-purple-700 text-sm font-medium">Recent IPO</Text>
          </View>
        </View>
        <Text className="text-gray-700 leading-6 mb-4">
          {stockData.description ||
            `${stockData.companyName} is a dynamic player in the ${stockData.sector} sector, serving as a digital canvas for creativity and innovation. The company offers a platform that empowers teams to collaborate and create innovative solutions.`}
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

      {/* Socials Section */}
      <View className="bg-white rounded-2xl p-4 mb-6 shadow-sm">
        <View className="flex-row justify-between items-center">
          <Text className="text-xl font-bold text-gray-900">Socials</Text>
          <Pressable className="bg-teal-100 rounded-full p-2">
            <Ionicons name="add" size={20} color="#0D9488" />
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
            <Text className="text-white font-bold text-xs">-</Text>
          </View>
          <Text className="text-gray-800 flex-1">
            Average price target is {stockData.priceTarget?.average || 34.2}% above the last close price, within the
            monthly volatility of {stockData.priceTarget?.volatility || 37.6}%.
          </Text>
        </View>
      </View>

      {/* Analyst Recommendations */}
      <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-xl font-bold text-gray-900">Analyst Recommendations</Text>
          <View className="flex-row bg-gray-200 rounded-full p-1">
            <Pressable className="bg-white rounded-full px-3 py-1">
              <Text className="text-sm font-medium">%</Text>
            </Pressable>
            <Pressable className="px-3 py-1">
              <Text className="text-sm font-medium text-gray-600">#</Text>
            </Pressable>
          </View>
        </View>

        {/* Legend */}
        <View className="flex-row justify-between mb-4">
          <View className="flex-row items-center">
            <View className="w-3 h-3 bg-purple-300 rounded-full mr-2" />
            <Text className="text-sm text-gray-600">Previous 3 Months</Text>
          </View>
          <View className="flex-row items-center">
            <View className="w-3 h-3 bg-blue-400 rounded-full mr-2" />
            <Text className="text-sm text-gray-600">Last 3 Months</Text>
          </View>
          <View className="flex-row items-center">
            <View className="w-3 h-3 bg-gray-300 rounded-full mr-2" />
            <Text className="text-sm text-gray-600">Average</Text>
          </View>
        </View>

        {/* Chart */}
        <View className="flex-row justify-between items-end h-32 mb-4">
          {["Strong Sell", "Sell", "Hold", "Buy", "Strong Buy"].map((category, index) => (
            <View key={category} className="flex-1 items-center">
              <View className="w-full flex-col justify-end h-full">
                {index === 2 && <View className="bg-blue-400 w-full h-24 rounded-t-md mb-1" />}
              </View>
              <Text className="text-xs text-gray-600 text-center mt-2 transform -rotate-45">{category}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Summary Alert */}
      <View className="bg-gray-100 rounded-2xl p-4 mb-4">
        <View className="flex-row items-center">
          <View className="bg-gray-400 rounded-full p-2 mr-3">
            <Text className="text-white font-bold text-xs">-</Text>
          </View>
          <Text className="text-gray-800 flex-1">Analyst recommendations do not have a strong direction.</Text>
        </View>
      </View>

      {/* P/E Ratio Chart */}
      <View className="bg-white rounded-2xl p-4 mb-6 shadow-sm">
        <Text className="text-xl font-bold text-gray-900 mb-4">Price/Earnings Ratio</Text>
        <View className="h-32 justify-end">
          <View className="flex-row items-end h-full">
            <View className="bg-blue-400 w-8 h-20 rounded-t-md mr-2" />
            <View className="bg-blue-300 w-8 h-16 rounded-t-md mr-2" />
            <View className="bg-blue-200 w-8 h-12 rounded-t-md" />
          </View>
        </View>
        <View className="flex-row justify-between mt-2">
          <Text className="text-sm text-gray-600">0x</Text>
          <Text className="text-sm text-gray-600">400x</Text>
        </View>
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
            <Text className="text-black text-lg font-bold">{stockData.marketCap || "27.69B"}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">Enterprise Value</Text>
            <Text className="text-black text-lg font-bold">{stockData.enterpriseValue || "62.26B"}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">P/E Ratio</Text>
            <Text className="text-black text-lg font-bold">{stockData.peRatio || "302.10x"}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">EV / EBITDA</Text>
            <Text className="text-black text-lg font-bold">{stockData.evEbitda || "446.71x"}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">Dividend Yield</Text>
            <Text className="text-black text-lg font-bold">{stockData.dividendYield || "0.00%"}</Text>
          </View>
          <View className="bg-gray-100 rounded-2xl p-4 w-[48%] mb-3">
            <Text className="text-gray-600 text-sm mb-1">EPS (TTM)</Text>
            <Text className="text-black text-lg font-bold">{stockData.eps || "-"}</Text>
          </View>
        </View>
      </View>

      {/* Events */}
      <View className="mb-6">
        <Text className="text-xl font-bold text-gray-900 mb-4">Events</Text>
        <View className="bg-white rounded-2xl shadow-sm">
          {(
            stockData.events || [
              { date: "9/2/25", event: "Q2 2025 Earnings Release" },
              { date: "12/2/25", event: "Q3 2025 Earnings Release" },
            ]
          ).map((event, index) => (
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
        <Text className="text-gray-600 text-sm mb-2">{stockData.earnings?.quarter || "Q2 '25"}</Text>
        <Text className="text-gray-800 leading-6 mb-4">
          {stockData.earnings?.summary ||
            "Figma's Q2 2025 results reveal strong growth and ambitious AI-driven strategies amidst looming execution risks and international expansion challenges."}
        </Text>
      </View>

      {/* Income Statement */}
      <View className="mb-6">
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-xl font-bold text-gray-900">Income Statement</Text>
          <View className="flex-row bg-gray-200 rounded-full p-1">
            <Pressable className="bg-blue-400 rounded-full px-3 py-1">
              <Text className="text-white text-sm font-medium">Data</Text>
            </Pressable>
            <Pressable className="px-3 py-1">
              <Text className="text-gray-600 text-sm font-medium">Summary</Text>
            </Pressable>
          </View>
        </View>
        <Text className="text-gray-600 text-sm">Q2 | 25</Text>
      </View>
    </ScrollView>
  )

  return (
    <View className="flex-1 bg-gray-50">
      <StatusBar barStyle="dark-content" backgroundColor="#F9FAFB" />

      {/* Header */}
      <View className="bg-white pt-12 pb-4 px-4 shadow-sm">
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={onBack} className="p-2">
            <Ionicons name="arrow-back" size={24} color="#000" />
          </Pressable>
          <View className="flex-row items-center">
            <Pressable className="p-2 mr-2">
              <Ionicons name="heart-outline" size={24} color="#EF4444" />
            </Pressable>
            <Pressable className="p-2">
              <Ionicons name="filter" size={24} color="#000" />
            </Pressable>
          </View>
        </View>

        {/* Stock Info */}
        <View className="flex-row items-center mb-4">
          {stockData.logo && <Image source={{ uri: stockData.logo }} className="w-12 h-12 rounded-lg mr-4" />}
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
                +{stockData.change.toFixed(2)} ({stockData.changePercent.toFixed(2)}%)
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
