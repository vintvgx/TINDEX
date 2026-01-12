import React from 'react';
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/common/components/ui/text';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { usePortfolioMetrics, type PortfolioMetrics } from '@/hooks/queries/track/usePortfolioMetrics';

/**
 * Portfolio View Modal Component
 * 
 * Displays aggregate view of all tracked contracts with:
 * - Total unrealized PnL
 * - Risk exposure by underlying stock
 * - Summary statistics
 * 
 * Architecture:
 * - Separate component for portfolio analytics
 * - Fetches tracked contracts data
 * - Calculates aggregate metrics
 * - Displays risk exposure breakdown
 */
interface PortfolioViewModalProps {
  visible: boolean;
  onClose: () => void;
}

export const PortfolioViewModal: React.FC<PortfolioViewModalProps> = ({
  visible,
  onClose,
}) => {
  const { data: metrics, isLoading, error: queryError } = usePortfolioMetrics();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const getPnLColor = (value: number) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* Header */}
      <View className="bg-white pt-12 pb-4 px-6 border-b border-gray-200">
        <View className="flex-row justify-between items-center">
          <Text className="text-2xl font-bold text-gray-900">Portfolio View</Text>
          <Pressable
            onPress={onClose}
            className="bg-gray-100 rounded-full p-2">
            <Ionicons name="close" size={24} color="#374151" />
          </Pressable>
        </View>
      </View>

      {/* Content */}
      <ScrollView className="flex-1 bg-white" showsVerticalScrollIndicator={false}>
        <View className="px-6 py-6">
          {isLoading && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text className="text-gray-500 mt-4">Loading portfolio metrics...</Text>
            </View>
          )}

          {queryError && (
            <View className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <Text className="text-red-800 font-medium">Error loading portfolio</Text>
              <Text className="text-red-600 text-sm mt-1">
                {queryError instanceof Error ? queryError.message : 'Failed to load portfolio metrics'}
              </Text>
            </View>
          )}

          {!isLoading && !queryError && metrics && (
            <>
              {/* Summary Cards */}
              <View className="mb-6">
                <Text className="text-lg font-semibold text-gray-900 mb-4">Summary</Text>
                
                <View className="gap-4">
                  {/* Total Unrealized PnL */}
                  <View 
                    className="rounded-xl p-5 border border-blue-200"
                    style={{ backgroundColor: '#eff6ff' }}
                  >
                    <Text className="text-gray-600 text-sm mb-2">Total Unrealized P&L</Text>
                    <View className="flex-row items-baseline justify-between">
                      <Text className={`text-3xl font-bold ${getPnLColor(metrics.totalUnrealizedPnL)}`}>
                        {formatCurrency(metrics.totalUnrealizedPnL)}
                      </Text>
                      <Text className={`text-lg font-semibold ${getPnLColor(metrics.totalUnrealizedPnLPercent)}`}>
                        {formatPercent(metrics.totalUnrealizedPnLPercent)}
                      </Text>
                    </View>
                  </View>

                  {/* Stats Grid */}
                  <View className="flex-row gap-4">
                    <View className="flex-1 bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <Text className="text-gray-600 text-sm mb-1">Total Contracts</Text>
                      <Text className="text-2xl font-bold text-gray-900">{metrics.totalContracts}</Text>
                    </View>
                    <View className="flex-1 bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <Text className="text-gray-600 text-sm mb-1">Active</Text>
                      <Text className="text-2xl font-bold text-gray-900">{metrics.activeContracts}</Text>
                    </View>
                  </View>

                  {/* Cost Basis and Current Value */}
                  <View className="flex-row gap-4">
                    <View className="flex-1 bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <Text className="text-gray-600 text-sm mb-1">Cost Basis</Text>
                      <Text className="text-xl font-semibold text-gray-900">
                        {formatCurrency(metrics.totalCostBasis)}
                      </Text>
                    </View>
                    <View className="flex-1 bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <Text className="text-gray-600 text-sm mb-1">Current Value</Text>
                      <Text className="text-xl font-semibold text-gray-900">
                        {formatCurrency(metrics.totalCurrentValue)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Risk Exposure by Stock */}
              {metrics.riskExposure.length > 0 && (
                <View className="mb-6">
                  <Text className="text-lg font-semibold text-gray-900 mb-4">Risk Exposure by Stock</Text>
                  
                  <View className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <ScrollView 
                      className="max-h-96"
                      showsVerticalScrollIndicator={true}
                      nestedScrollEnabled={true}>
                      <View className="gap-3">
                        {metrics.riskExposure.map((exposure, index) => (
                          <View
                            key={exposure.ticker}
                            className={`bg-white rounded-lg p-4 border border-gray-200 ${
                              index < metrics.riskExposure.length - 1 ? 'mb-1' : ''
                            }`}>
                            {/* Header */}
                            <View className="flex-row items-center justify-between mb-3">
                              <View className="flex-row items-center gap-3">
                                <View className="w-10 h-10 bg-blue-100 rounded-full items-center justify-center">
                                  <Text className="text-blue-600 font-bold text-sm">
                                    {exposure.ticker.charAt(0)}
                                  </Text>
                                </View>
                                <View>
                                  <Text className="text-gray-900 font-semibold text-base">
                                    {exposure.ticker}
                                  </Text>
                                  <Text className="text-gray-500 text-xs">
                                    {exposure.contractCount} contract{exposure.contractCount !== 1 ? 's' : ''}
                                  </Text>
                                </View>
                              </View>
                              <View className="items-end">
                                <Text className={`text-lg font-bold ${getPnLColor(exposure.unrealizedPnL)}`}>
                                  {formatCurrency(exposure.unrealizedPnL)}
                                </Text>
                                <Text className={`text-sm font-medium ${getPnLColor(exposure.unrealizedPnLPercent)}`}>
                                  {formatPercent(exposure.unrealizedPnLPercent)}
                                </Text>
                              </View>
                            </View>

                            {/* Exposure Bar */}
                            <View className="mb-2">
                              <View className="flex-row justify-between items-center mb-1">
                                <Text className="text-gray-600 text-xs">Exposure</Text>
                                <Text className="text-gray-900 text-xs font-semibold">
                                  {exposure.exposurePercent.toFixed(1)}%
                                </Text>
                              </View>
                              <View className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                <View
                                  className="h-full bg-blue-500"
                                  style={{ width: `${Math.min(exposure.exposurePercent, 100)}%` }}
                                />
                              </View>
                            </View>

                            {/* Cost Basis */}
                            <View className="flex-row justify-between items-center">
                              <Text className="text-gray-600 text-xs">Cost Basis</Text>
                              <Text className="text-gray-900 text-xs font-semibold">
                                {formatCurrency(exposure.totalCostBasis)}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                </View>
              )}

              {metrics.riskExposure.length === 0 && (
                <View className="bg-gray-50 rounded-xl p-8 items-center border border-gray-200">
                  <Ionicons name="briefcase-outline" size={48} color="#9ca3af" />
                  <Text className="text-gray-500 text-center mt-4 font-medium">
                    No tracked contracts
                  </Text>
                  <Text className="text-gray-400 text-sm text-center mt-2">
                    Start tracking options contracts to see portfolio metrics
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </Modal>
  );
};
