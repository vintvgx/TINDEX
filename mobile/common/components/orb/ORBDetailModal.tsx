import React from 'react';
import {
  View,
  Text,
  Modal,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { AnimatedNumber } from './AnimatedNumber';

interface ORBDetailModalProps {
  visible: boolean;
  data: ORBMonitoringState | null;
  onClose: () => void;
  onNavigateToTicker?: (ticker: string) => void;
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
 * Formats date string
 */
const formatDate = (dateString: string | undefined): string => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch {
    return dateString;
  }
};

/**
 * Formats timestamp to HH:MM:SS AM/PM format
 */
const formatTime = (timestamp: string | undefined): string => {
  if (!timestamp) return 'N/A';
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return 'N/A';
  }
};

/**
 * Calculate ORB profit targets based on breakout direction
 * 
 * Targets are calculated using measured move projections:
 * - Target 1: 1.0× range extension (one full range)
 * - Target 2: 1.618× range extension (Fibonacci extension)
 * - Target 3: 2.0× range extension (two full ranges)
 */
const calculateORBTargets = (
  orbHigh: number,
  orbLow: number,
  breakoutType: string
): { level: number; price: number; label: string; multiplier: number }[] => {
  const orbRange = orbHigh - orbLow;
  const targets: { level: number; price: number; label: string; multiplier: number }[] = [];

  if (breakoutType === 'Bullish' || breakoutType === 'Confirmed Bullish') {
    // Bullish targets: above ORH
    targets.push(
      {
        level: 1,
        price: orbHigh + (orbRange * 1.0),
        label: 'Target 1',
        multiplier: 1.0,
      },
      {
        level: 2,
        price: orbHigh + (orbRange * 1.618),
        label: 'Target 2',
        multiplier: 1.618,
      },
      {
        level: 3,
        price: orbHigh + (orbRange * 2.0),
        label: 'Target 3',
        multiplier: 2.0,
      }
    );
  } else if (breakoutType === 'Bearish' || breakoutType === 'Confirmed Bearish') {
    // Bearish targets: below ORL
    targets.push(
      {
        level: 1,
        price: orbLow - (orbRange * 1.0),
        label: 'Target 1',
        multiplier: 1.0,
      },
      {
        level: 2,
        price: orbLow - (orbRange * 1.618),
        label: 'Target 2',
        multiplier: 1.618,
      },
      {
        level: 3,
        price: orbLow - (orbRange * 2.0),
        label: 'Target 3',
        multiplier: 2.0,
      }
    );
  }

  return targets;
};

/**
 * Gets color and styling for breakout type
 */
const getBreakoutStyle = (breakoutType: string) => {
  switch (breakoutType) {
    case 'Bullish':
      return {
        color: '#10B981',
        bgColor: 'bg-green-500/20',
        borderColor: 'border-green-500/50',
        label: 'Bullish Breakout',
      };
    case 'Confirmed Bullish':
      return {
        color: '#10B981',
        bgColor: 'bg-green-500/30',
        borderColor: 'border-green-500',
        label: 'Confirmed Bullish',
      };
    case 'Bearish':
      return {
        color: '#EF4444',
        bgColor: 'bg-red-500/20',
        borderColor: 'border-red-500/50',
        label: 'Bearish Breakout',
      };
    case 'Confirmed Bearish':
      return {
        color: '#EF4444',
        bgColor: 'bg-red-500/30',
        borderColor: 'border-red-500',
        label: 'Confirmed Bearish',
      };
    case 'invalidated':
      return {
        color: '#F59E0B',
        bgColor: 'bg-yellow-500/20',
        borderColor: 'border-yellow-500/50',
        label: 'Breakout Invalidated',
      };
    case 'reversal':
      return {
        color: '#8B5CF6',
        bgColor: 'bg-purple-500/20',
        borderColor: 'border-purple-500/50',
        label: 'Reversal Detected',
      };
    default:
      return {
        color: '#6B7280',
        bgColor: 'bg-gray-800/50',
        borderColor: 'border-gray-700/50',
        label: 'No Breakout',
      };
  }
};

