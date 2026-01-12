import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, ActivityIndicator, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOptionsQuery } from '@/hooks/queries/ticker/useOptionsQuery';
import { OptionsContractLine } from '@/common/components/ticker/OptionsContractLine';
import { OptionsContractDetailModal } from '@/common/components/ticker/OptionsContractDetailModal';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import type { OptionsOpportunity, OptionsContract } from '@/common/types/blogPosts/ticker';

export const SearchContractsSection: React.FC = () => {
  const { authState: { user } } = useAuth();
  const [searchTicker, setSearchTicker] = useState('');
  const [debouncedTicker, setDebouncedTicker] = useState('');
  const trackContract = useTrackContract();
  const { data: trackedContracts = [] } = useTrackedContracts();
  
  // Create a Set of tracked contract symbols for quick lookup
  const trackedContractSymbols = useMemo(() => {
    return new Set(trackedContracts.map(c => c.contract_symbol));
  }, [trackedContracts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTicker(searchTicker.trim().toUpperCase());
    }, 2000);

    return () => clearTimeout(timer);
  }, [searchTicker]);

  const { data: optionsData, isLoading, error } = useOptionsQuery(debouncedTicker);

  // Transform options contracts to OptionsOpportunity format and sort by volume
  const transformedOpportunities = useMemo(() => {
    if (!optionsData?.data) return [];

    const allContracts: OptionsOpportunity[] = [];
    const currentPrice = optionsData.data.current_price;

    // Transform calls
    optionsData.data.calls.forEach((contract: OptionsContract) => {
      const expirationDate = new Date(contract.expiration);
      const today = new Date();
      const dte = Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      const mark = contract.last_price ?? (contract.bid + contract.ask) / 2;
      const spread = contract.ask - contract.bid;
      const spreadPct = mark > 0 ? (spread / mark) * 100 : 0;
      
      // Calculate moneyness (how far in/out of the money)
      const moneyness = currentPrice > 0 ? (contract.strike / currentPrice) - 1 : 0;
      
      // Calculate intrinsic value
      const intrinsicValue = contract.option_type === 'CALL' 
        ? Math.max(0, currentPrice - contract.strike)
        : Math.max(0, contract.strike - currentPrice);
      
      // Extrinsic value is the premium minus intrinsic
      const extrinsicValue = Math.max(0, mark - intrinsicValue);

      allContracts.push({
        ask: contract.ask,
        bid: contract.bid,
        contractSymbol: contract.symbol,
        delta: contract.delta,
        dte: dte,
        expirationDate: contract.expiration,
        extrinsicValue: extrinsicValue,
        gamma: contract.gamma,
        impliedVolatility: contract.implied_volatility ?? 0,
        intrinsicValue: intrinsicValue,
        mark: mark,
        moneyness: moneyness,
        openInterest: contract.open_interest,
        optionType: contract.option_type,
        reasons: `Volume: ${contract.volume}, OI: ${contract.open_interest}`,
        signal: 'CONSIDER' as const,
        spreadPct: spreadPct,
        strike: contract.strike,
        theta: contract.theta,
        total_score: contract.volume, // Use volume as score for sorting
        vega: contract.vega,
        volume: contract.volume,
      });
    });

    // Transform puts
    optionsData.data.puts.forEach((contract: OptionsContract) => {
      const expirationDate = new Date(contract.expiration);
      const today = new Date();
      const dte = Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      const mark = contract.last_price ?? (contract.bid + contract.ask) / 2;
      const spread = contract.ask - contract.bid;
      const spreadPct = mark > 0 ? (spread / mark) * 100 : 0;
      
      // Calculate moneyness
      const moneyness = currentPrice > 0 ? (contract.strike / currentPrice) - 1 : 0;
      
      // Calculate intrinsic value
      const intrinsicValue = contract.option_type === 'CALL' 
        ? Math.max(0, currentPrice - contract.strike)
        : Math.max(0, contract.strike - currentPrice);
      
      // Extrinsic value
      const extrinsicValue = Math.max(0, mark - intrinsicValue);

      allContracts.push({
        ask: contract.ask,
        bid: contract.bid,
        contractSymbol: contract.symbol,
        delta: contract.delta,
        dte: dte,
        expirationDate: contract.expiration,
        extrinsicValue: extrinsicValue,
        gamma: contract.gamma,
        impliedVolatility: contract.implied_volatility ?? 0,
        intrinsicValue: intrinsicValue,
        mark: mark,
        moneyness: moneyness,
        openInterest: contract.open_interest,
        optionType: contract.option_type,
        reasons: `Volume: ${contract.volume}, OI: ${contract.open_interest}`,
        signal: 'CONSIDER' as const,
        spreadPct: spreadPct,
        strike: contract.strike,
        theta: contract.theta,
        total_score: contract.volume, // Use volume as score for sorting
        vega: contract.vega,
        volume: contract.volume,
      });
    });

    // Sort by volume (descending)
    return allContracts.sort((a, b) => b.volume - a.volume);
  }, [optionsData]);

  const [selectedContract, setSelectedContract] = useState<OptionsOpportunity | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const handleContractPress = (contract: OptionsOpportunity) => {
    setSelectedContract(contract);
    setModalVisible(true);
  };

  const handleTrackContract = async () => {
    if (!user?.id || !selectedContract) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    if (!debouncedTicker) {
      Alert.alert('Error', 'Please enter a ticker symbol');
      return;
    }

    try {
      const expirationDate = selectedContract.expirationDate
        ? new Date(selectedContract.expirationDate).toISOString().split('T')[0]
        : '';

      await trackContract.mutateAsync({
        userId: user.id,
        ticker: debouncedTicker,
        contractSymbol: selectedContract.contractSymbol,
        optionType: selectedContract.optionType,
        strike: selectedContract.strike,
        expirationDate: expirationDate,
        trackingSnapshot: selectedContract,
        trackedFromSource: 'manual',
        initialAnalysisScore: selectedContract.total_score,
      });

      // Close modal first, then show alert after a brief delay to avoid navigation context issues
      setModalVisible(false);
      setTimeout(() => {
        Alert.alert('Success', `Contract ${selectedContract.contractSymbol} is now being tracked`);
      }, 100);
    } catch (error) {
      // Close modal first on error too
      setModalVisible(false);
      setTimeout(() => {
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'Failed to track contract'
        );
      }, 100);
    }
  };

  return (
    <View className="flex-1">
      {/* Search Input */}
      <View className="px-4 py-3 border-b border-gray-800">
        <View className="flex-row items-center bg-gray-800/50 rounded-xl px-4 py-3 border border-gray-700/30">
          <Ionicons name="search" size={20} color="#9CA3AF" />
          <TextInput
            value={searchTicker}
            onChangeText={setSearchTicker}
            placeholder="Search ticker (e.g., AAPL)"
            placeholderTextColor="#6B7280"
            className="flex-1 ml-3 text-white text-base"
            autoCapitalize="characters"
            maxLength={5}
          />
          {searchTicker.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchTicker('')}
              className="ml-2">
              <Ionicons name="close-circle" size={20} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Results - Don't use ScrollView when OptionsList (SectionList) is present */}
      {!debouncedTicker && (
        <View className="flex-1 items-center justify-center py-12 px-4">
          <Ionicons name="search-outline" size={48} color="#6B7280" />
          <Text className="text-gray-400 text-lg text-center mt-4 mb-2">
            Search for Options
          </Text>
          <Text className="text-gray-500 text-sm text-center">
            Enter a ticker symbol to view available options contracts
          </Text>
        </View>
      )}

      {debouncedTicker && debouncedTicker.length < 1 && (
        <View className="flex-1 items-center justify-center py-12 px-4">
          <Text className="text-gray-400 text-sm text-center">
            Enter at least 1 character
          </Text>
        </View>
      )}

      {debouncedTicker && debouncedTicker.length > 5 && (
        <View className="flex-1 items-center justify-center py-12 px-4">
          <Text className="text-gray-400 text-sm text-center">
            Ticker symbol must be 5 characters or less
          </Text>
        </View>
      )}

      {isLoading && debouncedTicker.length >= 1 && debouncedTicker.length <= 5 && (
        <View className="flex-1 items-center justify-center py-12 px-4">
          <ActivityIndicator size="large" color="#10B981" />
          <Text className="text-gray-400 mt-4">Loading options for {debouncedTicker}...</Text>
        </View>
      )}

      {/* Error State - Display when ticker fetch fails */}
      {error && debouncedTicker.length >= 1 && debouncedTicker.length <= 5 && (
        <View className="flex-1 items-center justify-center py-12 px-6">
          <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
          <Text className="text-red-400 text-center mt-4 mb-2 text-lg font-semibold">
            Unable to fetch data for {debouncedTicker}
          </Text>
          <Text className="text-gray-400 text-sm text-center mb-2 px-4">
            {error instanceof Error 
              ? error.message 
              : 'An unexpected error occurred while fetching ticker data.'}
          </Text>
          <Text className="text-gray-500 text-xs text-center px-4 mt-2">
            Please check the ticker symbol and try again, or verify your network connection.
          </Text>
        </View>
      )}

      {/* No Options Available State */}
      {!isLoading && !error && optionsData?.data && (optionsData.data.calls.length === 0 && optionsData.data.puts.length === 0) && (
        <View className="flex-1 items-center justify-center py-12 px-6">
          <Ionicons name="analytics-outline" size={48} color="#6B7280" />
          <Text className="text-gray-400 text-center mt-4 mb-2 text-lg">
            No options available
          </Text>
          <Text className="text-gray-500 text-sm text-center px-4">
            No options contracts found for {debouncedTicker} at this time.
          </Text>
        </View>
      )}

      {/* Success State - Display options list */}
      {!isLoading && !error && transformedOpportunities.length > 0 && (
        <View className="flex-1">
          {/* Sticky Header - Matching FollowedContractsList style */}
          <View className="bg-gray-900 border-b border-gray-700 px-4 py-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <View className="bg-emerald-500/20 px-4 py-2 rounded-xl">
                  <Text className="text-emerald-400 font-bold text-xl">{debouncedTicker}</Text>
                </View>
                <View>
                  <Text className="text-gray-500 text-xs">Current Price</Text>
                  <Text className="text-white font-bold text-lg">
                    ${optionsData?.data?.current_price.toFixed(2) || '0.00'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Scrollable Contracts List */}
          <ScrollView className="flex-1" showsVerticalScrollIndicator={true}>
            {/* Section Header */}
            <View className="bg-gray-900 px-4 py-3 border-b border-gray-800">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <View className="bg-blue-500/20 px-3 py-1.5 rounded-lg">
                    <Text className="text-blue-400 font-bold text-lg">{debouncedTicker}</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Text className="text-gray-400 text-sm">Price:</Text>
                    <Text className="text-white font-semibold text-base">
                      ${optionsData?.data?.current_price.toFixed(2) || '0.00'}
                    </Text>
                  </View>
                </View>
                <Text className="text-gray-500 text-xs">
                  {transformedOpportunities.length} contract{transformedOpportunities.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>

            {/* Contracts List */}
            {transformedOpportunities.map((contract) => {
              const isTracked = trackedContractSymbols.has(contract.contractSymbol);
              return (
                <OptionsContractLine
                  key={contract.contractSymbol}
                  contract={contract}
                  isTracked={isTracked}
                  onPress={() => handleContractPress(contract)}
                />
              );
            })}
          </ScrollView>

          {/* Modal */}
          <OptionsContractDetailModal
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
            contract={selectedContract}
            ticker={debouncedTicker}
            currentPrice={optionsData?.data?.current_price || 0}
            isTracked={selectedContract ? trackedContractSymbols.has(selectedContract.contractSymbol) : false}
            onTrackContract={handleTrackContract}
            isTracking={trackContract.isPending}
          />
        </View>
      )}
    </View>
  );
};
