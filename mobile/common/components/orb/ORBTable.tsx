import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';

interface ORBTableProps {
  data: ORBMonitoringState[];
  isLoading: boolean;
  onPress: (ticker: string) => void;
}

const COLUMN_WIDTHS = {
  ticker: 80,
  open: 90,
  orbHigh: 90,
  orbLow: 90,
  current: 90,
  breakout: 120,
  breakoutPrice: 100,
  volume: 100,
};

/**
 * Formats price with null/undefined handling
 */
const formatPrice = (price: number | null | undefined): string => {
  if (price === null || price === undefined || isNaN(price)) {
    return 'N/A';
  }
  return `$${price.toFixed(2)}`;
};

/**
 * Formats volume with null/undefined handling
 */
const formatVolume = (volume: number | null | undefined): string => {
  if (volume === null || volume === undefined || isNaN(volume)) {
    return 'N/A';
  }
  if (volume >= 1000000) {
    return `${(volume / 1000000).toFixed(2)}M`;
  }
  if (volume >= 1000) {
    return `${(volume / 1000).toFixed(2)}K`;
  }
  return volume.toLocaleString();
};

/**
 * Gets color for breakout type
 */
const getBreakoutColor = (breakoutType: string): string => {
  switch (breakoutType) {
    case 'Bullish':
    case 'Confirmed Bullish':
      return 'text-green-500';
    case 'Bearish':
    case 'Confirmed Bearish':
      return 'text-red-500';
    case 'invalidated':
      return 'text-yellow-500';
    default:
      return 'text-gray-400';
  }
};

/**
 * Gets badge color for breakout type
 */
const getBreakoutBadgeColor = (breakoutType: string): string => {
  switch (breakoutType) {
    case 'Bullish':
      return 'bg-green-500/20 border-green-500/50';
    case 'Confirmed Bullish':
      return 'bg-green-500/30 border-green-500';
    case 'Bearish':
      return 'bg-red-500/20 border-red-500/50';
    case 'Confirmed Bearish':
      return 'bg-red-500/30 border-red-500';
    case 'invalidated':
      return 'bg-yellow-500/20 border-yellow-500/50';
    default:
      return 'bg-gray-800/50 border-gray-700/50';
  }
};

export const ORBTable: React.FC<ORBTableProps> = ({ data, isLoading, onPress }) => {
  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center py-20">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-gray-400 mt-4">Loading ORB data...</Text>
      </View>
    );
  }

  if (!data || data.length === 0) {
    return (
      <View className="flex-1 justify-center items-center py-20">
        <Text className="text-gray-400 text-center">No ORB monitoring data available</Text>
        <Text className="text-gray-500 text-center text-sm mt-2">
          Tickers will appear here once ORB monitoring starts
        </Text>
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
          <View style={{ width: COLUMN_WIDTHS.ticker }} className="justify-center">
            <Text className="text-gray-500 text-xs font-semibold">TICKER</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.open }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">OPEN</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.orbHigh }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">ORB HIGH</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.orbLow }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">ORB LOW</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.current }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">CURRENT</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.breakout }} className="justify-center items-center">
            <Text className="text-gray-500 text-xs font-semibold">BREAKOUT</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.breakoutPrice }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">BREAKOUT $</Text>
          </View>
          <View style={{ width: COLUMN_WIDTHS.volume }} className="justify-center items-end">
            <Text className="text-gray-500 text-xs font-semibold">VOLUME</Text>
          </View>
        </View>

        {/* Table Rows */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          className="flex-1"
        >
          {data.map((item, index) => {
            // Calculate price position relative to ORB range
            const orbHigh = item.orb_high ?? 0;
            const orbLow = item.orb_low ?? 0;
            const currentPrice = item.current_price ?? 0;
            const orbRange = orbHigh - orbLow;
            const isAboveHigh = currentPrice > orbHigh;
            const isBelowLow = currentPrice < orbLow;
            const isInRange = !isAboveHigh && !isBelowLow && orbRange > 0;
            
            // Price color based on position
            let priceColor = 'text-white';
            if (isAboveHigh) priceColor = 'text-green-400';
            else if (isBelowLow) priceColor = 'text-red-400';
            else if (isInRange) priceColor = 'text-gray-300';

            return (
              <TouchableOpacity
                key={`${item.ticker}-${index}`}
                onPress={() => onPress(item.ticker)}
                className="flex-row py-4 border-b border-gray-900/50"
              >
                {/* Ticker */}
                <View style={{ width: COLUMN_WIDTHS.ticker }} className="justify-center">
                  <Text className="text-white text-sm font-semibold">
                    {item.ticker}
                  </Text>
                </View>

                {/* Opening Price */}
                <View style={{ width: COLUMN_WIDTHS.open }} className="justify-center items-end">
                  <Text className="text-gray-300 text-sm">
                    {formatPrice(item.opening_price)}
                  </Text>
                </View>

                {/* ORB High */}
                <View style={{ width: COLUMN_WIDTHS.orbHigh }} className="justify-center items-end">
                  <Text className="text-green-400/80 text-sm">
                    {formatPrice(item.orb_high)}
                  </Text>
                </View>

                {/* ORB Low */}
                <View style={{ width: COLUMN_WIDTHS.orbLow }} className="justify-center items-end">
                  <Text className="text-red-400/80 text-sm">
                    {formatPrice(item.orb_low)}
                  </Text>
                </View>

                {/* Current Price */}
                <View style={{ width: COLUMN_WIDTHS.current }} className="justify-center items-end">
                  <Text className={`${priceColor} text-sm font-semibold`}>
                    {formatPrice(item.current_price)}
                  </Text>
                </View>

                {/* Breakout Type */}
                <View style={{ width: COLUMN_WIDTHS.breakout }} className="justify-center items-center">
                  <View className={`px-2 py-1 rounded border ${getBreakoutBadgeColor(item.breakout_type)}`}>
                    <Text className={`text-xs font-medium ${getBreakoutColor(item.breakout_type)}`}>
                      {item.breakout_type === 'none' ? '—' : item.breakout_type}
                    </Text>
                  </View>
                </View>

                {/* Breakout Price */}
                <View style={{ width: COLUMN_WIDTHS.breakoutPrice }} className="justify-center items-end">
                  <Text className="text-gray-400 text-sm">
                    {item.breakout_type !== 'none' && item.breakout_price !== null
                      ? formatPrice(item.breakout_price)
                      : '—'}
                  </Text>
                </View>

                {/* Volume */}
                <View style={{ width: COLUMN_WIDTHS.volume }} className="justify-center items-end">
                  <Text className="text-gray-400 text-sm">
                    {formatVolume(item.volume)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </ScrollView>
  );
};

