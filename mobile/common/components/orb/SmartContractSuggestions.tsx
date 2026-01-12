import React from 'react';
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/common/components/ui/text';
import type { OptionsOpportunity } from '@/common/types/blogPosts/ticker';
import { OptionsList } from '@/common/components/ticker/OptionsList';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useSuggestedContracts } from '@/hooks/queries/track/useSuggestedContracts';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';

/**
 * Smart Contract Suggestions Component
 * 
 * Displays top 3 suggested options contracts after ORB breakout:
 * - Automatically suggests top contracts based on OptionsAnalyzer scores
 * - Shows quick-track buttons for each contract
 * - Prioritized by score
 * 
 * Architecture:
 * - Modal component triggered after ORB breakout
 * - Uses OptionsAnalyzer scores to prioritize contracts
 * - Provides quick-track functionality
 */
interface SmartContractSuggestionsProps {
  visible: boolean;
  onClose: () => void;
  ticker: string;
  onTrackContract?: (contract: OptionsOpportunity) => void;
}

export const SmartContractSuggestions: React.FC<SmartContractSuggestionsProps> = ({
  visible,
  onClose,
  ticker,
  onTrackContract,
}) => {
  const { authState: { user } } = useAuth();
  const { data: suggestedContracts = [], isLoading, error } = useSuggestedContracts(ticker, 5);
  const trackContract = useTrackContract();
  const { data: trackedContracts = [] } = useTrackedContracts();
  const { data: tickerData } = useTickerQuery(ticker);
  
  // Create a Set of tracked contract symbols for quick lookup
  const trackedContractSymbols = React.useMemo(() => {
    return new Set(trackedContracts.map(c => c.contract_symbol));
  }, [trackedContracts]);

  // Get current price from ticker data
  const currentPrice = tickerData?.data?.current_price || 0;

  const handleTrackContract = async (contract: OptionsOpportunity) => {
    if (!user?.id) {
      Alert.alert("Authentication Required", "Please sign in to track contracts");
      return;
    }

    try {
      // Parse expiration date from contract
      const expirationDate = contract.expirationDate 
        ? new Date(contract.expirationDate).toISOString().split('T')[0]
        : '';

      // Call the track contract mutation
      await trackContract.mutateAsync({
        userId: user.id,
        ticker: ticker.toUpperCase(),
        contractSymbol: contract.contractSymbol,
        optionType: contract.optionType,
        strike: contract.strike,
        expirationDate: expirationDate,
        trackingSnapshot: contract,
        trackedFromSource: 'orb_breakout',
        initialAnalysisScore: contract.total_score,
      });

      // Call optional callback
      if (onTrackContract) {
        onTrackContract(contract);
      }

      // Delay alert to avoid navigation context issues during re-renders
      setTimeout(() => {
        Alert.alert("Success", `Contract ${contract.contractSymbol} is now being tracked`);
      }, 100);
    } catch (error) {
      console.error("Error tracking contract:", error);
      // Delay alert to avoid navigation context issues
      setTimeout(() => {
        Alert.alert(
          "Error",
          error instanceof Error ? error.message : "Failed to track contract"
        );
      }, 100);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      {/* Header */}
      <View className="bg-black pt-12 pb-4 px-6 border-b border-gray-800">
        <View className="flex-row justify-between items-center mb-2">
          <View className="flex-1">
            <Text className="text-2xl font-bold text-white">Suggested Contracts</Text>
            <Text className="text-gray-400 text-sm mt-1">
              Top 3 options for {ticker}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            className="bg-gray-800 rounded-full p-2 ml-4">
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Content */}
      <View className="flex-1 bg-black">
        {isLoading && !error && (
          <View className="flex-1 items-center justify-center py-12">
            <ActivityIndicator size="large" color="#10B981" />
            <Text className="text-gray-400 mt-4">Analyzing contracts...</Text>
          </View>
        )}

        {error && (
          <View className="flex-1 items-center justify-center px-6 py-12">
            <View className="bg-red-900/30 border border-red-700/50 rounded-xl p-6 w-full">
              <View className="flex-row items-start gap-3">
                <Ionicons name="alert-circle-outline" size={20} color="#EF4444" />
                <View className="flex-1">
                  <Text className="text-red-300 font-semibold text-sm mb-1">
                    Error Loading Contracts
                  </Text>
                  <Text className="text-red-400 text-xs">
                    {error instanceof Error ? error.message : 'Failed to load suggested contracts'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {!isLoading && !error && suggestedContracts.length === 0 && (
          <View className="flex-1 items-center justify-center px-6 py-12">
            <View className="bg-gray-900/50 rounded-xl p-8 items-center border border-gray-800 w-full">
              <Ionicons name="analytics-outline" size={48} color="#6B7280" />
              <Text className="text-gray-400 text-center mt-4 font-medium">
                No contracts available
              </Text>
              <Text className="text-gray-500 text-sm text-center mt-2">
                Options data not available for {ticker}
              </Text>
            </View>
          </View>
        )}

        {!isLoading && !error && suggestedContracts.length > 0 && (
          <OptionsList
            opportunities={suggestedContracts.slice(0, 5)}
            ticker={ticker}
            currentPrice={currentPrice}
            trackedContractSymbols={trackedContractSymbols}
            onTrackContract={handleTrackContract}
            isTracking={trackContract.isPending}
          />
        )}
      </View>
    </Modal>
  );
};
