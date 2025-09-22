import { MinimizedTrendingStocksProps } from "@/types/trending"
import type React from "react"
import { ScrollView, Text, View } from "react-native"


export const MinimizedTrendingStocks: React.FC<MinimizedTrendingStocksProps> = ({ stocks, isLoading, error }) => {
  if (isLoading || error || !stocks?.data || stocks.data.length === 0) {
    return (
      <View className="mx-5 mb-4">
        <View className="bg-gray-800/60 rounded-2xl px-4 py-3 border border-gray-700/30">
          <Text className="text-white text-sm font-bold">Trending Stocks</Text>
          <Text className="text-gray-400 text-xs mt-1">
            {isLoading ? "Loading..." : error ? "Failed to load" : "No data"}
          </Text>
        </View>
      </View>
    )
  }

  const formatVolume = (volume: string) => {
    // Convert volume like "1,679,898,690" to "1.67B"
    const num = Number.parseFloat(volume.replace(/,/g, ""))
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`
    return volume
  }

  return (
    <View className="mx-5 mb-4">
      <View className="bg-gray-800/60 rounded-2xl px-4 py-3 border border-gray-700/30">
        <Text className="text-white text-sm font-bold mb-2">Trending Stocks</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row space-x-6">
            {stocks.data.slice(0, 3).map((stock) => (
              <View key={stock.ticker} className="flex-row items-center space-x-2">
                <Text className="text-white font-bold text-sm">{stock.ticker}</Text>
                <Text className="text-white font-semibold text-sm">${stock.price}</Text>
                <Text
                  className={`font-bold text-sm ${
                    stock.change.startsWith("+") || !stock.change.startsWith("-") ? "text-green-400" : "text-red-400"
                  }`}
                >
                  ({stock.change})
                </Text>
                <Text className="text-gray-400 text-sm">{formatVolume(stock.volume)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  )
}
