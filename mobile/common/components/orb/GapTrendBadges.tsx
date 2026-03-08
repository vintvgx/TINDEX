import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { GapTrendContext, GapDirection, PriorDayTrend } from "@/common/types/orb";

export interface GapTrendBadgesProps {
  /** Gap/trend context from orb_ranges or notification payload */
  context: GapTrendContext | null | undefined;
  /** When true (e.g. notification detail), show breakout alignment instead of trend_continuation label */
  showBreakoutAlignment?: boolean;
  /** Compact layout for cards; default false for full badges */
  compact?: boolean;
}

const GAP_DIRECTION_COLORS: Record<GapDirection, { bg: string; text: string }> = {
  up: { bg: "bg-green-500/20", text: "text-green-400" },
  down: { bg: "bg-red-500/20", text: "text-red-400" },
  flat: { bg: "bg-gray-600/30", text: "text-gray-400" },
};

const TREND_COLORS: Record<PriorDayTrend, { bg: string; text: string }> = {
  bullish: { bg: "bg-green-500/20", text: "text-green-400" },
  bearish: { bg: "bg-red-500/20", text: "text-red-400" },
  flat: { bg: "bg-gray-600/30", text: "text-gray-400" },
};

/** Info modal content: glossary and why positive/negative matters by prior trend */
const GAP_TREND_INFO = {
  title: "Understanding Gap & Prior Day Trend",
  glossary: [
    {
      term: "Gap (Up / Down / Flat)",
      definition:
        "The difference between yesterday's closing price and today's opening price. Up = stock opened higher than prior close; Down = opened lower; Flat = opened near the prior close (small move).",
    },
    {
      term: "Prior Day Trend (Bullish / Bearish / Flat)",
      definition:
        "Whether the previous trading day closed above or below its open. Bullish = closed higher than open; Bearish = closed lower than open; Flat = little change between open and close.",
    },
    {
      term: "Continuation ✓",
      definition:
        "The gap direction aligns with the prior day's trend (e.g. bullish day + gap up, or bearish day + gap down). Suggests momentum is continuing into the open.",
    },
    {
      term: "Against Gap ⚠",
      definition:
        "The gap or breakout goes opposite to the prior trend (e.g. bullish day but gap down). Can signal reversal, profit-taking, or failed follow-through—worth extra caution.",
    },
  ],
  whyItMatters: [
    {
      prior: "After a bullish day",
      positive: "A gap up (positive) is favorable—it continues bullish momentum. Traders often see this as confirmation.",
      negative: "A gap down (negative) goes against the trend and can indicate profit-taking or a reversal; treat with more caution.",
    },
    {
      prior: "After a bearish day",
      positive: "A gap up (positive) can signal a bounce or short squeeze; it goes against the prior trend.",
      negative: "A gap down (negative) is favorable—it continues bearish momentum and suggests selling pressure persists.",
    },
    {
      prior: "After a flat day",
      positive:
        "Either direction is more neutral; continuation is less meaningful without a clear prior trend.",
      negative: null,
    },
  ],
};

