"use client"

import type React from "react"
import { View, Text, ScrollView, ActivityIndicator } from "react-native"
import { AppStoreCard } from "@/components/ui/AppStoreCard"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { ChevronDown } from "lucide-react-native"

interface Stock {
  ticker: string
  company: string
  price: string
  change: string
  volume: string
}

interface TrendingStocksCardProps {
  stocks?: { data: Stock[] }
  isLoading: boolean
  error: any
  selectedSortBy: "volume" | "change" | "pe" | "marketcap"
  onSortChange: (sortBy: "volume" | "change" | "pe" | "marketcap") => void
  isQueryClientReady: boolean
}

const sortOptions = [
  { value: "volume", label: "Volume" },
  { value: "change", label: "Change" },
  { value: "pe", label: "P/E Ratio" },
  { value: "marketcap", label: "Market Cap" },
]

export const TrendingStocksCard: React.FC<TrendingStocksCardProps> = ({
  stocks,
  isLoading,
  error,
  selectedSortBy,
  onSortChange,
  isQueryClientReady,
}) => {
  const selectedOption = sortOptions.find((option) => option.value === selectedSortBy)

  if (!isQueryClientReady) {
    return (
      <View className="mx-4 mb-6 fixed sticky">
        <AppStoreCard variant="compact">
          <View className="p-6">
            <Text className="text-white text-lg font-bold mb-4">Trending Stocks</Text>
            <View className="flex-row items-center">
              <ActivityIndicator size="small" color="#007AFF" />
              <Text className="ml-3 text-gray-400 font-medium">Initializing...</Text>
            </View>
          </View>
        </AppStoreCard>
      </View>
    )
  }

  if (isLoading) {
    return (
      <View className="mx-4 mb-6">
        <AppStoreCard variant="compact">
          <View className="p-6">
            <Text className="text-white text-lg font-bold mb-4">Trending Stocks</Text>
            <ActivityIndicator size="small" color="#007AFF" />
          </View>
        </AppStoreCard>
      </View>
    )
  }

  if (error) {
    return (
      <View className="mx-4 mb-6">
        <AppStoreCard variant="compact">
          <View className="p-6">
            <Text className="text-white text-lg font-bold mb-4">Trending Stocks</Text>
            <Text className="text-red-400 font-medium">Failed to load trending stocks</Text>
          </View>
        </AppStoreCard>
      </View>
    )
  }

  if (!stocks?.data) {
    return null
  }

  return (
    <View className="mx-4 mb-6">
      <AppStoreCard variant="featured">
        <View className="p-6">
          {/* Header with title and dropdown */}
          <View className="flex-row justify-between items-center mb-6">
            <View>
              <Text className="text-white text-lg font-bold">Trending Stocks</Text>
              <Text className="text-gray-400 text-sm mt-1">Market leaders by {selectedSortBy}</Text>
            </View>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <View className="bg-gray-800 px-4 py-2.5 rounded-xl flex-row items-center justify-between min-w-[120px] border border-gray-700">
                  <Text className="text-white font-medium text-sm">{selectedOption?.label || "Sort by"}</Text>
                  <Icon as={ChevronDown} className="text-gray-400 ml-2 size-4" />
                </View>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-48 bg-gray-900 border-gray-700">
                {sortOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onPress={() => onSortChange(option.value as any)}
                    className={`${
                      selectedSortBy === option.value ? "bg-blue-600/20" : ""
                    }`}
                  >
                    <Text
                      className={`${
                        selectedSortBy === option.value ? "text-blue-400" : "text-white"
                      }`}
                    >
                      {option.label}
                    </Text>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </View>

          {/* Stocks horizontal scroll */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 24 }}>
            {stocks.data.slice(0, 5).map((stock, index) => (
              <View key={stock.ticker} className="bg-gray-800 p-4 rounded-xl mr-4 min-w-[160px] border border-gray-700">
                <View className="flex-row justify-between items-start mb-2">
                  <Text className="font-bold text-white text-base">{stock.ticker}</Text>
                  <View className="w-2 h-2 bg-blue-500 rounded-full" />
                </View>

                <Text className="text-xs text-gray-400 mb-3 leading-4" numberOfLines={2}>
                  {stock.company}
                </Text>

                <View className="space-y-1">
                  <Text className="text-xl font-bold text-white">${stock.price}</Text>
                  <Text
                    className={`text-sm font-semibold ${
                      stock.change.startsWith("+") || !stock.change.startsWith("-") ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {stock.change}
                  </Text>
                  <Text className="text-xs text-gray-500 mt-2">Vol: {stock.volume}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </AppStoreCard>
    </View>
  )
}
