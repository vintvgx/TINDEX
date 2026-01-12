import React, { useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/common/components/ui/text';
import type { OptionsOpportunity } from '@/common/types/blogPosts/ticker';
import { OptionsCard } from '@/common/components/ticker/OptionsTab';
import { useSuggestedContracts } from '@/hooks/queries/track/useSuggestedContracts';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useAuth } from '@/common/utils/context/auth/AuthContext';

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
  const [trackingContract, setTrackingContract] = useState<string | null>(null);

  const handleTrackContract = async (contract: OptionsOpportunity) => {
    if (!user?.id) {
      Alert.alert("Authentication Required", "Please sign in to track contracts");
      return;
    }

    if (trackingContract) {
      return; // Prevent duplicate tracking
    }

    setTrackingContract(contract.contractSymbol);

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

      Alert.alert("Success", `Contract ${contract.contractSymbol} is now being tracked`);
    } catch (error) {
      console.error("Error tracking contract:", error);
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to track contract"
      );
    } finally {
      setTrackingContract(null);
    }
  };

  // Sort contracts by score (highest first) - already sorted by API, but ensure
  const topContracts = React.useMemo(() => {
    return [...suggestedContracts]
      .sort((a, b) => b.total_score - a.total_score)
      .slice(0, 3);
  }, [suggestedContracts]);

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
      <ScrollView className="flex-1 bg-black" showsVerticalScrollIndicator={false}>
        <View className="px-6 py-6">
          {isLoading && !error && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#10B981" />
              <Text className="text-gray-400 mt-4">Analyzing contracts...</Text>
            </View>
          )}

          {error && (
            <View className="bg-red-900/30 border border-red-700/50 rounded-xl p-6 mb-4">
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
          )}

          {!isLoading && !error && topContracts.length === 0 && (
            <View className="bg-gray-900/50 rounded-xl p-8 items-center border border-gray-800">
              <Ionicons name="analytics-outline" size={48} color="#6B7280" />
              <Text className="text-gray-400 text-center mt-4 font-medium">
                No contracts available
              </Text>
              <Text className="text-gray-500 text-sm text-center mt-2">
                Options data not available for {ticker}
              </Text>
            </View>
          )}

          {!isLoading && !error && topContracts.length > 0 && (
            <>
              {/* Info Banner */}
              <View className="bg-blue-900/30 border border-blue-700/50 rounded-xl p-4 mb-6">
                <View className="flex-row items-start gap-3">
                  <Ionicons name="information-circle-outline" size={20} color="#60A5FA" />
                  <View className="flex-1">
                    <Text className="text-blue-300 font-semibold text-sm mb-1">
                      Top {topContracts.length} Contracts Selected
                    </Text>
                    <Text className="text-blue-400 text-xs">
                      These contracts are ranked by OptionsAnalyzer score. Click "Track" to add them to your portfolio.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Contracts List */}
              <View className="gap-4">
                {topContracts.map((contract, index) => (
                  <View key={contract.contractSymbol || index}>
                    {/* Rank Badge */}
                    <View className="flex-row items-center mb-2">
                      <View className="bg-emerald-500 rounded-full w-8 h-8 items-center justify-center mr-2">
                        <Text className="text-white font-bold text-sm">#{index + 1}</Text>
                      </View>
                      <Text className="text-gray-400 text-sm font-medium">
                        Score: {contract.total_score.toFixed(1)}
                      </Text>
                    </View>

                    {/* Contract Card */}
                    <View className="mb-4">
                      <OptionsCard option={contract} />
                      
                      {/* Track Button */}
                      <TouchableOpacity
                        onPress={() => handleTrackContract(contract)}
                        disabled={trackContract.isPending || trackingContract === contract.contractSymbol}
                        className={`rounded-xl p-4 items-center justify-center mt-3 ${
                          trackContract.isPending || trackingContract === contract.contractSymbol
                            ? 'bg-gray-600 opacity-50'
                            : 'bg-emerald-600 active:opacity-90'
                        }`}>
                        {trackContract.isPending && trackingContract === contract.contractSymbol ? (
                          <View className="flex-row items-center gap-2">
                            <ActivityIndicator size="small" color="#FFFFFF" />
                            <Text className="text-white font-semibold text-base">Tracking...</Text>
                          </View>
                        ) : (
                          <View className="flex-row items-center gap-2">
                            <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
                            <Text className="text-white font-semibold text-base">Track Contract</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Divider */}
                    {index < topContracts.length - 1 && (
                      <View className="h-px bg-gray-800 mb-4" />
                    )}
                  </View>
                ))}
              </View>

              {/* Footer Info */}
              <View className="mt-6 bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                <Text className="text-gray-400 text-xs text-center">
                  Contracts are ranked by OptionsAnalyzer scoring algorithm based on liquidity, Greeks, momentum, and value metrics.
                </Text>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </Modal>
  );
};
