import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StatusBar,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SmartContractSuggestions } from "@/common/components/orb/SmartContractSuggestions";
import { GapTrendBadges } from "@/common/components/orb/GapTrendBadges";
import type { OptionsOpportunity } from "@/common/types/blogPosts/ticker";
import type { GapTrendContext } from "@/common/types/orb";

/**
 * Interface for ORB breakout notification data
 */
export interface ORBBreakoutNotificationData {
  type: "orb_breakout" | "orb_breakout_confirmed" | "orb_breakout_invalidated";
  ticker: string;
  breakout_type: "above" | "below";
  price: number;
  screen: string;
  timestamp: string;
  // Enhanced breakout data (optional)
  breakout_analysis?: {
    signal: "BULLISH" | "BEARISH";
    score: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    reasons: string[];
    rvol: number;
    vwap_aligned: boolean;
    entry_price: number;
    stop_loss: number;
    risk_per_share: number;
  };
  orb_high?: number;
  orb_low?: number;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  score?: number;
  reasons?: string[];
  entry_price?: number;
  stop_loss?: number;
  risk_per_share?: number;
  rvol?: number;
  vwap_aligned?: boolean;
  // Gap & prior-day trend context (from backend notification payload)
  gap_percent?: number | null;
  gap_points?: number | null;
  gap_direction?: "up" | "down" | "flat" | null;
  prior_day_trend?: "bullish" | "bearish" | "flat" | null;
  trend_continuation?: boolean | null;
  breakout_aligns_gap?: boolean | null;
}

interface ORBNotificationModalProps {
  visible: boolean;
  onClose: () => void;
  notificationData: ORBBreakoutNotificationData | null;
  notificationBody?: string;
  notificationTitle?: string;
}

/**
 * Modal component for displaying ORB breakout notifications.
 *
 * Architecture:
 * - Displays detailed breakout information including confidence score, reasons, and trading metrics
 * - Supports both initial breakout and confirmation notifications
 * - Provides clear visual hierarchy with color-coded direction indicators
 *
 * Design:
 * - Dark theme with gradient accents
 * - Scrollable content for long notification bodies
 * - Clear close button and dismiss gesture
 */