/** Modal that explains gap/trend concepts and when positive/negative is favorable */
function GapTrendInfoModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/70 justify-center items-center px-4 py-6"
        onPress={onClose}
      >
        <Pressable
          className="w-full max-w-md bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="border-b border-gray-800 px-4 pt-4 pb-3 flex-row justify-between items-center">
            <Text className="text-lg font-bold text-white flex-1 pr-2">
              {GAP_TREND_INFO.title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              className="bg-gray-800 rounded-full p-2"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color="#9ca3af" />
            </TouchableOpacity>
          </View>
          <ScrollView
            className="max-h-[75%]"
            showsVerticalScrollIndicator
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <View className="px-4 pt-4">
              <Text className="text-sm font-semibold text-gray-300 mb-2">
                Key concepts
              </Text>
              {GAP_TREND_INFO.glossary.map((item, i) => (
                <View key={i} className="mb-4">
                  <Text className="text-sm font-semibold text-green-400 mb-1">
                    {item.term}
                  </Text>
                  <Text className="text-sm text-gray-400 leading-5">
                    {item.definition}
                  </Text>
                </View>
              ))}
              <Text className="text-sm font-semibold text-gray-300 mt-2 mb-2">
                Why positive or negative matters
              </Text>
              {GAP_TREND_INFO.whyItMatters.map((item, i) => (
                <View key={i} className="mb-4">
                  <Text className="text-sm font-semibold text-amber-400 mb-1">
                    {item.prior}
                  </Text>
                  {item.positive != null && (
                    <Text className="text-sm text-gray-400 leading-5 mb-1">
                      {item.positive}
                    </Text>
                  )}
                  {item.negative != null && (
                    <Text className="text-sm text-gray-400 leading-5">
                      {item.negative}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatGapLabel(context: GapTrendContext): string {
  if (context.gap_direction === "flat") return "Flat";
  const pct = context.gap_percent;
  const pts = context.gap_points;
  if (pct != null && pts != null) return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% (${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts)`;
  if (pct != null) return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  return "—";
}

/**
 * Renders gap badge, prior-day trend badge, and continuation/alignment indicator.
 * Used on ORB cards, detail modal, and notification modal.
 */
export const GapTrendBadges: React.FC<GapTrendBadgesProps> = ({
  context,
  showBreakoutAlignment = false,
  compact = false,
}) => {
  const [infoVisible, setInfoVisible] = useState(false);

  if (!context || context.gap_direction == null) return null;

  const gapDir = context.gap_direction;
  const priorTrend = context.prior_day_trend;
  const gapColors = GAP_DIRECTION_COLORS[gapDir] ?? GAP_DIRECTION_COLORS.flat;
  const trendColors = priorTrend ? TREND_COLORS[priorTrend] : { bg: "bg-gray-600/30", text: "text-gray-400" };

  const isContinuation = context.trend_continuation === true;
  const alignsGap = context.breakout_aligns_gap === true;
  const showCheck = showBreakoutAlignment ? alignsGap : isContinuation;
  const showWarning = showBreakoutAlignment ? (context.breakout_aligns_gap === false) : (context.trend_continuation === false);

  const gapLabel = formatGapLabel(context);
  const priorLabel = priorTrend ? `Prior Day: ${priorTrend.charAt(0).toUpperCase() + priorTrend.slice(1)}` : "Prior Day: —";

  const infoButton = (
    <TouchableOpacity
      onPress={() => setInfoVisible(true)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      className="self-center"
      accessibilityLabel="Learn about gap and trend concepts"
      accessibilityRole="button"
    >
      <Ionicons name="information-circle-outline" size={compact ? 16 : 20} color="#6b7280" />
    </TouchableOpacity>
  );

  if (compact) {
    return (
      <>
        <View className="flex-row flex-wrap items-center gap-1.5">
          {infoButton}
          <View className={`px-2 py-0.5 rounded ${gapColors.bg}`}>
            <Text className={`text-xs font-medium ${gapColors.text}`}>{gapLabel}</Text>
          </View>
          {priorTrend && (
            <View className={`px-2 py-0.5 rounded ${trendColors.bg}`}>
              <Text className={`text-xs font-medium ${trendColors.text}`}>{priorLabel}</Text>
            </View>
          )}
          {showCheck && (
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
          )}
          {showWarning && (
            <Ionicons name="warning" size={14} color="#F59E0B" />
          )}
        </View>
        <GapTrendInfoModal visible={infoVisible} onClose={() => setInfoVisible(false)} />
      </>
    );
  }

  return (
    <>
      <View className="flex-row flex-wrap items-center gap-2">
        {infoButton}
        <View className={`px-2.5 py-1 rounded-lg ${gapColors.bg}`}>
          <Text className={`text-sm font-semibold ${gapColors.text}`}>Gap: {gapLabel}</Text>
        </View>
        <View className={`px-2.5 py-1 rounded-lg ${trendColors.bg}`}>
          <Text className={`text-sm font-semibold ${trendColors.text}`}>{priorLabel}</Text>
        </View>
        {showCheck && (
          <View className="flex-row items-center">
            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            <Text className="text-green-400 text-sm font-medium ml-1">Continuation ✓</Text>
          </View>
        )}
        {showWarning && (
          <View className="flex-row items-center">
            <Ionicons name="warning" size={18} color="#F59E0B" />
            <Text className="text-amber-400 text-sm font-medium ml-1">Against Gap ⚠</Text>
          </View>
        )}
      </View>
      <GapTrendInfoModal visible={infoVisible} onClose={() => setInfoVisible(false)} />
    </>
  );
};
