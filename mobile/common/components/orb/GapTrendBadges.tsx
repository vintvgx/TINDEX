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
import { GAP_TREND_INFO } from "@/common/docs/GapTrendingBadge/GapTrendInfo";

export interface GapTrendBadgesProps {
  /** Gap/trend context from orb_ranges or notification payload */
  context: GapTrendContext | null | undefined;
  /** When true (e.g. notification detail), show breakout alignment instead of trend_continuation label */
  showBreakoutAlignment?: boolean;
  /** Compact layout for cards; default false for full badges */
  compact?: boolean;
}

/** Term type for glossary styling: continuation = green, againstGap = caution/amber */
export type GapBadgeGlossaryTermKey = "gap" | "priorTrend" | "continuation" | "againstGap";

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

/** Modal that explains gap/trend concepts and when positive/negative is favorable */
function GapTrendInfoModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const termColor = (key: GapBadgeGlossaryTermKey) => {
    if (key === "continuation") return "#10B981"; // green
    if (key === "againstGap") return "#D97706";   // amber/caution (not green)
    return "#9ca3af"; // gray for gap, priorTrend
  };

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
          style={{ height: "90%" }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="border-b border-gray-800 px-4 pt-4 pb-3 flex-row justify-between items-center">
            <Text className="text-lg font-bold text-white flex-1 pr-2">
              📖 {GAP_TREND_INFO.title}
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
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={true}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 }}
          >
            <Text className="text-sm font-semibold text-gray-300 mb-3">
              📌 Key concepts
            </Text>
            {GAP_TREND_INFO.glossary.map((item, i) => (
              <View key={i} className="mb-4">
                <Text
                  className="text-sm font-semibold mb-1.5"
                  style={{ color: termColor(item.key) }}
                >
                  {item.term}
                </Text>
                {item.definition.split("\n").map((line, j) => (
                  <Text
                    key={j}
                    className="text-sm text-gray-400 leading-6"
                    style={{ marginTop: j > 0 ? 2 : 0 }}
                  >
                    {line || " "}
                  </Text>
                ))}
              </View>
            ))}
            <Text className="text-sm font-semibold text-gray-300 mt-4 mb-3">
              💡 Why positive or negative matters
            </Text>
            {GAP_TREND_INFO.whyItMatters.map((item, i) => (
              <View key={i} className="mb-4">
                <Text className="text-sm font-semibold text-amber-400 mb-1.5">
                  {item.prior}
                </Text>
                {item.positive != null && (
                  <View className="mb-1.5">
                    {item.positive.split("\n").map((line, j) => (
                      <Text
                        key={j}
                        className="text-sm text-gray-400 leading-6"
                        style={{ marginTop: j > 0 ? 2 : 0 }}
                      >
                        {line || " "}
                      </Text>
                    ))}
                  </View>
                )}
                {item.negative != null && (
                  <View>
                    {item.negative.split("\n").map((line, j) => (
                      <Text
                        key={j}
                        className="text-sm text-gray-400 leading-6"
                        style={{ marginTop: j > 0 ? 2 : 0 }}
                      >
                        {line || " "}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ))}
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

  const positiveLabel = showBreakoutAlignment ? "Aligns Gap ✓" : "Continuation ✓";
  const negativeLabel = showBreakoutAlignment ? "Against Gap ⚠" : "Against Prior Trend ⚠";

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
            <Ionicons name="warning" size={14} color="#D97706" />
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
            <Text className="text-green-400 text-sm font-medium ml-1">{positiveLabel}</Text>
          </View>
        )}
        {showWarning && (
          <View className="flex-row items-center">
            <Ionicons name="warning" size={18} color="#F59E0B" />
            <Text className="text-sm font-medium ml-1" style={{ color: "#D97706" }}>{negativeLabel}</Text>
          </View>
        )}
      </View>
      <GapTrendInfoModal visible={infoVisible} onClose={() => setInfoVisible(false)} />
    </>
  );
};
