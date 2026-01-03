import React from 'react';
import { View, Text, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { ORBCard } from './ORBCard';

interface ORBCardGridProps {
  data: ORBMonitoringState[];
  isLoading: boolean;
  onCardPress: (data: ORBMonitoringState) => void;
}

export const ORBCardGrid: React.FC<ORBCardGridProps> = ({ data, isLoading, onCardPress }) => {
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
    <FlatList
      data={data}
      numColumns={2}
      keyExtractor={(item, index) => `${item.ticker}-${index}`}
      renderItem={({ item }) => (
        <ORBCard data={item} onPress={() => onCardPress(item)} />
      )}
      contentContainerStyle={{ padding: 16 }}
      columnWrapperStyle={{ justifyContent: 'space-between' }}
      showsVerticalScrollIndicator={false}
    />
  );
};

