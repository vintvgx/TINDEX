import { useState, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  LayoutChangeEvent,
  Modal,
  Pressable,
  Dimensions,
} from "react-native";
import { addMonths, subMonths, startOfMonth, format, isSameMonth } from "date-fns";
import { MonthCalendarBlock } from "@/common/components/track/MonthCalendarBlock";
import { NewTradeModal, type NewTradePayload } from "@/common/components/track/NewTradeModal";
import { PortfolioModalContent } from "@/common/components/track/PortfolioModal";
import { useUpsertPortfolioPosition } from "@/hooks/mutations/portfolio/useUpsertPortfolioPosition";
import { usePortfolioSummaryQuery } from "@/hooks/queries/track/usePortfolioSummary";
import { usePortfolioWithPrices } from "@/hooks/queries/track/usePortfolioWithPrices";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const PORTFOLIO_MODAL_HEIGHT = Math.max(SCREEN_HEIGHT * 0.75, 400); // Fits 3/4 of the screen

type PnLPeriod = "week" | "month" | "year";

/**
 * Track Screen - Portfolio P&L and scrollable calendar
 *
 * Displays:
 * 1. P&L summary above the calendar (period: week / month / year)
 * 2. Scrollable calendar where each option contract or trade is color-coordinated
 *    (red = loss, blue = profit) per day.
 *    TODO: color coordinate if input is an option or trade
 *
 */
