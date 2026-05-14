import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { PriceChart } from '@/common/components/ticker/PriceChart';
import { ExpandedChartModal } from '@/common/components/ticker/ExpandedChartModal';
import { filterByPeriod, formatVolume, type ChartPeriod } from '@/common/utils/chartUtils';
import type { TickerData } from '@/common/types/blogPosts/ticker';

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIODS: ChartPeriod[] = ['1D', '1W', '1M', 'YTD', '1Y', '5Y', 'Max'];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Horizontal padding is 20 on each side from the ScrollView in [ticker].tsx
const CHART_WIDTH = SCREEN_WIDTH - 40;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  stockData: TickerData;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const SummaryTab: React.FC<Props> = ({ stockData }) => {
  const colors = useThemeColors();
  const [period, setPeriod] = useState<ChartPeriod>('1M');
  const [expandedVisible, setExpandedVisible] = useState(false);

  // Filter historical data to the selected period.
  // For 1D, prefer intraday_data (5-min bars) when available.
  const chartResult = useMemo(() => {
    if (period === '1D' && stockData.intraday_data?.dates?.length) {
      const { dates, prices } = stockData.intraday_data;
      return filterByPeriod(dates, prices, period);
    }
    const hist = stockData.historical_data;
    if (!hist?.dates?.length || !hist?.prices?.length) return null;
    return filterByPeriod(hist.dates, hist.prices, period);
  }, [stockData.historical_data, stockData.intraday_data, period]);

  const hasChartData = chartResult && chartResult.points.length >= 2;

  // Formatted price change for the period
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
    <>
      {/* ── Price Chart Card ── */}
      <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Card header */}
        <View style={s.cardHeader}>
          <View>
            <Text style={[s.cardTitle, { color: colors.text }]}>Price Chart</Text>
            {periodChangeText ? (
              <Text style={[s.periodChange, { color: periodChangeColor }]}>
                {periodChangeText}
              </Text>
            ) : null}
          </View>
          {hasChartData && (
            <TouchableOpacity
              onPress={() => setExpandedVisible(true)}
              activeOpacity={0.7}
              style={[s.expandBtn, { backgroundColor: colors.iconButton, borderColor: colors.iconButtonBorder }]}
            >
              <Ionicons name="expand-outline" size={16} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>

        {/* Chart */}
        <View style={s.chartContainer}>
          {hasChartData ? (
            <PriceChart
              points={chartResult.points}
              period={period}
              width={CHART_WIDTH - 32} // subtract card horizontal padding
              isPositive={chartResult.isPositive}
              // indicators={[]} — add EMA/RSI lines here in the future
            />
          ) : (
            <View
              style={[s.chartEmpty, { backgroundColor: colors.background, borderColor: colors.border }]}
            >
              <Ionicons name="bar-chart-outline" size={36} color={colors.textTertiary} />
              <Text style={[s.chartEmptyTitle, { color: colors.textSecondary }]}>
                No Chart Data
              </Text>
              <Text style={[s.chartEmptySubtitle, { color: colors.textTertiary }]}>
                Historical price data is unavailable
              </Text>
            </View>
          )}
        </View>

        {/* Period selector */}
        <View style={s.periodRow}>
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
      </View>

      {/* ── Key Statistics ── */}
      <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[s.cardTitle, { color: colors.text }]}>Key Statistics</Text>
        <View style={s.statsGrid}>
          <StatItem label="Day High" value={stockData.day_high != null ? `$${stockData.day_high.toFixed(2)}` : '—'} colors={colors} />
          <StatItem label="Day Low" value={stockData.day_low != null ? `$${stockData.day_low.toFixed(2)}` : '—'} colors={colors} />
          <StatItem label="52W High" value={stockData.year_high != null ? `$${stockData.year_high.toFixed(2)}` : '—'} colors={colors} />
          <StatItem label="52W Low" value={stockData.year_low != null ? `$${stockData.year_low.toFixed(2)}` : '—'} colors={colors} />
          <StatItem label="Volume" value={stockData.volume != null ? formatVolume(stockData.volume) : '—'} colors={colors} />
          <StatItem label="Avg Volume" value={stockData.average_volume != null ? formatVolume(stockData.average_volume) : '—'} colors={colors} />
          {stockData.market_cap != null && (
            <StatItem label="Market Cap" value={formatVolume(stockData.market_cap)} colors={colors} />
          )}
          {stockData.pe_ratio != null && (
            <StatItem label="P/E Ratio" value={stockData.pe_ratio.toFixed(1)} colors={colors} />
          )}
        </View>
      </View>

      {/* ── About ── */}
      <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[s.cardTitle, { color: colors.text }]}>
          About {stockData.ticker}
        </Text>

        {/* Sector / Industry chips */}
        <View style={s.chipRow}>
          {stockData.sector ? (
            <View style={[s.chip, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '40' }]}>
              <Text style={[s.chipText, { color: colors.accent }]}>{stockData.sector}</Text>
            </View>
          ) : null}
          {stockData.industry ? (
            <View style={[s.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[s.chipText, { color: colors.textSecondary }]}>{stockData.industry}</Text>
            </View>
          ) : null}
        </View>

        {stockData.description ? (
          <Text style={[s.description, { color: colors.textSecondary }]}>
            {stockData.description}
          </Text>
        ) : null}
      </View>

      {/* ── Expanded chart modal ── */}
      <ExpandedChartModal
        visible={expandedVisible}
        onClose={() => setExpandedVisible(false)}
        stockData={stockData}
        initialPeriod={period}
      />
    </>
  );
};

// ─── Stat item ────────────────────────────────────────────────────────────────

interface StatItemProps {
  label: string;
  value: string;
  colors: ReturnType<typeof useThemeColors>;
}

const StatItem: React.FC<StatItemProps> = ({ label, value, colors }) => (
  <View style={s.statItem}>
    <Text style={[s.statLabel, { color: colors.textTertiary }]}>{label}</Text>
    <Text style={[s.statValue, { color: colors.text }]}>{value}</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  expandBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  periodChange: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
  chartContainer: {
    marginBottom: 12,
  },
  chartEmpty: {
    height: 180,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chartEmptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
  },
  chartEmptySubtitle: {
    fontSize: 12,
  },
  periodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 4,
  },
  statItem: {
    width: '48%',
    marginBottom: 12,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 3,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    fontSize: 13,
    lineHeight: 21,
  },
});
