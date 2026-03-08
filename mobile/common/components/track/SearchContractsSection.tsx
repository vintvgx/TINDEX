import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, ActivityIndicator, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOptionsQuery, type OptionsQueryParams } from '@/hooks/queries/ticker/useOptionsQuery';
import { OptionsContractLine } from '@/common/components/ticker/OptionsContractLine';
import { OptionsContractDetailModal } from '@/common/components/ticker/OptionsContractDetailModal';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import type { OptionsOpportunity, OptionsContract } from '@/common/types/blogPosts/ticker';

type ExpirationFilter = '0dte' | '1week' | '2weeks' | '1month' | 'all';
type OptionTypeFilter = 'both' | 'calls' | 'puts';
type SortOption = 'volume' | 'expiration' | 'strike' | 'openInterest' | 'dte';

export const SearchContractsSection: React.FC = () => {
  const { authState: { user } } = useAuth();
  const [searchTicker, setSearchTicker] = useState('');
  const [debouncedTicker, setDebouncedTicker] = useState('');
  const trackContract = useTrackContract();
  const { data: trackedContracts = [] } = useTrackedContracts();
  
  // Filter states
  const [expirationFilter, setExpirationFilter] = useState<ExpirationFilter>('all');
  const [optionTypeFilter, setOptionTypeFilter] = useState<OptionTypeFilter>('both');
  const [limit, setLimit] = useState<number>(25);
  const [sortBy, setSortBy] = useState<SortOption>('volume');
  const [showFilters, setShowFilters] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  
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

  // Calculate expiration date filters
  const getExpirationDates = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    switch (expirationFilter) {
      case '0dte':
        return {
          expiration_date_gte: today.toISOString().split('T')[0],
          expiration_date_lte: today.toISOString().split('T')[0],
        };
      case '1week': {
        const oneWeekLater = new Date(today);
        oneWeekLater.setDate(today.getDate() + 7);
        return {
          expiration_date_gte: today.toISOString().split('T')[0],
          expiration_date_lte: oneWeekLater.toISOString().split('T')[0],
        };
      }
      case '2weeks': {
        const twoWeeksLater = new Date(today);
        twoWeeksLater.setDate(today.getDate() + 14);
        return {
          expiration_date_gte: today.toISOString().split('T')[0],
          expiration_date_lte: twoWeeksLater.toISOString().split('T')[0],
        };
      }
      case '1month': {
        const oneMonthLater = new Date(today);
        oneMonthLater.setMonth(today.getMonth() + 1);
        return {
          expiration_date_gte: today.toISOString().split('T')[0],
          expiration_date_lte: oneMonthLater.toISOString().split('T')[0],
        };
      }
      default:
        return {};
    }
  }, [expirationFilter]);

  // Build query parameters
  const queryParams: OptionsQueryParams = useMemo(() => {
    const params: OptionsQueryParams = {
      limit: Math.min(Math.max(limit, 1), 100),
    };
    
    if (getExpirationDates.expiration_date_gte) {
      params.expiration_date_gte = getExpirationDates.expiration_date_gte;
    }
    if (getExpirationDates.expiration_date_lte) {
      params.expiration_date_lte = getExpirationDates.expiration_date_lte;
    }
    
    return params;
  }, [limit, getExpirationDates]);

  const { data: optionsData, isLoading, error } = useOptionsQuery(debouncedTicker, queryParams);

  // Transform options contracts to OptionsOpportunity format, filter, and sort
  const transformedOpportunities = useMemo(() => {
    if (!optionsData?.data) return [];

    const allContracts: OptionsOpportunity[] = [];
    const currentPrice = optionsData.data.current_price;

    // Transform calls (if optionTypeFilter includes calls)
    if (optionTypeFilter === 'both' || optionTypeFilter === 'calls') {
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
    }

    // Transform puts (if optionTypeFilter includes puts)
    if (optionTypeFilter === 'both' || optionTypeFilter === 'puts') {
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
    }

    // Apply sorting
    const sortedContracts = [...allContracts].sort((a, b) => {
      switch (sortBy) {
        case 'volume':
          return b.volume - a.volume;
        case 'expiration':
          return new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime();
        case 'strike':
          return a.strike - b.strike;
        case 'openInterest':
          return b.openInterest - a.openInterest;
        case 'dte':
          return a.dte - b.dte;
        default:
          return b.volume - a.volume;
      }
    });

    return sortedContracts;
  }, [optionsData, optionTypeFilter, sortBy]);

  const [selectedContract, setSelectedContract] = useState<OptionsOpportunity | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const handleContractPress = (contract: OptionsOpportunity) => {
    setSelectedContract(contract);
    setModalVisible(true);
  };

  const handleTrackContract = async () => {
    if (!user?.id || !selectedContract) {
      return;
    }

    if (!debouncedTicker) {
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

      // Close modal - tracked status will be shown in the card component
      setModalVisible(false);
    } catch (error) {
      // Close modal on error - error will be handled by React Query
      setModalVisible(false);
      console.error('Failed to track contract:', error);
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
        
        {/* Filter and Sort Controls */}
        {debouncedTicker && debouncedTicker.length >= 1 && debouncedTicker.length <= 5 && (
          <View className="flex-row items-center gap-2 mt-3">
            <TouchableOpacity
              onPress={() => setShowFilters(!showFilters)}
              className="flex-1 flex-row items-center justify-center bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-700/30">
              <Ionicons name="filter" size={16} color="#9CA3AF" />
              <Text className="text-gray-300 text-sm ml-2">Filters</Text>
              {(expirationFilter !== 'all' || optionTypeFilter !== 'both' || limit !== 25) && (
                <View className="ml-2 w-2 h-2 bg-blue-500 rounded-full" />
              )}
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => setShowSortMenu(!showSortMenu)}
              className="flex-1 flex-row items-center justify-center bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-700/30">
              <Ionicons name="swap-vertical" size={16} color="#9CA3AF" />
              <Text className="text-gray-300 text-sm ml-2">Sort</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Filters Modal */}
      <Modal
        visible={showFilters}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowFilters(false)}>
        <View className="flex-1 bg-black/50 justify-end">
          <TouchableOpacity
            className="flex-1"
            activeOpacity={1}
            onPress={() => setShowFilters(false)}
          />
          <View className="bg-gray-900 rounded-t-3xl p-6 max-h-[80%]">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-white text-xl font-bold">Filters</Text>
              <TouchableOpacity onPress={() => setShowFilters(false)}>
                <Ionicons name="close" size={24} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={true}>
              {/* Expiration Filter */}
              <View className="mb-6">
                <Text className="text-gray-400 text-sm mb-3">Expiration</Text>
                <View className="flex-row flex-wrap gap-2">
                  {(['all', '0dte', '1week', '2weeks', '1month'] as ExpirationFilter[]).map((filter) => (
                    <TouchableOpacity
                      key={filter}
                      onPress={() => setExpirationFilter(filter)}
                      className={`px-4 py-2 rounded-lg border ${
                        expirationFilter === filter
                          ? 'bg-blue-500/20 border-blue-500'
                          : 'bg-gray-800/50 border-gray-700/30'
                      }`}>
                      <Text className={`text-sm ${
                        expirationFilter === filter ? 'text-blue-400 font-semibold' : 'text-gray-300'
                      }`}>
                        {filter === 'all' ? 'All' : filter === '0dte' ? '0 DTE' : filter === '1week' ? '1 Week' : filter === '2weeks' ? '2 Weeks' : '1 Month'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Option Type Filter */}
              <View className="mb-6">
                <Text className="text-gray-400 text-sm mb-3">Option Type</Text>
                <View className="flex-row gap-2">
                  {(['both', 'calls', 'puts'] as OptionTypeFilter[]).map((filter) => (
                    <TouchableOpacity
                      key={filter}
                      onPress={() => setOptionTypeFilter(filter)}
                      className={`flex-1 px-4 py-2 rounded-lg border ${
                        optionTypeFilter === filter
                          ? filter === 'calls' 
                            ? 'bg-emerald-500/20 border-emerald-500'
                            : filter === 'puts'
                            ? 'bg-red-500/20 border-red-500'
                            : 'bg-blue-500/20 border-blue-500'
                          : 'bg-gray-800/50 border-gray-700/30'
                      }`}>
                      <Text className={`text-sm text-center ${
                        optionTypeFilter === filter
                          ? filter === 'calls'
                            ? 'text-emerald-400 font-semibold'
                            : filter === 'puts'
                            ? 'text-red-400 font-semibold'
                            : 'text-blue-400 font-semibold'
                          : 'text-gray-300'
                      }`}>
                        {filter === 'both' ? 'Both' : filter === 'calls' ? 'Calls' : 'Puts'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Limit Selector */}
              <View className="mb-6">
                <Text className="text-gray-400 text-sm mb-3">Max Contracts: {limit}</Text>
                <View className="flex-row items-center gap-3">
                  <TouchableOpacity
                    onPress={() => setLimit(Math.max(1, limit - 5))}
                    className="bg-gray-800/50 rounded-lg px-4 py-2 border border-gray-700/30">
                    <Ionicons name="remove" size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                  <View className="flex-1 bg-gray-800/50 rounded-lg px-4 py-3 border border-gray-700/30">
                    <TextInput
                      value={limit.toString()}
                      onChangeText={(text) => {
                        const num = parseInt(text, 10);
                        if (!isNaN(num) && num >= 1 && num <= 100) {
                          setLimit(num);
                        }
                      }}
                      keyboardType="numeric"
                      className="text-white text-center text-base"
                      maxLength={3}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => setLimit(Math.min(100, limit + 5))}
                    className="bg-gray-800/50 rounded-lg px-4 py-2 border border-gray-700/30">
                    <Ionicons name="add" size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>
                <Text className="text-gray-500 text-xs mt-2 text-center">Range: 1-100</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Sort Menu Modal */}
      <Modal
        visible={showSortMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSortMenu(false)}>
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-center items-center"
          activeOpacity={1}
          onPress={() => setShowSortMenu(false)}>
          <View className="bg-gray-900 rounded-2xl p-4 w-[80%] max-w-sm">
            <Text className="text-white text-lg font-bold mb-4">Sort By</Text>
            {(['volume', 'expiration', 'strike', 'openInterest', 'dte'] as SortOption[]).map((option) => (
              <TouchableOpacity
                key={option}
                onPress={() => {
                  setSortBy(option);
                  setShowSortMenu(false);
                }}
                className={`flex-row items-center justify-between py-3 px-4 rounded-lg mb-2 ${
                  sortBy === option ? 'bg-blue-500/20' : 'bg-gray-800/50'
                }`}>
                <Text className={`text-base ${
                  sortBy === option ? 'text-blue-400 font-semibold' : 'text-gray-300'
                }`}>
                  {option === 'volume' ? 'Volume' : 
                   option === 'expiration' ? 'Expiration Date' :
                   option === 'strike' ? 'Strike Price' :
                   option === 'openInterest' ? 'Open Interest' :
                   'Days to Expiration'}
                </Text>
                {sortBy === option && (
                  <Ionicons name="checkmark" size={20} color="#60A5FA" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

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
      {!isLoading && !error && transformedOpportunities && transformedOpportunities.length > 0 && (
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
                  {transformedOpportunities?.length || 0} contract{(transformedOpportunities?.length || 0) !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>

            {/* Contracts List */}
            {transformedOpportunities?.map((contract) => {
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
