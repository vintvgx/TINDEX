import React from 'react';
import { View, Text, ActivityIndicator, FlatList } from 'react-native';
import { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { ORBCard } from './ORBCard';

interface ORBCardGridProps {
  data: ORBMonitoringState[];
  isLoading: boolean;
  onCardPress: (data: ORBMonitoringState) => void;
  lastFetchTime?: Date | null;
}

/**
 * Formats date and time for display
 */
const formatDateTime = (date: Date): string => {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
};

export const ORBCardGrid: React.FC<ORBCardGridProps> = ({ data, isLoading, onCardPress, lastFetchTime }) => {
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

  // Footer component with spacer line and last fetch time
  const renderFooter = () => {
    if (!lastFetchTime) return null;

    return (
      <View className="px-4 pb-8 pt-4">
        {/* Spacer line */}
        <View className="border-t border-gray-800 mb-4" />
        {/* Last fetch time */}
        <Text className="text-gray-500 text-xs text-center">
          Last updated: {formatDateTime(lastFetchTime)}
        </Text>
      </View>
    );
  };

  return (
    <FlatList
      data={data}
      numColumns={2}
      keyExtractor={(item, index) => `${item.ticker}-${index}`}
      renderItem={({ item }) => (
        <ORBCard data={item} onPress={() => onCardPress(item)} />
      )}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      columnWrapperStyle={{ justifyContent: 'space-between' }}
      showsVerticalScrollIndicator={false}
      ListFooterComponent={renderFooter}
    />
  );
};

