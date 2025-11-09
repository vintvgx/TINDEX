import type React from "react";
import type { OptionsOpportunity } from "@/common/types/blogPosts/ticker";
import { View, Text } from "react-native";

export const OptionsCard: React.FC<{ option: OptionsOpportunity }> = ({
  option,
}) => {
  const getBackgroundColor = () => {
    switch (option.signal_color || option.signal) {
      case "GREEN":
      case "BUY":
        return "bg-emerald-500";
      case "YELLOW":
      case "CONSIDER":
        return "bg-amber-500";
      case "RED":
      case "AVOID":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getBadgeColor = () => {
    return option.optionType === "CALL" ? "bg-emerald-500/30" : "bg-red-500/30";
  };

  return (
    <View className={`rounded-2xl p-4 mb-4 shadow-lg ${getBackgroundColor()}`}>
      {/* Header with symbol and score */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1 flex-row items-center gap-2">
          <Text className="text-base font-bold text-white tracking-wide">
            {option.contractSymbol}
          </Text>
          <View className={`px-2 py-1 rounded-md ${getBadgeColor()}`}>
            <Text className="text-[11px] font-semibold text-white">
              {option.optionType}
            </Text>
          </View>
        </View>
        <View className="items-end">
          <Text className="text-[11px] text-white/70 mb-0.5">Score</Text>
          <Text className="text-xl font-extrabold text-white">
            {option.total_score}
          </Text>
        </View>
      </View>

      {/* Main metrics */}
      <View className="flex-row flex-wrap mb-3 gap-3">
        <View className="min-w-[22%]">
          <Text className="text-[11px] text-white/70 mb-1 font-medium">
            Strike
          </Text>
          <Text className="text-[15px] font-bold text-white">
            ${option.strike.toFixed(2)}
          </Text>
        </View>
        <View className="min-w-[22%]">
          <Text className="text-[11px] text-white/70 mb-1 font-medium">
            Mark
          </Text>
          <Text className="text-[15px] font-bold text-white">
            ${option.mark.toFixed(2)}
          </Text>
        </View>
        <View className="min-w-[22%]">
          <Text className="text-[11px] text-white/70 mb-1 font-medium">
            DTE
          </Text>
          <Text className="text-[15px] font-bold text-white">{option.dte}</Text>
        </View>
        <View className="min-w-[22%]">
          <Text className="text-[11px] text-white/70 mb-1 font-medium">
            Volume
          </Text>
          <Text className="text-[15px] font-bold text-white">
            {option.volume.toLocaleString()}
          </Text>
        </View>
      </View>

      {/* Greeks and IV */}
      <View className="flex-row gap-4 py-3 border-t border-b border-white/20 mb-3">
        {option.delta !== null && (
          <View className="flex-1">
            <Text className="text-[11px] text-white/70 mb-1 font-medium">
              Delta
            </Text>
            <Text className="text-sm font-bold text-white">
              {option.delta.toFixed(3)}
            </Text>
          </View>
        )}
        <View className="flex-1">
          <Text className="text-[11px] text-white/70 mb-1 font-medium">IV</Text>
          <Text className="text-sm font-bold text-white">
            {(option.impliedVolatility * 100).toFixed(1)}%
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-[11px] text-white/70 mb-1 font-medium">
            Spread
          </Text>
          <Text className="text-sm font-bold text-white">
            {option.spreadPct.toFixed(2)}%
          </Text>
        </View>
      </View>

      {/* Reasons */}
      {option.reasons && (
        <View className="mb-2">
          <Text className="text-[13px] leading-[18px] text-white/95 font-medium">
            {option.reasons}
          </Text>
        </View>
      )}

      {/* Signal badge */}
      <View className="self-start px-3 py-1.5 rounded-lg bg-black/20">
        <Text className="text-xs font-bold text-white tracking-widest">
          {option.signal}
        </Text>
      </View>
    </View>
  );
};
