import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Dimensions } from 'react-native';
import { useRobinhoodEquityHistory } from '@/hooks/queries/robinhood/useRobinhoodAccount';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { ChartPoint, ChartSeries, MiniLineChart } from './MiniLineChart';

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 32 - 32; // matches the card's own horizontal padding
const CHART_H = 100;

const SPY_COLOR = '#5AC8FA';
const QQQ_COLOR = '#BF5AF2';
const ROBINHOOD_GREEN = '#00C805';

/** Percent change from the first sample — the shared basis every series is plotted on. */
function toPctSeries(points: { t: number; raw: number }[]): ChartPoint[] {
  if (points.length === 0) return [];
  const base = points[0].raw;
  if (!base) return [];
  return points.map(p => ({ t: p.t, v: ((p.raw - base) / base) * 100 }));
}

/**
 * Robinhood's own day equity vs. SPY/QQQ, all normalized to % change from
 * the start of the session so the shapes are directly comparable regardless
 * of each instrument's actual price level. SPY/QQQ history reuses the
 * existing generic /ticker/<ticker>/history endpoint (yfinance-backed,
 * same one the ticker detail chart uses) rather than adding a second data
 * source — SPY/QQQ are just tickers as far as that endpoint is concerned.
 */
export function BenchmarkCard({ colors }: { colors: any }) {
  const { data: rhHistory, isLoading: rhLoading } = useRobinhoodEquityHistory('day');
  const { data: spyHistory, isLoading: spyLoading } = useTickerHistoryQuery('SPY', '1D');
  const { data: qqqHistory, isLoading: qqqLoading } = useTickerHistoryQuery('QQQ', '1D');

  const isLoading = rhLoading || spyLoading || qqqLoading;

  const series = useMemo((): ChartSeries[] => {
    const out: ChartSeries[] = [];

    if (rhHistory?.available && rhHistory.points.length > 1) {
      const pts = toPctSeries(
        rhHistory.points.map(p => ({ t: new Date(p.timestamp).getTime(), raw: p.equity })),
      );
      if (pts.length > 1) out.push({ key: 'robinhood', color: ROBINHOOD_GREEN, points: pts });
    }

    if (spyHistory?.success && spyHistory.data.prices.length > 1) {
      const pts = toPctSeries(
        spyHistory.data.dates.map((d, i) => ({ t: new Date(d).getTime(), raw: spyHistory.data.prices[i] })),
      );
      if (pts.length > 1) out.push({ key: 'spy', color: SPY_COLOR, points: pts });
    }

    if (qqqHistory?.success && qqqHistory.data.prices.length > 1) {
      const pts = toPctSeries(
        qqqHistory.data.dates.map((d, i) => ({ t: new Date(d).getTime(), raw: qqqHistory.data.prices[i] })),
      );
      if (pts.length > 1) out.push({ key: 'qqq', color: QQQ_COLOR, points: pts });
    }

    return out;
  }, [rhHistory, spyHistory, qqqHistory]);

  const latestPct = (key: string) => {
    const s = series.find(s => s.key === key);
    if (!s || s.points.length === 0) return null;
    return s.points[s.points.length - 1].v;
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardLabel, { color: colors.text }]}>Vs. SPY / QQQ</Text>
      <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive, marginBottom: 10 }]}>
        Today's % change, same starting point
      </Text>

      {isLoading ? (
        <ActivityIndicator color={ROBINHOOD_GREEN} style={{ marginVertical: 24 }} />
      ) : series.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>
          Not enough data to compare yet — check back once the market's been open a bit.
        </Text>
      ) : (
        <>
          <MiniLineChart series={series} width={CHART_W} height={CHART_H} zeroLineColor={colors.tabBarInactive} />
          <View style={styles.legendRow}>
            <LegendItem label="Robinhood" color={ROBINHOOD_GREEN} pct={latestPct('robinhood')} colors={colors} />
            <LegendItem label="SPY" color={SPY_COLOR} pct={latestPct('spy')} colors={colors} />
            <LegendItem label="QQQ" color={QQQ_COLOR} pct={latestPct('qqq')} colors={colors} />
          </View>
        </>
      )}
    </View>
  );
}

const LegendItem = ({ label, color, pct, colors }: { label: string; color: string; pct: number | null; colors: any }) => {
  if (pct == null) return null;
  const pctColor = pct >= 0 ? colors.success : colors.error;
  return (
    <View style={styles.legendItem}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Text style={[styles.legendLabel, { color: colors.tabBarInactive }]}>{label}</Text>
      </View>
      <Text style={[styles.legendPct, { color: pctColor }]}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, gap: 4, borderWidth: 1 },
  cardLabel: { fontSize: 15, fontWeight: '700' },
  cardSubtitle: { fontSize: 12 },
  emptyText: { fontSize: 12, lineHeight: 17, paddingVertical: 20, textAlign: 'center' },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  legendItem: { alignItems: 'flex-start', gap: 3 },
  legendLabel: { fontSize: 11, fontWeight: '600' },
  legendPct: { fontSize: 14, fontWeight: '800' },
});
