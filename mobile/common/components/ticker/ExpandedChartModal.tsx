import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { PriceChart } from '@/common/components/ticker/PriceChart';
import { filterByPeriod, type ChartPeriod, type IndicatorLine } from '@/common/utils/chartUtils';
import type { TickerData } from '@/common/types/blogPosts/ticker';

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIODS: ChartPeriod[] = ['1D', '1W', '1M', 'YTD', '1Y', '5Y', 'Max'];
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CHART_HORIZONTAL_PADDING = 16;
const CHART_WIDTH = SCREEN_WIDTH - CHART_HORIZONTAL_PADDING * 2;
const CHART_HEIGHT = Math.round(SCREEN_HEIGHT * 0.38);

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  stockData: TickerData;
  initialPeriod: ChartPeriod;
  indicators?: IndicatorLine[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ExpandedChartModal: React.FC<Props> = ({
  visible,
  onClose,
  stockData,
  initialPeriod,
  indicators = [],
}) => {
  const colors = useThemeColors();
  const [period, setPeriod] = useState<ChartPeriod>(initialPeriod);

  const chartResult = useMemo(() => {
    if (period === '1D' && stockData.intraday_data?.dates?.length) {
      const { dates, prices } = stockData.intraday_data;
      return filterByPeriod(dates, prices, period);
    }
    const hist = stockData.historical_data;
    if (!hist?.dates?.length || !hist?.prices?.length) return null;
    return filterByPeriod(hist.dates, hist.prices, period);
  }, [stockData.historical_data, stockData.intraday_data, period]);

  const periodChangeColor = chartResult
    ? chartResult.isPositive
      ? colors.success
      : colors.error
    : colors.textTertiary;

  const periodChangeText = chartResult
    ? `${chartResult.isPositive ? '+' : ''}${chartResult.priceChange.toFixed(2)} (${
        chartResult.isPositive ? '+' : ''
      }${chartResult.priceChangePct.toFixed(2)}%)`
    : '';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent={false}
    >
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={colors.background === '#FFFFFF' ? 'dark-content' : 'light-content'} />

        {/* ── Header ── */}
        <View style={[s.header, { borderBottomColor: colors.separator }]}>
          <View style={s.headerLeft}>
            <Text style={[s.ticker, { color: colors.text }]}>{stockData.ticker}</Text>
            <Text style={[s.companyName, { color: colors.textSecondary }]} numberOfLines={1}>
              {stockData.company_name}
            </Text>
          </View>

          <View style={s.headerRight}>
            {periodChangeText ? (
              <Text style={[s.periodChange, { color: periodChangeColor }]}>
                {periodChangeText}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              style={[s.closeBtn, { backgroundColor: colors.iconButton, borderColor: colors.iconButtonBorder }]}
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Chart ── */}
        <View style={s.chartArea}>
          {chartResult && chartResult.points.length >= 2 ? (
            <PriceChart
              points={chartResult.points}
              period={period}
              width={CHART_WIDTH}
              height={CHART_HEIGHT}
              isPositive={chartResult.isPositive}
              indicators={indicators}
            />
          ) : (
            <View style={[s.chartEmpty, { borderColor: colors.border, height: CHART_HEIGHT }]}>
              <Ionicons name="bar-chart-outline" size={36} color={colors.textTertiary} />
              <Text style={[s.chartEmptyText, { color: colors.textSecondary }]}>
                No data for this period
              </Text>
            </View>
          )}
        </View>

        {/* ── Period selector ── */}
        <View style={[s.periodRow, { borderBottomColor: colors.separator }]}>
          {PERIODS.map(p => {
            const active = period === p;
            return (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                activeOpacity={0.75}
                style={[
                  s.periodBtn,
                  active && { backgroundColor: colors.accent + '22', borderColor: colors.accent + '55' },
                  !active && { borderColor: 'transparent' },
                ]}
              >
                <Text
                  style={[
                    s.periodLabel,
                    { color: active ? colors.accent : colors.textTertiary },
                    active && { fontWeight: '700' },
                  ]}
                >
                  {p}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Indicator toggle area (future) ── */}
        <View style={s.indicatorArea}>
          <Text style={[s.indicatorHint, { color: colors.textTertiary }]}>
            Indicators coming soon
          </Text>
        </View>

        {/* ── Stats row ── */}
        <View style={[s.statsRow, { borderTopColor: colors.separator }]}>
          <StatPill label="Open" value={stockData.day_high != null ? `$${stockData.day_high.toFixed(2)}` : '—'} colors={colors} />
          <StatPill label="Low" value={stockData.day_low != null ? `$${stockData.day_low.toFixed(2)}` : '—'} colors={colors} />
          <StatPill label="52W H" value={stockData.year_high != null ? `$${stockData.year_high.toFixed(2)}` : '—'} colors={colors} />
          <StatPill label="52W L" value={stockData.year_low != null ? `$${stockData.year_low.toFixed(2)}` : '—'} colors={colors} />
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// ─── Stat pill ────────────────────────────────────────────────────────────────

interface StatPillProps {
  label: string;
  value: string;
  colors: ReturnType<typeof useThemeColors>;
}

const StatPill: React.FC<StatPillProps> = ({ label, value, colors }) => (
  <View style={[s.statPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <Text style={[s.statLabel, { color: colors.textTertiary }]}>{label}</Text>
    <Text style={[s.statValue, { color: colors.text }]}>{value}</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  ticker: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  companyName: {
    fontSize: 13,
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  periodChange: {
    fontSize: 14,
    fontWeight: '600',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartArea: {
    paddingHorizontal: CHART_HORIZONTAL_PADDING,
    paddingTop: 16,
    paddingBottom: 8,
  },
  chartEmpty: {
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chartEmptyText: {
    fontSize: 14,
    fontWeight: '500',
  },
  periodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  periodBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    minWidth: 36,
  },
  periodLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  indicatorArea: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: 'center',
  },
  indicatorHint: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
    borderTopWidth: 1,
  },
  statPill: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
  },
});