const TrackScreen = () => {
  const [period, setPeriod] = useState<PnLPeriod>("month");
  const [newTradeModalVisible, setNewTradeModalVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [portfolioModalVisible, setPortfolioModalVisible] = useState(false);

  const { data: portfolioSummary } = usePortfolioSummaryQuery();
  const { data: livePortfolio } = usePortfolioWithPrices();
  const upsertPosition = useUpsertPortfolioPosition();

  // P&L: prefer live refresh (positions + current prices); fallback to portfolio summary table
  const displayPnL = useMemo(() => {
    if (livePortfolio?.summary) {
      const realized = portfolioSummary?.total_realized_pnl != null
        ? Number(portfolioSummary.total_realized_pnl)
        : 0;
      const unrealized = livePortfolio.summary.total_unrealized_pnl;
      return realized + unrealized;
    }
    if (portfolioSummary != null) {
      const realized = Number(portfolioSummary.total_realized_pnl);
      const unrealized = portfolioSummary.total_unrealized_pnl != null
        ? Number(portfolioSummary.total_unrealized_pnl)
        : 0;
      return realized + unrealized;
    }
    return period === "week" ? -45 : period === "month" ? -225 : -1250;
  }, [livePortfolio, portfolioSummary, period]);

  // Today so calendar can highlight current day and scroll to current month
  const today = useMemo(() => new Date(), []);
  const currentMonthStart = useMemo(() => startOfMonth(today), [today]);

  // Months ordered: scroll UP = past (12 months back), scroll DOWN = future (6 months forward)
  const calendarMonths = useMemo(() => {
    const months: Date[] = [];

    // past: 12 months back (oldest first)
    // TODO [2026-02-18] Make (12 months back) into variable
    for (let i = 12; i >= 1; i--) {
      months.push(subMonths(currentMonthStart, i));
    }

    // current month
    months.push(currentMonthStart);

    // future: next 6 months
    // TODO [2026-02-18] Make (next 6 months) into variable
    for (let i = 1; i <= 6; i++) {
      months.push(addMonths(currentMonthStart, i));
    }

    return months;
  }, [currentMonthStart]);

  const scrollRef = useRef<ScrollView>(null);
  const currentMonthRef = useRef<View>(null);
  const hasScrolledToCurrent = useRef(false);

  const scrollToCurrentMonth = useCallback((event: LayoutChangeEvent) => {
    if (hasScrolledToCurrent.current) return;
    const { y } = event.nativeEvent.layout;
    hasScrolledToCurrent.current = true;
    scrollRef.current?.scrollTo({ y, animated: false });
  }, []);

  const handleDayPress = useCallback((date: Date) => {
    setSelectedDate(date);
    setNewTradeModalVisible(true);
  }, []);

  const handleNewTradeSubmit = useCallback(
    async (payload: NewTradePayload) => {
      if (payload.type === "trade") {
        try {
          await upsertPosition.mutateAsync({
            ticker: payload.ticker,
            shares: payload.shares,
            average_cost: payload.pricePerShare,
            opened_at: payload.date,
          });
          setNewTradeModalVisible(false);
          setSelectedDate(null);
        } catch (e) {
          console.error("Failed to add position from calendar:", e);
        }
        return;
      }
      // Option: TODO persist to portfolio_positions or options table
      setNewTradeModalVisible(false);
      setSelectedDate(null);
    },
    [upsertPosition]
  );

  // Placeholder daily P&L for demo (inspired by attachment). Key: YYYY-MM-DD, value: P&L
  // TODO [2026-02-18] Update implementation for this. currently displaying P&L, but would like to display entered positioned. When pressed than P&L for individual position can be displayed
  const placeholderDailyPnL = useMemo<Record<string, number>>(() => {
    const entries: Record<string, number> = {};
    const losses: [number, number][] = [
      [3, 10], [4, 20], [6, 10], [10, 20], [11, 50], [12, 15], [15, 20],
      [18, 20], [19, 10], [20, 10], [21, 10], [22, 10], [24, 20],
    ];
    losses.forEach(([day, amount]) => {
      entries[format(new Date(2026, 0, day), "yyyy-MM-dd")] = -amount;
    });
    entries[format(new Date(2026, 0, 25), "yyyy-MM-dd")] = 30; // profit
    return entries;
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(17, 24, 39, 0.1)" }}
      />

      {/* Header */}
      <View className="px-6 py-4 border-b border-gray-800 flex-row items-center justify-between">
        <Text className="text-white text-3xl font-bold">Track</Text>
        <TouchableOpacity
          onPress={() => setPortfolioModalVisible(true)}
          activeOpacity={0.7}
          className="rounded-lg px-4 py-2 bg-gray-800/40"
          style={{ opacity: 0.85 }}
        >
          <Text className="text-gray-400 text-sm font-medium">Portfolio</Text>
        </TouchableOpacity>
      </View>

      {/* P&L section above calendar */}
      <View className="px-6 py-4 border-b border-gray-800">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-gray-400 text-sm font-medium">Portfolio P&L</Text>
          <View className="flex-row rounded-full bg-gray-800/50 p-0.5">
            {(["week", "month", "year"] as const).map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                className={`px-4 py-2 rounded-full ${
                  period === p ? "bg-gray-700" : "bg-transparent"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    period === p ? "text-white" : "text-gray-500"
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View className="flex-row items-baseline justify-end">
          <Text className="text-white text-base font-medium mr-2">Profit</Text>
          <Text
            className="text-2xl font-bold"
            style={{ color: displayPnL >= 0 ? "#3B82F6" : "#EF4444" }}
          >
            {displayPnL >= 0 ? "+" : ""}${displayPnL.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Scrollable calendar: scroll up = past months, scroll down = future months */}
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {calendarMonths.map((monthDate) => {
          const isCurrentMonth = isSameMonth(monthDate, today);
          const block = (
            <MonthCalendarBlock
              key={format(monthDate, "yyyy-MM")}
              monthDate={monthDate}
              dailyPnL={placeholderDailyPnL}
              today={today}
              onDayPress={handleDayPress}
            />
          );
          if (isCurrentMonth) {
            return (
              <View
                key={`wrap-${format(monthDate, "yyyy-MM")}`}
                ref={currentMonthRef}
                onLayout={scrollToCurrentMonth}
              >
                {block}
              </View>
            );
          }
          return block;
        })}
      </ScrollView>

      <NewTradeModal
        visible={newTradeModalVisible}
        onClose={() => {
          setNewTradeModalVisible(false);
          setSelectedDate(null);
        }}
        selectedDate={selectedDate}
        onSubmit={handleNewTradeSubmit}
      />

      {/* Portfolio modal: slides from bottom, ~3/4 screen */}
      <Modal
        visible={portfolioModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPortfolioModalVisible(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setPortfolioModalVisible(false)}
        >
          <Pressable
            style={{ minHeight: PORTFOLIO_MODAL_HEIGHT }}
            className="bg-gray-900 rounded-t-3xl border-t border-gray-800 overflow-hidden"
            onPress={(e) => e.stopPropagation()}
          >
            <PortfolioModalContent
              visible={portfolioModalVisible}
              onClose={() => setPortfolioModalVisible(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

export default TrackScreen;