export const ORBNotificationModal: React.FC<ORBNotificationModalProps> = ({
  visible,
  onClose,
  notificationData,
  notificationBody,
  notificationTitle,
}) => {
  const [suggestionsModalVisible, setSuggestionsModalVisible] = useState(false);

  if (!notificationData) return null;

  const isConfirmed = notificationData.type === "orb_breakout_confirmed";
  const isInvalidated = notificationData.type === "orb_breakout_invalidated";
  const isBullish = notificationData.breakout_type === "above";
  const directionEmoji = isBullish ? "🟢" : "🔴";
  const directionText = isBullish ? "BULLISH" : "BEARISH";
  const directionColor = isBullish ? "#10B981" : "#EF4444";
  const invalidatedColor = "#F59E0B"; // Amber/orange for warnings

  // Only show suggestions button for confirmed breakouts (not invalidated)
  const showSuggestionsButton = isConfirmed && !isInvalidated;

  const handleViewSuggestedContracts = () => {
    setSuggestionsModalVisible(true);
  };

  const handleTrackContract = (contract: OptionsOpportunity) => {
    // Track contract functionality will be handled by SmartContractSuggestions component
    console.log('Track contract:', contract.contractSymbol);
  };

  // Get breakout analysis data (prefer nested structure, fallback to flat)
  const analysis = notificationData.breakout_analysis || {
    signal: directionText as "BULLISH" | "BEARISH",
    score: notificationData.score || 0,
    confidence: notificationData.confidence || "MEDIUM",
    reasons: notificationData.reasons || [],
    rvol: notificationData.rvol || 0,
    vwap_aligned: notificationData.vwap_aligned || false,
    entry_price: notificationData.entry_price || notificationData.price,
    stop_loss: notificationData.stop_loss || 0,
    risk_per_share: notificationData.risk_per_share || 0,
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View className="flex-1 bg-black/80 justify-center items-center px-4">
        <Pressable 
          className="absolute inset-0" 
          onPress={onClose} 
        />
        <View className="bg-gray-900 rounded-3xl w-full max-w-md max-h-[85%] border border-gray-800 shadow-2xl">
          {/* Header */}
          <View className="flex-row items-center justify-between p-4 border-b border-gray-800">
            <View className="flex-row items-center flex-1">
              <View
                className="w-3 h-3 rounded-full mr-3"
                style={{ backgroundColor: isInvalidated ? invalidatedColor : directionColor }}
              />
              <Text className="text-white text-lg font-bold flex-1">
                {notificationTitle ||
                  `${isInvalidated ? "⚠️" : directionEmoji} ${notificationData.ticker} ORB ${
                    isConfirmed ? "CONFIRMED" : isInvalidated ? "INVALIDATED" : "BREAKOUT"
                  }`}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              className="w-8 h-8 items-center justify-center">
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={true}
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            nestedScrollEnabled={true}>
            {/* Notification Body */}
            {notificationBody && (
              <View className={`mb-4 p-3 rounded-lg border ${
                isInvalidated 
                  ? "bg-amber-900/30 border-amber-700/50" 
                  : "bg-gray-800/50 border-gray-700/50"
              }`}>
                <Text className={`text-sm leading-5 ${
                  isInvalidated ? "text-amber-200" : "text-gray-300"
                }`}>
                  {notificationBody}
                </Text>
              </View>
            )}

            {/* Invalidated Warning Banner */}
            {isInvalidated && (
              <View className="mb-4 p-3 bg-amber-900/20 rounded-lg border border-amber-700/50">
                <View className="flex-row items-center mb-1">
                  <Ionicons name="warning" size={18} color="#F59E0B" />
                  <Text className="text-amber-300 font-semibold ml-2">
                    Breakout Invalidated
                  </Text>
                </View>
                <Text className="text-amber-200 text-sm">
                  The price returned inside the ORB range after the 3-minute confirmation period. This breakout did not sustain.
                </Text>
              </View>
            )}

            {/* Gap & Prior Day Context (from notification data) */}
            {(notificationData.gap_direction != null || notificationData.prior_day_trend != null) && (
              <View className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
                <Text className="text-gray-400 text-sm mb-2">Gap & Prior Day</Text>
                <GapTrendBadges
                  context={
                    {
                      gap_percent: notificationData.gap_percent ?? null,
                      gap_points: notificationData.gap_points ?? null,
                      gap_direction: notificationData.gap_direction ?? null,
                      prior_day_trend: notificationData.prior_day_trend ?? null,
                      trend_continuation: notificationData.trend_continuation ?? null,
                      breakout_aligns_gap: notificationData.breakout_aligns_gap ?? null,
                    } as GapTrendContext
                  }
                  showBreakoutAlignment
                />
              </View>
            )}

            {/* Ticker and Direction */}
            <View className="mb-4">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-gray-400 text-sm">Ticker</Text>
                <Text className="text-white text-lg font-bold">
                  {notificationData.ticker}
                </Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-400 text-sm">Direction</Text>
                <View className="flex-row items-center">
                  <Text
                    className="text-base font-semibold mr-2"
                    style={{ color: directionColor }}>
                    {directionText}
                  </Text>
                  <Text className="text-base">{directionEmoji}</Text>
                </View>
              </View>
            </View>

            {/* Breakout Analysis Section */}
            {analysis && analysis.score > 0 && (
              <View className="mb-4">
                <Text className="text-white text-base font-semibold mb-3">
                  Breakout Analysis
                </Text>

                {/* Confidence Score */}
                <View className="mb-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-gray-400 text-sm">Confidence</Text>
                    <View
                      className="px-3 py-1 rounded-full"
                      style={{
                        backgroundColor:
                          analysis.confidence === "HIGH"
                            ? "#10B98120"
                            : analysis.confidence === "MEDIUM"
                              ? "#F59E0B20"
                              : "#EF444420",
                      }}>
                      <Text
                        className="text-xs font-semibold"
                        style={{
                          color:
                            analysis.confidence === "HIGH"
                              ? "#10B981"
                              : analysis.confidence === "MEDIUM"
                                ? "#F59E0B"
                                : "#EF4444",
                        }}>
                        {analysis.confidence}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-gray-400 text-sm">Score</Text>
                    <Text className="text-white text-lg font-bold">
                      {analysis.score}/100
                    </Text>
                  </View>
                </View>

                {/* Reasons */}
                {analysis.reasons && analysis.reasons.length > 0 && (
                  <View className="mb-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
                    <Text className="text-gray-400 text-sm mb-2">Reasons</Text>
                    {analysis.reasons.map((reason, index) => (
                      <View key={index} className="flex-row items-start mb-1.5">
                        <Text className="text-gray-500 mr-2 mt-0.5">
                          {reason.startsWith("⚠️") ? "⚠️" : "✓"}
                        </Text>
                        <Text
                          className="text-gray-300 text-sm flex-1"
                          style={{
                            color: reason.startsWith("⚠️")
                              ? "#F59E0B"
                              : "#10B981",
                          }}>
                          {reason.replace("⚠️", "").replace("✓", "").trim()}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Trading Metrics */}
            <View className="mb-4">
              <Text className="text-white text-base font-semibold mb-3">
                Trading Metrics
              </Text>

              <View>
                {/* Entry Price */}
                <View className="flex-row items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 mb-2">
                  <Text className="text-gray-400 text-sm">Entry Price</Text>
                  <Text className="text-white font-semibold">
                    {formatPrice(analysis.entry_price)}
                  </Text>
                </View>

                {/* Current/Breakout Price */}
                <View className="flex-row items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 mb-2">
                  <Text className="text-gray-400 text-sm">
                    {isConfirmed 
                      ? "Confirmed Price" 
                      : isInvalidated 
                      ? "Invalidated Price" 
                      : "Breakout Price"}
                  </Text>
                  <Text className="text-white font-semibold">
                    {formatPrice(notificationData.price)}
                  </Text>
                </View>

                {/* ORB High */}
                {notificationData.orb_high && (
                  <View className="flex-row items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 mb-2">
                    <Text className="text-gray-400 text-sm">ORB High</Text>
                    <Text className="text-white font-semibold">
                      {formatPrice(notificationData.orb_high)}
                    </Text>
                  </View>
                )}

                {/* ORB Low */}
                {notificationData.orb_low && (
                  <View className="flex-row items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 mb-2">
                    <Text className="text-gray-400 text-sm">ORB Low</Text>
                    <Text className="text-white font-semibold">
                      {formatPrice(notificationData.orb_low)}
                    </Text>
                  </View>
                )}

                {/* Stop Loss */}
                {analysis.stop_loss > 0 && (
                  <View className="flex-row items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 mb-2">
                    <Text className="text-gray-400 text-sm">Stop Loss</Text>
                    <Text className="text-white font-semibold">
                      {formatPrice(analysis.stop_loss)}
                    </Text>
                  </View>
                )}

                {/* Risk Per Share */}
                {analysis.risk_per_share > 0 && (
                  <View className="flex-row items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-red-500/30 mb-2">
                    <Text className="text-gray-400 text-sm">
                      Risk Per Share
                    </Text>
                    <Text className="text-red-400 font-semibold">
                      {formatPrice(analysis.risk_per_share)}
                    </Text>
                  </View>
                )}

                {/* Relative Volume */}
                {analysis.rvol > 0 && (
                  <View className="flex-row items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 mb-2">
                    <Text className="text-gray-400 text-sm">
                      Relative Volume
                    </Text>
                    <Text className="text-white font-semibold">
                      {analysis.rvol.toFixed(2)}x
                    </Text>
                  </View>
                )}

                {/* VWAP Alignment */}
                <View className="flex-row items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
                  <Text className="text-gray-400 text-sm">VWAP Alignment</Text>
                  <View className="flex-row items-center">
                    {analysis.vwap_aligned ? (
                      <>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color="#10B981"
                        />
                        <Text className="text-green-400 text-sm ml-1">
                          Aligned
                        </Text>
                      </>
                    ) : (
                      <>
                        <Ionicons
                          name="close-circle"
                          size={18}
                          color="#EF4444"
                        />
                        <Text className="text-red-400 text-sm ml-1">
                          Diverged
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              </View>
            </View>

            {/* Suggested Contracts Button - Only for confirmed breakouts */}
            {showSuggestionsButton && (
              <View className="mt-4 pt-4 border-t border-gray-800">
                <TouchableOpacity
                  onPress={handleViewSuggestedContracts}
                  className="bg-emerald-600/20 border border-emerald-500/50 rounded-xl p-4 items-center justify-center active:opacity-90">
                  <View className="flex-row items-center gap-3">
                    <Ionicons name="analytics-outline" size={20} color="#10B981" />
                    <Text className="text-emerald-400 font-semibold text-base">
                      View Suggested Contracts
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="#10B981" />
                  </View>
                  <Text className="text-emerald-500/70 text-xs mt-1 text-center">
                    Top 3 options contracts ranked by score
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Timestamp */}
            <View className="mt-4 pt-4 border-t border-gray-800">
              <Text className="text-gray-500 text-xs text-center">
                {formatTimestamp(notificationData.timestamp)}
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>

      {/* Smart Contract Suggestions Modal */}
      <SmartContractSuggestions
        visible={suggestionsModalVisible}
        onClose={() => setSuggestionsModalVisible(false)}
        ticker={notificationData.ticker}
        onTrackContract={handleTrackContract}
      />
    </Modal>
  );
};
