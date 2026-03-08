import type React from "react"
import { View, Text, TouchableOpacity, ScrollView, Modal, Dimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { OptionsOpportunity } from "@/common/types/blogPosts/ticker"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")

interface OptionsContractDetailModalProps {
  visible: boolean
  onClose: () => void
  contract: OptionsOpportunity | null
  ticker: string
  currentPrice: number
  isTracked?: boolean
  onTrackContract?: () => void
  isTracking?: boolean
}

export const OptionsContractDetailModal: React.FC<OptionsContractDetailModalProps> = ({
  visible,
  onClose,
  contract,
  ticker,
  currentPrice,
  isTracked = false,
  onTrackContract,
  isTracking = false,
}) => {
  const insets = useSafeAreaInsets()

  if (!contract) return null

  const getBackgroundColor = () => {
    return contract.optionType === "CALL"
      ? "bg-emerald-500/10 border-emerald-500/30"
      : "bg-red-500/10 border-red-500/30"
  }

  const getTextColor = () => {
    return contract.optionType === "CALL" ? "text-emerald-400" : "text-red-400"
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(2)}%`
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-gray-900" style={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-4 border-b border-gray-800">
          <View className="flex-1">
            <Text className="text-white font-bold text-lg" numberOfLines={1}>
              {contract.contractSymbol}
            </Text>
            <Text className="text-gray-400 text-sm">
              {ticker} · ${currentPrice.toFixed(2)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            className="w-10 h-10 items-center justify-center rounded-full bg-gray-800"
          >
            <Ionicons name="close" size={24} color="#9CA3AF" />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header Card */}
          <View className={`rounded-xl p-4 mb-4 border ${getBackgroundColor()}`}>
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-3">
                <View
                  className={`w-12 h-12 rounded-xl items-center justify-center ${
                    contract.optionType === "CALL" ? "bg-emerald-500/20" : "bg-red-500/20"
                  }`}
                >
                  <Text className={`text-base font-bold ${getTextColor()}`}>{contract.optionType}</Text>
                </View>
                <View>
                  <Text className="text-white font-bold text-xl">{ticker}</Text>
                  <Text className="text-gray-400 text-sm">Strike: {formatCurrency(contract.strike)}</Text>
                </View>
              </View>
              {isTracked && (
                <View className="flex-row items-center gap-1 bg-blue-500/20 px-3 py-1.5 rounded-full">
                  <Ionicons name="checkmark-circle" size={16} color="#60A5FA" />
                  <Text className="text-blue-400 text-sm font-semibold">Tracked</Text>
                </View>
              )}
            </View>

            {/* Score */}
            <View className="bg-black/30 rounded-xl p-4 items-center">
              <Text className="text-gray-400 text-xs mb-1">OptionsAnalyzer Score</Text>
              <Text className="text-white text-4xl font-bold">{contract.total_score.toFixed(1)}</Text>
              <View
                className={`mt-2 px-3 py-1 rounded-full ${
                  contract.signal === "BUY"
                    ? "bg-emerald-500/20"
                    : contract.signal === "CONSIDER"
                      ? "bg-amber-500/20"
                      : "bg-red-500/20"
                }`}
              >
                <Text
                  className={`text-sm font-bold ${
                    contract.signal === "BUY"
                      ? "text-emerald-400"
                      : contract.signal === "CONSIDER"
                        ? "text-amber-400"
                        : "text-red-400"
                  }`}
                >
                  {contract.signal}
                </Text>
              </View>
            </View>
          </View>

          {/* Pricing Section */}
          <View className="mb-4">
            <Text className="text-white font-semibold text-base mb-3">Pricing</Text>
            <View className="bg-gray-800/50 rounded-xl p-4">
              <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                <Text className="text-gray-400 text-sm">Mark</Text>
                <Text className="text-white font-semibold">{formatCurrency(contract.mark)}</Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                <Text className="text-gray-400 text-sm">Bid</Text>
                <Text className="text-white font-semibold">{formatCurrency(contract.bid)}</Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                <Text className="text-gray-400 text-sm">Ask</Text>
                <Text className="text-white font-semibold">{formatCurrency(contract.ask)}</Text>
              </View>
              <View className="flex-row justify-between py-2">
                <Text className="text-gray-400 text-sm">Spread</Text>
                <Text className="text-white font-semibold">{contract.spreadPct.toFixed(2)}%</Text>
              </View>
            </View>
          </View>

          {/* Contract Details Section */}
          <View className="mb-4">
            <Text className="text-white font-semibold text-base mb-3">Contract Details</Text>
            <View className="bg-gray-800/50 rounded-xl p-4">
              <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                <Text className="text-gray-400 text-sm">Expiration</Text>
                <Text className="text-white font-semibold">
                  {new Date(contract.expirationDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                <Text className="text-gray-400 text-sm">Days to Expiration</Text>
                <Text className="text-white font-semibold">{contract.dte} days</Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                <Text className="text-gray-400 text-sm">Volume</Text>
                <Text className="text-white font-semibold">{contract.volume.toLocaleString()}</Text>
              </View>
              <View className="flex-row justify-between py-2">
                <Text className="text-gray-400 text-sm">Open Interest</Text>
                <Text className="text-white font-semibold">{contract.openInterest.toLocaleString()}</Text>
              </View>
            </View>
          </View>

          {/* Greeks Section */}
          {(contract.delta !== null ||
            contract.gamma !== null ||
            contract.theta !== null ||
            contract.vega !== null) && (
            <View className="mb-4">
              <Text className="text-white font-semibold text-base mb-3">Greeks</Text>
              <View className="bg-gray-800/50 rounded-xl p-4">
                {contract.delta !== null && (
                  <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                    <Text className="text-gray-400 text-sm">Delta</Text>
                    <Text className="text-white font-semibold">{contract.delta.toFixed(4)}</Text>
                  </View>
                )}
                {contract.gamma !== null && (
                  <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                    <Text className="text-gray-400 text-sm">Gamma</Text>
                    <Text className="text-white font-semibold">{contract.gamma.toFixed(4)}</Text>
                  </View>
                )}
                {contract.theta !== null && (
                  <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                    <Text className="text-gray-400 text-sm">Theta</Text>
                    <Text className="text-white font-semibold">{contract.theta.toFixed(4)}</Text>
                  </View>
                )}
                {contract.vega !== null && (
                  <View className="flex-row justify-between py-2">
                    <Text className="text-gray-400 text-sm">Vega</Text>
                    <Text className="text-white font-semibold">{contract.vega.toFixed(4)}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Volatility Section */}
          <View className="mb-4">
            <Text className="text-white font-semibold text-base mb-3">Volatility</Text>
            <View className="bg-gray-800/50 rounded-xl p-4">
              <View className="flex-row justify-between py-2">
                <Text className="text-gray-400 text-sm">Implied Volatility</Text>
                <Text className="text-white font-semibold">{formatPercent(contract.impliedVolatility)}</Text>
              </View>
            </View>
          </View>

          {/* Value Analysis Section */}
          <View className="mb-4">
            <Text className="text-white font-semibold text-base mb-3">Value Analysis</Text>
            <View className="bg-gray-800/50 rounded-xl p-4">
              <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                <Text className="text-gray-400 text-sm">Intrinsic Value</Text>
                <Text className="text-white font-semibold">{formatCurrency(contract.intrinsicValue)}</Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                <Text className="text-gray-400 text-sm">Extrinsic Value</Text>
                <Text className="text-white font-semibold">{formatCurrency(contract.extrinsicValue)}</Text>
              </View>
              <View className="flex-row justify-between py-2">
                <Text className="text-gray-400 text-sm">Moneyness</Text>
                <Text className="text-white font-semibold">{contract.moneyness.toFixed(3)}</Text>
              </View>
            </View>
          </View>

          {/* Reasons / Analysis Section */}
          {contract.reasons && (
            <View className="mb-4">
              <Text className="text-white font-semibold text-base mb-3">Analysis</Text>
              <View className="bg-gray-800/50 rounded-xl p-4">
                <Text className="text-gray-300 text-sm leading-6">{contract.reasons}</Text>
              </View>
            </View>
          )}

          {/* Score Breakdown Section */}
          {contract.score_breakdown && (
            <View className="mb-4">
              <Text className="text-white font-semibold text-base mb-3">Score Breakdown</Text>
              <View className="bg-gray-800/50 rounded-xl p-4">
                <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                  <Text className="text-gray-400 text-sm">Volume</Text>
                  <Text className="text-white font-semibold">{contract.score_breakdown.volume.toFixed(1)}</Text>
                </View>
                <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                  <Text className="text-gray-400 text-sm">Liquidity</Text>
                  <Text className="text-white font-semibold">{contract.score_breakdown.liquidity.toFixed(1)}</Text>
                </View>
                <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                  <Text className="text-gray-400 text-sm">Greeks</Text>
                  <Text className="text-white font-semibold">{contract.score_breakdown.greeks.toFixed(1)}</Text>
                </View>
                <View className="flex-row justify-between py-2 border-b border-gray-700/50">
                  <Text className="text-gray-400 text-sm">Momentum</Text>
                  <Text className="text-white font-semibold">{contract.score_breakdown.momentum.toFixed(1)}</Text>
                </View>
                <View className="flex-row justify-between py-2">
                  <Text className="text-gray-400 text-sm">Value</Text>
                  <Text className="text-white font-semibold">{contract.score_breakdown.value.toFixed(1)}</Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Fixed Bottom Track Button */}
        <View
          className="absolute bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 px-4 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {!isTracked && onTrackContract ? (
            <TouchableOpacity
              onPress={onTrackContract}
              disabled={isTracking}
              className={`bg-emerald-600 rounded-xl py-4 items-center justify-center ${isTracking ? "opacity-50" : ""}`}
              activeOpacity={0.8}
            >
              <View className="flex-row items-center gap-2">
                {isTracking ? (
                  <Text className="text-white font-bold text-base">Tracking...</Text>
                ) : (
                  <>
                    <Ionicons name="add-circle" size={22} color="#FFFFFF" />
                    <Text className="text-white font-bold text-base">Track Contract</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          ) : (
            <View className="bg-blue-500/20 border border-blue-500/50 rounded-xl py-4 items-center">
              <View className="flex-row items-center gap-2">
                <Ionicons name="checkmark-circle" size={22} color="#60A5FA" />
                <Text className="text-blue-400 font-bold text-base">Contract is being tracked</Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}
