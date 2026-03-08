import React from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { TrackedContractCard } from './TrackedContractCard';

export const TrackedContractsList: React.FC = () => {
  const { data: contracts = [], isLoading, error, refetch, isRefetching } = useTrackedContracts();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center py-12">
        <ActivityIndicator size="large" color="#10B981" />
        <Text className="text-gray-400 mt-4">Loading tracked contracts...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center px-6 py-12">
        <Text className="text-red-400 text-center mb-2">Error loading contracts</Text>
        <Text className="text-gray-400 text-sm text-center">
          {error instanceof Error ? error.message : 'Unknown error'}
        </Text>
      </View>
    );
  }

  if (contracts.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6 py-12">
        <Text className="text-gray-400 text-lg text-center mb-2">No tracked contracts</Text>
        <Text className="text-gray-500 text-sm text-center">
          Start tracking contracts from ORB breakouts or search results
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor="#10B981"
        />
      }>
      {contracts.map((contract) => (
        <TrackedContractCard
          key={contract.id}
          contract={contract}
          onStatusUpdate={refetch}
        />
      ))}
    </ScrollView>
  );
};