export const ORBDetailModal: React.FC<ORBDetailModalProps> = ({
  visible,
  data,
  onClose,
  onNavigateToTicker,
}) => {
  if (!data) return null;

  const orbHigh = data.orb_high ?? 0;
  const orbLow = data.orb_low ?? 0;
  const currentPrice = data.current_price ?? 0;
  const orbRange = orbHigh - orbLow;
  const isAboveHigh = currentPrice > orbHigh;
  const isBelowLow = currentPrice < orbLow;
  const isInRange = !isAboveHigh && !isBelowLow && orbRange > 0;

  // Calculate price position percentage
  const pricePositionPercent = orbRange > 0 
    ? ((currentPrice - orbLow) / orbRange) * 100 
    : 50;

  // Price color based on position
  let priceColor = '#FFFFFF';
  if (isAboveHigh) priceColor = '#10B981';
  else if (isBelowLow) priceColor = '#EF4444';
  else if (isInRange) priceColor = '#9CA3AF';

  const breakoutStyle = getBreakoutStyle(data.breakout_type);
  const hasBreakout = data.breakout_type !== 'none';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-black">
        <StatusBar barStyle="light-content" />
        
        {/* Header */}
        <View className="px-6 py-4 border-b border-gray-800 flex-row items-center justify-between">
          <Text className="text-white text-2xl font-bold">{data.ticker}</Text>
          <TouchableOpacity
            onPress={onClose}
            className="w-10 h-10 items-center justify-center"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView 
          className="flex-1"
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Current Price - Large Display */}
          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-2">Current Price</Text>
            <AnimatedNumber
              value={data.current_price}
              format={(v) => `$${v.toFixed(2)}`}
              style={{ fontSize: 36, fontWeight: 'bold', marginBottom: 4 }}
              color={priceColor}
            />
            <Text className="text-gray-500 text-xs">
              {isAboveHigh && 'Above ORB High'}
              {isBelowLow && 'Below ORB Low'}
              {isInRange && 'Within ORB Range'}
            </Text>
          </View>

          {/* Breakout Status */}
          {hasBreakout && (
            <View 
              className={`mb-6 p-4 rounded-xl border ${breakoutStyle.bgColor} ${breakoutStyle.borderColor}`}
            >
              <Text className="text-gray-400 text-sm mb-2">Breakout Status</Text>
              <Text 
                className="text-xl font-bold mb-2"
                style={{ color: breakoutStyle.color }}
              >
                {breakoutStyle.label}
              </Text>
              {data.breakout_price !== null && (
                <View className="flex-row items-center mb-2">
                  <Text className="text-gray-300 text-sm">Breakout Price: </Text>
                  <AnimatedNumber
                    value={data.breakout_price}
                    format={(v) => `$${v.toFixed(2)}`}
                    style={{ fontSize: 14, fontWeight: '600' }}
                    color={breakoutStyle.color}
                  />
                </View>
              )}
              {/* Reversal Data Display */}
              {data.breakout_type === 'reversal' && data.reversal_data && (
                <View className="mt-3 pt-3 border-t border-gray-700/50">
                  <Text className="text-gray-400 text-sm mb-2">Reversal Details</Text>
                  <View className="mb-2">
                    <Text className="text-gray-300 text-sm">
                      Original Breakout: <Text className="font-semibold" style={{ color: breakoutStyle.color }}>
                        {data.reversal_data.original_breakout_type === 'above' ? 'Bullish' : 'Bearish'}
                      </Text>
                    </Text>
                  </View>
                  <View className="mb-2">
                    <Text className="text-gray-300 text-sm">
                      Confidence: <Text className="font-semibold" style={{ color: breakoutStyle.color }}>
                        {data.reversal_data.confidence}
                      </Text>
                    </Text>
                  </View>
                  <View className="mb-2">
                    <Text className="text-gray-300 text-sm">
                      Score: <Text className="font-semibold" style={{ color: breakoutStyle.color }}>
                        {data.reversal_data.score_percentage.toFixed(1)}%
                      </Text>
                      {' '}({data.reversal_data.score}/{data.reversal_data.max_score})
                    </Text>
                  </View>
                  {data.reversal_data.vwap !== null && (
                    <View className="flex-row items-center mb-2">
                      <Text className="text-gray-300 text-sm">VWAP: </Text>
                      <AnimatedNumber
                        value={data.reversal_data.vwap}
                        format={(v) => `$${v.toFixed(2)}`}
                        style={{ fontSize: 14, fontWeight: '600' }}
                        color={breakoutStyle.color}
                      />
                    </View>
                  )}
                  {data.reversal_data.indicators && data.reversal_data.indicators.length > 0 && (
                    <View className="mt-2">
                      <Text className="text-gray-400 text-xs mb-1">Indicators:</Text>
                      {data.reversal_data.indicators.map((indicator, index) => (
                        <Text key={index} className="text-gray-300 text-xs ml-2">
                          • {indicator}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ORB Range Section */}
          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-4">ORB Range</Text>
            
            {/* Visual Range Indicator */}
            <View className="mb-4">
              <View className="h-12 bg-gray-800 rounded-lg relative overflow-hidden mb-2">
                {/* Range Bar */}
                <View 
                  className="absolute h-full bg-gradient-to-r from-red-500/30 via-gray-600/30 to-green-500/30"
                  style={{ left: 0, right: 0 }}
                />
                
                {/* ORL Line (left edge) */}
                {orbRange > 0 && (
                  <View
                    className="absolute w-0.5 h-full bg-red-500"
                    style={{ left: 0 }}
                  />
                )}
                
                {/* ORH Line (right edge) */}
                {orbRange > 0 && (
                  <View
                    className="absolute w-0.5 h-full bg-green-500"
                    style={{ right: 0 }}
                  />
                )}
                
                {/* Current Price Indicator */}
                {orbRange > 0 && (
                  <View
                    className="absolute w-1 h-full"
                    style={{ 
                      left: `${Math.max(0, Math.min(100, pricePositionPercent))}%`,
                      backgroundColor: priceColor 
                    }}
                  />
                )}
              </View>
              <View className="flex-row justify-between mb-1">
                <Text className="text-red-400 text-xs">ORL</Text>
                <Text className="text-green-400 text-xs">ORH</Text>
              </View>
              {/* Current Price Label */}
              {orbRange > 0 && isInRange && (
                <View className="items-center mt-1">
                  <Text 
                    className="text-xs font-semibold"
                    style={{ color: priceColor }}
                  >
                    {formatPrice(currentPrice)}
                  </Text>
                </View>
              )}
            </View>

            {/* Range Values */}
            <View className="bg-gray-800/50 rounded-xl p-4">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-gray-400 text-sm">ORB High</Text>
                <AnimatedNumber
                  value={data.orb_high}
                  format={(v) => `$${v.toFixed(2)}`}
                  style={{ fontSize: 18, fontWeight: '600' }}
                  color="#10B981"
                />
              </View>
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-gray-400 text-sm">ORB Low</Text>
                <AnimatedNumber
                  value={data.orb_low}
                  format={(v) => `$${v.toFixed(2)}`}
                  style={{ fontSize: 18, fontWeight: '600' }}
                  color="#EF4444"
                />
              </View>
              {orbRange > 0 && (
                <View className="flex-row justify-between items-center pt-3 border-t border-gray-700/50">
                  <Text className="text-gray-400 text-sm">Range Size</Text>
                  <AnimatedNumber
                    value={orbRange}
                    format={(v) => `$${v.toFixed(2)}`}
                    style={{ fontSize: 18, fontWeight: '600' }}
                    color="#D1D5DB"
                  />
                </View>
              )}
            </View>
          </View>

          {/* ORB Profit Targets - Only show when breakout has occurred */}
          {(data.breakout_type === 'Bullish' || 
            data.breakout_type === 'Bearish' || 
            data.breakout_type === 'Confirmed Bullish' || 
            data.breakout_type === 'Confirmed Bearish') && (
            <View className="mb-6">
              <Text className="text-gray-400 text-sm mb-4">Profit Targets</Text>
              <View className="bg-gray-800/50 rounded-xl p-4">
                {calculateORBTargets(orbHigh, orbLow, data.breakout_type).map((target, index) => (
                  <View 
                    key={target.level} 
                    className={`flex-row justify-between items-center ${index < 2 ? 'mb-3' : ''}`}
                  >
                    <View className="flex-row items-center" style={{ gap: 12 }}>
                      <View 
                        className={`w-7 h-7 rounded-full items-center justify-center ${
                          data.breakout_type.includes('Bullish') 
                            ? 'bg-green-500/20' 
                            : 'bg-red-500/20'
                        }`}
                      >
                        <Text 
                          className={`text-sm font-bold ${
                            data.breakout_type.includes('Bullish')
                              ? 'text-green-400'
                              : 'text-red-400'
                          }`}
                        >
                          {target.level}
                        </Text>
                      </View>
                      <View>
                        <Text className="text-gray-300 text-sm font-medium">{target.label}</Text>
                        <Text className="text-gray-500 text-xs">{target.multiplier}× Range</Text>
                      </View>
                    </View>
                    <AnimatedNumber
                      value={target.price}
                      format={(v) => `$${v.toFixed(2)}`}
                      style={{ fontSize: 16, fontWeight: '600' }}
                      color={data.breakout_type.includes('Bullish') ? '#10B981' : '#EF4444'}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Additional Information */}
          <View className="mb-6">
            <Text className="text-gray-400 text-sm mb-4">Additional Information</Text>
            <View className="bg-gray-800/50 rounded-xl p-4">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-gray-400 text-sm">Opening Price</Text>
                <AnimatedNumber
                  value={data.opening_price}
                  format={(v) => `$${v.toFixed(2)}`}
                  style={{ fontSize: 16, fontWeight: '500' }}
                  color="#D1D5DB"
                />
              </View>
              {data.previous_close !== null && data.previous_close !== undefined && (
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-gray-400 text-sm">Previous Close</Text>
                  <AnimatedNumber
                    value={data.previous_close}
                    format={(v) => `$${v.toFixed(2)}`}
                    style={{ fontSize: 16, fontWeight: '500' }}
                    color="#D1D5DB"
                  />
                </View>
              )}
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-gray-400 text-sm">Volume</Text>
                <Text className="text-gray-300 text-base font-medium">
                  {formatVolume(data.volume)}
                </Text>
              </View>
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-gray-400 text-sm">Trade Date</Text>
                <Text className="text-gray-300 text-base font-medium">
                  {formatDate(data.trade_date)}
                </Text>
              </View>
              {data.timestamp && (
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-gray-400 text-sm">Time</Text>
                  <Text className="text-gray-300 text-base font-medium">
                    {formatTime(data.timestamp)}
                  </Text>
                </View>
              )}
              {data.data_source && (
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-gray-400 text-sm">Data Source</Text>
                  <Text className="text-gray-300 text-base font-medium">
                    {data.data_source}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between items-center pt-3 border-t border-gray-700/50 mb-3">
                <Text className="text-gray-400 text-sm">Status</Text>
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <View 
                    className={`w-2 h-2 rounded-full ${
                      data.monitoring_active ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <Text className="text-gray-300 text-base font-medium">
                    {data.monitoring_active ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              {(data.high_broken || data.low_broken) && (
                <View className="pt-3 border-t border-gray-700/50">
                  <Text className="text-gray-400 text-sm mb-2">Breakout Flags</Text>
                  <View className="flex-row" style={{ gap: 16 }}>
                    {data.high_broken && (
                      <View className="flex-row items-center" style={{ gap: 8 }}>
                        <View className="w-2 h-2 rounded-full bg-green-500" />
                        <Text className="text-green-400 text-sm">High Broken</Text>
                      </View>
                    )}
                    {data.low_broken && (
                      <View className="flex-row items-center" style={{ gap: 8 }}>
                        <View className="w-2 h-2 rounded-full bg-red-500" />
                        <Text className="text-red-400 text-sm">Low Broken</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Navigation Button */}
          {onNavigateToTicker && (
            <TouchableOpacity
              onPress={() => {
                onNavigateToTicker(data.ticker);
                onClose();
              }}
              className="bg-blue-600 rounded-xl p-4 flex-row items-center justify-center gap-2"
            >
              <Ionicons name="arrow-forward" size={20} color="#fff" />
              <Text className="text-white text-base font-semibold">
                View {data.ticker} Details
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

