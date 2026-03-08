import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { OptionsOpportunity } from '@/common/types/blogPosts/ticker';

interface OptionsContractLineProps {
  contract: OptionsOpportunity;
  isTracked?: boolean;
  onPress: () => void;
}

export const OptionsContractLine: React.FC<OptionsContractLineProps> = ({
  contract,
  isTracked = false,
  onPress,
}) => {
  const getBackgroundColor = () => {
    return contract.optionType === 'CALL' 
      ? 'bg-emerald-500/10' 
      : 'bg-red-500/10';
  };

  const getBorderColor = () => {
    return contract.optionType === 'CALL' 
      ? 'border-emerald-500/30' 
      : 'border-red-500/30';
  };

  const getTextColor = () => {
    return contract.optionType === 'CALL' 
      ? 'text-emerald-400' 
      : 'text-red-400';
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className={`rounded-lg p-3 mb-2 ${getBackgroundColor()} ${
        isTracked ? 'border-2 border-blue-500' : `border ${getBorderColor()}`
      }`}>
      <View className="flex-row items-center justify-between">
        {/* Left side - Strike and Type */}
        <View className="flex-row items-center gap-3 flex-1">
          <View className={`w-12 h-8 rounded items-center justify-center ${
            contract.optionType === 'CALL' ? 'bg-emerald-500/20' : 'bg-red-500/20'
          }`}>
            <Text className={`text-xs font-bold ${getTextColor()}`}>
              {contract.optionType === 'CALL' ? 'C' : 'P'}
            </Text>
          </View>
          <View>
            <Text className="text-white font-semibold text-base">
              ${contract.strike.toFixed(2)}
            </Text>
            {isTracked && (
              <View className="flex-row items-center gap-1 mt-0.5">
                <Ionicons name="checkmark-circle" size={12} color="#60A5FA" />
                <Text className="text-blue-400 text-xs">Tracked</Text>
              </View>
            )}
          </View>
        </View>

        {/* Middle - Key Metrics */}
        <View className="flex-row items-center gap-4 flex-1 justify-center">
          <View className="items-center">
            <Text className="text-gray-400 text-xs mb-0.5">Mark</Text>
            <Text className="text-white font-semibold text-sm">
              ${contract.mark.toFixed(2)}
            </Text>
          </View>
          <View className="items-center">
            <Text className="text-gray-400 text-xs mb-0.5">DTE</Text>
            <Text className="text-white font-semibold text-sm">
              {contract.dte}
            </Text>
          </View>
          <View className="items-center">
            <Text className="text-gray-400 text-xs mb-0.5">Vol</Text>
            <Text className="text-white font-semibold text-sm">
              {contract.volume.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Right side - Score */}
        <View className="items-end flex-1">
          <Text className="text-gray-400 text-xs mb-0.5">Score</Text>
          <View className="flex-row items-center gap-1">
            <Text className="text-white font-bold text-base">
              {contract.total_score.toFixed(1)}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </View>
        </View>
      </View>

      {/* Greeks Section */}
      <View className="mt-3 pt-3 border-t border-gray-700/30">
        <Text className="text-gray-400 text-xs mb-2">Greeks</Text>
        <View className="flex-row flex-wrap gap-x-4 gap-y-2">
          <View className="flex-1 min-w-[80px]">
            <Text className="text-gray-500 text-xs mb-0.5">Delta</Text>
            <Text className="text-white text-sm font-semibold">
              {contract.delta !== null ? contract.delta.toFixed(4) : 'Not Available'}
            </Text>
          </View>
          <View className="flex-1 min-w-[80px]">
            <Text className="text-gray-500 text-xs mb-0.5">Gamma</Text>
            <Text className="text-white text-sm font-semibold">
              {contract.gamma !== null ? contract.gamma.toFixed(4) : 'Not Available'}
            </Text>
          </View>
          <View className="flex-1 min-w-[80px]">
            <Text className="text-gray-500 text-xs mb-0.5">Theta</Text>
            <Text className="text-white text-sm font-semibold">
              {contract.theta !== null ? contract.theta.toFixed(4) : 'Not Available'}
            </Text>
          </View>
          <View className="flex-1 min-w-[80px]">
            <Text className="text-gray-500 text-xs mb-0.5">Vega</Text>
            <Text className="text-white text-sm font-semibold">
              {contract.vega !== null ? contract.vega.toFixed(4) : 'Not Available'}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};
