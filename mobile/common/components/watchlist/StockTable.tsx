import { WatchlistStock } from '@/common/types';
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';

interface StockTableProps {
  stocks: WatchlistStock[];
  isLoading: boolean;
  onPress: (ticker: string) => void
}

const COLUMN_WIDTHS = {
  rank: 50,
  symbol: 80,
  name: 200,
  price: 100,
  change: 100,
  percentage: 120,
};

export const StockTable: React.FC<StockTableProps> = ({ stocks, isLoading, onPress }) => {
  /**
   * Safely formats price with null/undefined handling
   */
  const formatPrice = (price: number | null | undefined): string => {
    if (price === null || price === undefined || isNaN(price)) {
      return 'N/A';
    }
    return `$${price.toFixed(2)}`;
  };

  /**
   * Safely formats change amount with null/undefined handling
   */
  const formatChange = (change: number | null | undefined): string => {
    if (change === null || change === undefined || isNaN(change)) {
      return 'N/A';
    }
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}`;
  };

  /**
   * Safely formats percentage with null/undefined handling
   */
  const formatPercentage = (percentage: number | null | undefined): string => {
    if (percentage === null || percentage === undefined || isNaN(percentage)) {
      return 'N/A';
    }
    const sign = percentage >= 0 ? '+' : '';
    return `${sign}${percentage.toFixed(2)}%`;
  };

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center py-20">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-gray-400 mt-4">Loading stocks...</Text>
      </View>
    );
  }

  if (!stocks || stocks.length === 0) {
    return (
      <View className="flex-1 justify-center items-center py-20">
        <Text className="text-gray-400 text-center">No data available</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 16 }}
    >
      <View className="flex-1 mt-4">
        {/* Table Header */}
        <View className="flex-row border-b border-gray-800 pb-3 mb-2">
          <View style={{ width: COLUMN_WIDTHS.rank }} className="justify-center">
            <Text className="text-gray-500 text-xs font-semibold">#</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.symbol }} className="justify-center">
            <Text className="text-gray-500 text-xs font-semibold">SYMBOL</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.name }} className="justify-center">
            <Text className="text-gray-500 text-xs font-semibold">NAME</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.price }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">PRICE</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.change }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">CHANGE</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.percentage }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">% CHANGE</Text>
          </View>
        </View>

        {/* Table Rows */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          className="flex-1"
        >
          {stocks.map((stock, index) => {
            // Derive color from actual change amount, not percentage
            // This ensures visual feedback matches the true change value
            const changeAmount = stock.change ?? 0;
            const isPositive = changeAmount >= 0;
            const changeColor = isPositive ? 'text-green-500' : 'text-red-500';
            
            // Separately check if percentage data exists for display
            const hasValidPercent = stock.change_percent !== null && stock.change_percent !== undefined;

            return (
              <TouchableOpacity
                key={`${stock.ticker}-${index}`}
                onPress={() => onPress(stock.ticker)}
                className="flex-row py-4 border-b border-gray-900/50"
              >
                <View style={{ width: COLUMN_WIDTHS.rank }} className="justify-center">
                  <Text className="text-gray-400 text-sm">{index + 1}</Text>
                </View>
                <View style={{ width: COLUMN_WIDTHS.symbol }} className="justify-center">
                  <Text className="text-white text-sm font-semibold">
                    {stock.ticker}
                  </Text>
                </View>
                <View style={{ width: COLUMN_WIDTHS.name }} className="justify-center">
                  <Text className="text-gray-300 text-sm" numberOfLines={2}>
                    {stock.company}
                  </Text>
                </View>
                <View style={{ width: COLUMN_WIDTHS.price }} className="justify-center items-end">
                  <Text className="text-white text-sm">
                    {formatPrice(stock.price)}
                  </Text>
                </View>
                <View style={{ width: COLUMN_WIDTHS.change }} className="justify-center items-end">
                  <Text className={`${changeColor} text-sm font-medium`}>
                    {formatChange(stock.change)}
                  </Text>
                </View>
                <View style={{ width: COLUMN_WIDTHS.percentage }} className="justify-center items-end">
                  <View className="flex-row items-center">
                    {hasValidPercent ? (
                      <Text className={`${changeColor} text-sm font-bold`}>
                        {isPositive ? '↑' : '↓'} {formatPercentage(stock.change_percent)}
                      </Text>
                    ) : (
                      <Text className="text-gray-500 text-sm">N/A</Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </ScrollView>
  );
};