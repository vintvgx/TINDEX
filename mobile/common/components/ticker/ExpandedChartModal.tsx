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
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { PriceChart } from '@/common/components/ticker/PriceChart';
import { EMASettingsModal } from '@/common/components/ticker/EMASettingsModal';
import { useEMASettings } from '@/hooks/useEMASettings';
import {
  filterByPeriod,
  calcEMA,
  calcEMAAnalysis,
  EMA_CONFIGS,
  type ChartPeriod,
  type IndicatorLine,
} from '@/common/utils/chartUtils';
import type { TickerData } from '@/common/types/blogPosts/ticker';

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIODS: ChartPeriod[] = ['1D', '1W', '1M', 'YTD', '1Y', '5Y', 'Max'];
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const H_PAD = 16;
const CHART_WIDTH = SCREEN_WIDTH - H_PAD * 2;
const CHART_HEIGHT = Math.round(SCREEN_HEIGHT * 0.38);

// ─── Signal display config ────────────────────────────────────────────────────

const SIGNAL_CONFIG = {
  overbought: { label: 'Overbought', color: '#ef4444', icon: 'trending-up' as const },
  bullish:    { label: 'Bullish',    color: '#22c55e', icon: 'arrow-up-circle' as const },
  neutral:    { label: 'Neutral',    color: '#94a3b8', icon: 'remove-circle' as const },
  bearish:    { label: 'Bearish',    color: '#f59e0b', icon: 'arrow-down-circle' as const },
  oversold:   { label: 'Oversold',   color: '#3b82f6', icon: 'trending-down' as const },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  stockData: TickerData;
  initialPeriod: ChartPeriod;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ExpandedChartModal: React.FC<Props> = ({
  visible,
  onClose,
  stockData,
  initialPeriod,
}) => {
  const colors = useThemeColors();
  const [period, setPeriod] = useState<ChartPeriod>(initialPeriod);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { selectedPeriods, togglePeriod, isLoaded } = useEMASettings();

  // ── Chart data ──────────────────────────────────────────────────────────────

  const chartResult = useMemo(() => {
    if (period === '1D' && stockData.intraday_data?.dates?.length) {
      const { dates, prices } = stockData.intraday_data;
      return filterByPeriod(dates, prices, period);
    }
    const hist = stockData.historical_data;
    if (!hist?.dates?.length || !hist?.prices?.length) return null;
    return filterByPeriod(hist.dates, hist.prices, period);
  }, [stockData.historical_data, stockData.intraday_data, period]);

  // ── EMA overlays ────────────────────────────────────────────────────────────

  const indicators = useMemo((): IndicatorLine[] => {
    if (!isLoaded || !chartResult || chartResult.points.length < 2) return [];
    const prices = chartResult.points.map(p => p.price);
    return EMA_CONFIGS
      .filter(cfg => selectedPeriods.includes(cfg.period))
      .map(cfg => ({
        id: `ema-${cfg.period}`,
        label: cfg.label,
        values: calcEMA(prices, cfg.period),
        color: cfg.color,
        strokeWidth: cfg.period === 200 ? 1.5 : 1,
        dashed: cfg.period === 200,
      }));
  }, [chartResult, selectedPeriods, isLoaded]);

  // ── EMA signal analysis (uses full 5Y history for stable EMA 200) ──────────

  const emaAnalysis = useMemo(() => {
    if (!isLoaded || !selectedPeriods.length) return null;
    const hist = stockData.historical_data;
    if (!hist?.prices?.length) return null;
    return calcEMAAnalysis(hist.prices, selectedPeriods);
  }, [stockData.historical_data, selectedPeriods, isLoaded]);

  // ── Period change display ───────────────────────────────────────────────────

  const periodChangeColor = chartResult
    ? chartResult.isPositive ? colors.success : colors.error
    : colors.textTertiary;

  const periodChangeText = chartResult
    ? `${chartResult.isPositive ? '+' : ''}${chartResult.priceChange.toFixed(2)} (${
        chartResult.isPositive ? '+' : ''
      }${chartResult.priceChangePct.toFixed(2)}%)`
    : '';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent={false}
        onRequestClose={onClose}
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
              <View style={s.headerBtns}>
                <TouchableOpacity
                  onPress={() => setSettingsOpen(true)}
                  activeOpacity={0.7}
                  style={[s.iconBtn, { backgroundColor: colors.iconButton, borderColor: colors.iconButtonBorder }]}
                >
                  <Ionicons name="options-outline" size={17} color={colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onClose}
                  activeOpacity={0.7}
                  style={[s.iconBtn, { backgroundColor: colors.iconButton, borderColor: colors.iconButtonBorder }]}
                >
                  <Ionicons name="close" size={17} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
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

            {/* ── Active EMA legend ── */}
            {isLoaded && indicators.length > 0 && (
              <View style={s.legendRow}>
                {EMA_CONFIGS.filter(c => selectedPeriods.includes(c.period)).map(cfg => (
                  <View key={cfg.period} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: cfg.color }]} />
                    <Text style={[s.legendLabel, { color: colors.textSecondary }]}>{cfg.label}</Text>
                  </View>
                ))}
              </View>
            )}

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
                    <Text style={[
                      s.periodLabel,
                      { color: active ? colors.accent : colors.textTertiary },
                      active && { fontWeight: '700' },
                    ]}>
                      {p}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── EMA Signal Key ── */}
            {emaAnalysis && emaAnalysis.perEMA.length > 0 && (
              <View style={[s.signalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {/* Overall signal badge */}
                <View style={s.signalHeader}>
                  <Text style={[s.signalTitle, { color: colors.text }]}>EMA Signal</Text>
                  <View style={[s.signalBadge, { backgroundColor: SIGNAL_CONFIG[emaAnalysis.signal].color + '22', borderColor: SIGNAL_CONFIG[emaAnalysis.signal].color + '55' }]}>
                    <Ionicons
                      name={SIGNAL_CONFIG[emaAnalysis.signal].icon}
                      size={13}
                      color={SIGNAL_CONFIG[emaAnalysis.signal].color}
                    />
                    <Text style={[s.signalBadgeText, { color: SIGNAL_CONFIG[emaAnalysis.signal].color }]}>
                      {SIGNAL_CONFIG[emaAnalysis.signal].label}
                    </Text>
                  </View>
                </View>

                {/* Per-EMA rows */}
                {emaAnalysis.perEMA.map(e => (
                  <View key={e.period} style={[s.emaRow, { borderTopColor: colors.separator }]}>
                    <View style={[s.emaDot, { backgroundColor: e.color }]} />
                    <Text style={[s.emaRowLabel, { color: colors.text }]}>{e.label}</Text>
                    {e.value !== null ? (
                      <Text style={[s.emaValue, { color: colors.textSecondary }]}>
                        ${e.value.toFixed(2)}
                      </Text>
                    ) : (
                      <Text style={[s.emaValue, { color: colors.textTertiary }]}>—</Text>
                    )}
                    {e.priceAbove !== null && (
                      <View style={[
                        s.emaChip,
                        { backgroundColor: (e.priceAbove ? colors.success : colors.error) + '18' },
                      ]}>
                        <Ionicons
                          name={e.priceAbove ? 'arrow-up' : 'arrow-down'}
                          size={10}
                          color={e.priceAbove ? colors.success : colors.error}
                        />
                        <Text style={[s.emaChipText, { color: e.priceAbove ? colors.success : colors.error }]}>
                          {e.priceAbove ? 'Above' : 'Below'}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}

                {/* Crossover signals */}
                {(emaAnalysis.shortTermBias !== 'neutral' || emaAnalysis.longTermBias !== 'neutral') && (
                  <View style={[s.crossoverArea, { borderTopColor: colors.separator }]}>
                    {emaAnalysis.shortTermBias !== 'neutral' && (
                      <CrossoverPill
                        label={emaAnalysis.shortTermBias === 'bullish' ? 'EMA 10 > EMA 20' : 'EMA 10 < EMA 20'}
                        sublabel="Short-term momentum"
                        bullish={emaAnalysis.shortTermBias === 'bullish'}
                        colors={colors}
                      />
                    )}
                    {emaAnalysis.longTermBias === 'golden_cross' && (
                      <CrossoverPill
                        label="Golden Cross"
                        sublabel="EMA 50 > EMA 200 — long-term bullish"
                        bullish
                        colors={colors}
                      />
                    )}
                    {emaAnalysis.longTermBias === 'death_cross' && (
                      <CrossoverPill
                        label="Death Cross"
                        sublabel="EMA 50 < EMA 200 — long-term bearish"
                        bullish={false}
                        colors={colors}
                      />
                    )}
                  </View>
                )}

                {/* Overbought / Oversold explanation */}
                <View style={[s.keyFooter, { borderTopColor: colors.separator }]}>
                  <KeyRow
                    signal="Overbought"
                    color={SIGNAL_CONFIG.overbought.color}
                    desc="Price above all active EMAs and EMAs aligned upward. Caution: potential pullback."
                    colors={colors}
                  />
                  <KeyRow
                    signal="Oversold"
                    color={SIGNAL_CONFIG.oversold.color}
                    desc="Price below all active EMAs. Potential bounce — look for confirmation before entry."
                    colors={colors}
                  />
                </View>
              </View>
            )}

            {/* ── Stats row ── */}
            <View style={s.statsRow}>
              <StatPill label="Day H" value={stockData.day_high != null ? `$${stockData.day_high.toFixed(2)}` : '—'} colors={colors} />
              <StatPill label="Day L" value={stockData.day_low != null ? `$${stockData.day_low.toFixed(2)}` : '—'} colors={colors} />
              <StatPill label="52W H" value={stockData.year_high != null ? `$${stockData.year_high.toFixed(2)}` : '—'} colors={colors} />
              <StatPill label="52W L" value={stockData.year_low != null ? `$${stockData.year_low.toFixed(2)}` : '—'} colors={colors} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* EMA settings — rendered as sibling to avoid nested modal */}
      <EMASettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        selectedPeriods={selectedPeriods}
        onToggle={togglePeriod}
      />
    </>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const CrossoverPill: React.FC<{
  label: string;
  sublabel: string;
  bullish: boolean;
  colors: ReturnType<typeof useThemeColors>;
}> = ({ label, sublabel, bullish, colors }) => (
  <View style={[s.crossoverPill, { backgroundColor: (bullish ? colors.success : colors.error) + '12', borderColor: (bullish ? colors.success : colors.error) + '30' }]}>
    <Ionicons name={bullish ? 'trending-up' : 'trending-down'} size={13} color={bullish ? colors.success : colors.error} />
    <View>
      <Text style={[s.crossoverLabel, { color: bullish ? colors.success : colors.error }]}>{label}</Text>
      <Text style={[s.crossoverSub, { color: colors.textTertiary }]}>{sublabel}</Text>
    </View>
  </View>
);

const KeyRow: React.FC<{
  signal: string;
  color: string;
  desc: string;
  colors: ReturnType<typeof useThemeColors>;
}> = ({ signal, color, desc, colors }) => (
  <View style={s.keyRow}>
    <View style={[s.keyDot, { backgroundColor: color }]} />
    <View style={s.keyText}>
      <Text style={[s.keySignal, { color }]}>{signal}</Text>
      <Text style={[s.keyDesc, { color: colors.textTertiary }]}>{desc}</Text>
    </View>
  </View>
);

const StatPill: React.FC<{
  label: string;
  value: string;
  colors: ReturnType<typeof useThemeColors>;
}> = ({ label, value, colors }) => (
  <View style={[s.statPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <Text style={[s.statLabel, { color: colors.textTertiary }]}>{label}</Text>
    <Text style={[s.statValue, { color: colors.text }]}>{value}</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 32 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: { flex: 1, marginRight: 12 },
  ticker: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  companyName: { fontSize: 13, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', gap: 8 },
  periodChange: { fontSize: 14, fontWeight: '600' },
  headerBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 10,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  chartArea: {
    paddingHorizontal: H_PAD,
    paddingTop: 16,
    paddingBottom: 4,
  },
  chartEmpty: {
    borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  chartEmptyText: { fontSize: 14, fontWeight: '500' },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: H_PAD + 4,
    gap: 12,
    marginBottom: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontWeight: '500' },
  periodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  periodBtn: {
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, alignItems: 'center', minWidth: 36,
  },
  periodLabel: { fontSize: 12, fontWeight: '500' },
  // Signal card
  signalCard: {
    marginHorizontal: H_PAD,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  signalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  signalTitle: { fontSize: 15, fontWeight: '700' },
  signalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  signalBadgeText: { fontSize: 13, fontWeight: '700' },
  emaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  emaDot: { width: 10, height: 10, borderRadius: 5 },
  emaRowLabel: { fontSize: 13, fontWeight: '600', width: 56 },
  emaValue: { flex: 1, fontSize: 13 },
  emaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  emaChipText: { fontSize: 11, fontWeight: '600' },
  crossoverArea: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  crossoverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  crossoverLabel: { fontSize: 13, fontWeight: '700' },
  crossoverSub: { fontSize: 11, marginTop: 1 },
  keyFooter: {
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  keyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  keyDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  keyText: { flex: 1 },
  keySignal: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  keyDesc: { fontSize: 11, lineHeight: 15 },
  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: H_PAD,
    paddingTop: 16,
    gap: 8,
  },
  statPill: {
    flex: 1, borderRadius: 10, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center',
  },
  statLabel: { fontSize: 10, fontWeight: '500', marginBottom: 4 },
  statValue: { fontSize: 13, fontWeight: '700' },
});
