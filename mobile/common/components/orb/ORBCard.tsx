import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { AnimatedNumber } from './AnimatedNumber';

interface ORBCardProps {
  data: ORBMonitoringState;
  onPress: () => void;
}

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
 * Gets color for breakout type
 */
const getBreakoutColor = (breakoutType: string): string => {
  switch (breakoutType) {
    case 'Bullish':
    case 'Confirmed Bullish':
      return '#10B981'; // green
    case 'Bearish':
    case 'Confirmed Bearish':
      return '#EF4444'; // red
    case 'invalidated':
      return '#F59E0B'; // amber
    case 'reversal':
      return '#8B5CF6'; // purple
    default:
      return '#6B7280'; // gray
  }
};

/**
 * Gets background color for breakout badge
 */
const getBreakoutBadgeBg = (breakoutType: string): string => {
  switch (breakoutType) {
    case 'Bullish':
      return 'bg-green-500/20';
    case 'Confirmed Bullish':
      return 'bg-green-500/30';
    case 'Bearish':
      return 'bg-red-500/20';
    case 'Confirmed Bearish':
      return 'bg-red-500/30';
    case 'invalidated':
      return 'bg-yellow-500/20';
    case 'reversal':
      return 'bg-purple-500/20';
    default:
      return 'bg-gray-800/50';
  }
};

export const ORBCard: React.FC<ORBCardProps> = ({ data, onPress }) => {
  const orbHigh = data.orb_high ?? 0;
  const orbLow = data.orb_low ?? 0;
  const currentPrice = data.current_price ?? 0;
  const isAboveHigh = currentPrice > orbHigh;
  const isBelowLow = currentPrice < orbLow;
  const isInRange = !isAboveHigh && !isBelowLow && (orbHigh - orbLow) > 0;
  
  // Price color based on position
  let priceColor = '#FFFFFF';
  if (isAboveHigh) priceColor = '#10B981';
  else if (isBelowLow) priceColor = '#EF4444';
  else if (isInRange) priceColor = '#9CA3AF';

  const breakoutColor = getBreakoutColor(data.breakout_type);
  const hasBreakout = data.breakout_type !== 'none';

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-gray-800/60 border border-gray-700/30 rounded-xl p-4 mb-4 active:opacity-80"
      style={{ flex: 1, marginHorizontal: 4 }}
    >
      {/* Header with Ticker and Breakout Indicator */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-white text-lg font-bold">{data.ticker}</Text>
        {hasBreakout && (
          <View className="items-end" style={{ gap: 4 }}>
            <View 
              className={`px-2 py-1 rounded ${getBreakoutBadgeBg(data.breakout_type)}`}
              style={{ borderWidth: 1, borderColor: breakoutColor + '80' }}
            >
              <Text 
                className="text-xs font-semibold"
                style={{ color: breakoutColor }}
              >
                {data.breakout_type}
              </Text>
            </View>
            {/* Show confidence for reversals */}
            {data.breakout_type === 'reversal' && data.reversal_data?.confidence && (
              <Text 
                className="text-xs"
                style={{ color: breakoutColor + 'CC' }}
              >
                {data.reversal_data.confidence} Confidence
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Current Price - Large and Prominent */}
      <View className="mb-3">
        <Text className="text-gray-400 text-xs mb-1">Current Price</Text>
        <View className="flex-row items-baseline justify-between">
          <AnimatedNumber
            value={data.current_price}
            format={(v) => `$${v.toFixed(2)}`}
            style={{ fontSize: 24, fontWeight: 'bold' }}
            color={priceColor}
          />
          {/* Percentage Change Display */}
          {data.percentage_change !== null && data.percentage_change !== undefined && (
            <View className="flex-row items-center" style={{ gap: 4 }}>
              {data.percentage_change >= 0 ? (
                <Text style={{ color: '#10B981' }}>▲</Text>
              ) : (
                <Text style={{ color: '#EF4444' }}>▼</Text>
              )}
              <AnimatedNumber
                value={data.percentage_change}
                format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
                style={{ fontSize: 14, fontWeight: '600' }}
                color={data.percentage_change >= 0 ? '#10B981' : '#EF4444'}
              />
            </View>
          )}
        </View>
      </View>

      {/* ORB Range */}
      <View>
        <View className="flex-row justify-between items-center mb-2">
          <Text className="text-gray-400 text-xs">ORB High</Text>
          <AnimatedNumber
            value={data.orb_high}
            format={(v) => `$${v.toFixed(2)}`}
            style={{ fontSize: 14, fontWeight: '600' }}
            color="#10B981"
          />
        </View>
        <View className="flex-row justify-between items-center mb-2">
          <Text className="text-gray-400 text-xs">ORB Low</Text>
          <AnimatedNumber
            value={data.orb_low}
            format={(v) => `$${v.toFixed(2)}`}
            style={{ fontSize: 14, fontWeight: '600' }}
            color="#EF4444"
          />
        </View>
        <View className="flex-row justify-between items-center pt-2 border-t border-gray-700/50">
          {/* Show Previous Close during calculation period, Opening otherwise */}
          {data.percentage_change !== null && data.percentage_change !== undefined && data.breakout_type === 'none' ? (
            <>
              <Text className="text-gray-400 text-xs">Previous Close</Text>
              <AnimatedNumber
                value={data.previous_close}
                format={(v) => `$${v.toFixed(2)}`}
                style={{ fontSize: 14, fontWeight: '500' }}
                color="#D1D5DB"
              />
            </>
          ) : (
            <>
              <Text className="text-gray-400 text-xs">Opening</Text>
              <AnimatedNumber
                value={data.opening_price}
                format={(v) => `$${v.toFixed(2)}`}
                style={{ fontSize: 14, fontWeight: '500' }}
                color="#D1D5DB"
              />
            </>
          )}
        </View>
      </View>

      {/* Breakout Price if applicable */}
      {hasBreakout && data.breakout_price !== null && (
        <View className="mt-3 pt-3 border-t border-gray-700/50">
          <View className="flex-row justify-between items-center">
            <Text className="text-gray-400 text-xs">Breakout Price</Text>
            <AnimatedNumber
              value={data.breakout_price}
              format={(v) => `$${v.toFixed(2)}`}
              style={{ fontSize: 14, fontWeight: '600' }}
              color={breakoutColor}
            />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
};

