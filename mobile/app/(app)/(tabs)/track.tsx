import { useState, useMemo, useRef, useCallback } from 'react';
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
} from 'react-native';
import { addMonths, subMonths, startOfMonth, format, isSameMonth } from 'date-fns';
import { MonthCalendarBlock } from '@/common/components/track/MonthCalendarBlock';
import { NewTradeModal, type NewTradePayload } from '@/common/components/track/NewTradeModal';
import { PortfolioModalContent } from '@/common/components/track/PortfolioModal';
import { useUpsertPortfolioPosition } from '@/hooks/mutations/portfolio/useUpsertPortfolioPosition';
import { usePortfolioSummaryQuery } from '@/hooks/queries/track/usePortfolioSummary';
import { usePortfolioWithPrices } from '@/hooks/queries/track/usePortfolioWithPrices';
import { useThemeColors } from '@/lib/useColorScheme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PORTFOLIO_MODAL_HEIGHT = Math.max(SCREEN_HEIGHT * 0.75, 400);

type PnLPeriod = 'week' | 'month' | 'year';

const TrackScreen = () => {
  const colors = useThemeColors();
  const [period, setPeriod] = useState<PnLPeriod>('month');
  const [newTradeModalVisible, setNewTradeModalVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [portfolioModalVisible, setPortfolioModalVisible] = useState(false);

  const { data: portfolioSummary } = usePortfolioSummaryQuery();
  const { data: livePortfolio } = usePortfolioWithPrices();
  const upsertPosition = useUpsertPortfolioPosition();

  const displayPnL = useMemo(() => {
    const liveSummary = livePortfolio?.summary as { periodic_pnl?: Record<PnLPeriod, number> } | undefined;
    const livePeriodPnL = liveSummary?.periodic_pnl?.[period];
    if (typeof livePeriodPnL === 'number') return livePeriodPnL;

    const summaryWithPeriods = portfolioSummary as { periods?: Record<PnLPeriod, number | { realized?: number; unrealized?: number }> } | undefined;
    const summaryPeriod = summaryWithPeriods?.periods?.[period];
    if (summaryPeriod != null) {
      if (typeof summaryPeriod === 'number') return summaryPeriod;
      return (summaryPeriod.realized ?? 0) + (summaryPeriod.unrealized ?? 0);
    }

    if (livePortfolio?.summary) {
      const realized = portfolioSummary?.total_realized_pnl != null ? Number(portfolioSummary.total_realized_pnl) : 0;
      return realized + livePortfolio.summary.total_unrealized_pnl;
    }
    if (portfolioSummary != null) {
      return Number(portfolioSummary.total_realized_pnl) + (portfolioSummary.total_unrealized_pnl != null ? Number(portfolioSummary.total_unrealized_pnl) : 0);
    }

    return period === 'week' ? -45 : period === 'month' ? -225 : -1250;
  }, [livePortfolio, portfolioSummary, period]);

  const today = useMemo(() => new Date(), []);
  const currentMonthStart = useMemo(() => startOfMonth(today), [today]);

  const calendarMonths = useMemo(() => {
    const months: Date[] = [];
    for (let i = 12; i >= 1; i--) months.push(subMonths(currentMonthStart, i));
    months.push(currentMonthStart);
    for (let i = 1; i <= 6; i++) months.push(addMonths(currentMonthStart, i));
    return months;
  }, [currentMonthStart]);

  const scrollRef = useRef<ScrollView>(null);
  const currentMonthRef = useRef<View>(null);
  const hasScrolledToCurrent = useRef(false);

  const scrollToCurrentMonth = useCallback((event: LayoutChangeEvent) => {
    if (hasScrolledToCurrent.current) return;
    hasScrolledToCurrent.current = true;
    scrollRef.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false });
  }, []);

  const handleDayPress = useCallback((date: Date) => {
    setSelectedDate(date);
    setNewTradeModalVisible(true);
  }, []);

  const handleNewTradeSubmit = useCallback(
    async (payload: NewTradePayload) => {
      if (payload.type === 'trade') {
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
          console.error('Failed to add position from calendar:', e);
        }
        return;
      }
      setNewTradeModalVisible(false);
      setSelectedDate(null);
    },
    [upsertPosition]
  );

  const placeholderDailyPnL = useMemo<Record<string, number>>(() => {
    const entries: Record<string, number> = {};
    const losses: [number, number][] = [
      [3, 10], [4, 20], [6, 10], [10, 20], [11, 50], [12, 15], [15, 20],
      [18, 20], [19, 10], [20, 10], [21, 10], [22, 10], [24, 20],
    ];
    losses.forEach(([day, amount]) => {
      entries[format(new Date(2026, 0, day), 'yyyy-MM-dd')] = -amount;
    });
    entries[format(new Date(2026, 0, 25), 'yyyy-MM-dd')] = 30;
    return entries;
  }, []);

  const isPnLPositive = displayPnL >= 0;
  const pnlColor = isPnLPositive ? colors.accent : colors.error;

  const periodLabels: Record<PnLPeriod, string> = { week: 'Week', month: 'Month', year: 'Year' };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 }}>
            Track
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500', marginTop: 2 }}>
            Portfolio & Calendar
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => setPortfolioModalVisible(true)}
          activeOpacity={0.7}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            backgroundColor: colors.iconButton,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.iconButtonBorder,
            marginBottom: 2,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Portfolio</Text>
        </TouchableOpacity>
      </View>

      {/* P&L summary */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>Portfolio P&L</Text>

          {/* Period toggle */}
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: colors.surface,
              borderRadius: 100,
              padding: 3,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {(['week', 'month', 'year'] as const).map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 100,
                  backgroundColor: period === p ? colors.surfaceTertiary : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: period === p ? colors.text : colors.textSecondary,
                  }}
                >
                  {periodLabels[p]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end' }}>
          <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '500', marginRight: 6 }}>
            {isPnLPositive ? 'Profit' : 'Loss'}
          </Text>
          <Text style={{ color: pnlColor, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>
            {isPnLPositive ? '+' : ''}${Math.abs(displayPnL).toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Calendar */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 20, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {calendarMonths.map((monthDate) => {
          const isCurrentMonth = isSameMonth(monthDate, today);
          const block = (
            <MonthCalendarBlock
              key={format(monthDate, 'yyyy-MM')}
              monthDate={monthDate}
              dailyPnL={placeholderDailyPnL}
              today={today}
              onDayPress={handleDayPress}
            />
          );
          if (isCurrentMonth) {
            return (
              <View key={`wrap-${format(monthDate, 'yyyy-MM')}`} ref={currentMonthRef} onLayout={scrollToCurrentMonth}>
                {block}
              </View>
            );
          }
          return block;
        })}
      </ScrollView>

      <NewTradeModal
        visible={newTradeModalVisible}
        onClose={() => { setNewTradeModalVisible(false); setSelectedDate(null); }}
        selectedDate={selectedDate}
        onSubmit={handleNewTradeSubmit}
      />

      <Modal
        visible={portfolioModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPortfolioModalVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
          onPress={() => setPortfolioModalVisible(false)}
        >
          <Pressable
            style={{
              minHeight: PORTFOLIO_MODAL_HEIGHT,
              backgroundColor: colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTopWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
            }}
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
