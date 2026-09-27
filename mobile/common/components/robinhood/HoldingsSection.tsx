import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { RobinhoodHolding } from '@/common/types/robinhood';
import { AllocationLegend, AllocationPieChart, PieSlice } from './AllocationPieChart';

const SECTOR_PALETTE = [
  '#00C805', '#5AC8FA', '#BF5AF2', '#FF9F0A', '#FF453A',
  '#30D158', '#64D2FF', '#FF375F', '#FFD60A', '#AC8E68',
];

/** Holdings table (symbol / shares / avg cost / value / P&L) + a sector
 *  allocation donut computed from real Robinhood fundamentals data — see
 *  robinhood_service.py's get_holdings(), which fetches sector per ticker
 *  from rh.get_fundamentals(). If Robinhood has no sector for anything held,
 *  that's said plainly instead of a fake all-"Unknown" pie. */
export function HoldingsSection({ holdings, colors }: { holdings: RobinhoodHolding[]; colors: any }) {
  const sectorSlices = useMemo((): PieSlice[] => {
    const withSector = holdings.filter(h => h.sector);
    if (withSector.length === 0) return [];

    const bySector = new Map<string, number>();
    for (const h of withSector) {
      const key = h.sector as string;
      bySector.set(key, (bySector.get(key) ?? 0) + Math.max(h.market_value, 0));
    }

    return Array.from(bySector.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([sector, value], i) => ({
        key: sector,
        label: sector,
        value,
        color: SECTOR_PALETTE[i % SECTOR_PALETTE.length],
      }));
  }, [holdings]);

  const missingSectorCount = holdings.length - holdings.filter(h => h.sector).length;

  if (holdings.length === 0) return null;

  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardLabel, { color: colors.text, marginBottom: 2 }]}>Holdings</Text>
        <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive, marginBottom: 10 }]}>
          {holdings.length} position{holdings.length === 1 ? '' : 's'}
        </Text>

        <View style={[styles.tableHeader, { borderBottomColor: colors.separator }]}>
          <Text style={[styles.th, { color: colors.tabBarInactive, flex: 1.3 }]}>Symbol</Text>
          <Text style={[styles.th, { color: colors.tabBarInactive, flex: 1, textAlign: 'right' }]}>Shares</Text>
          <Text style={[styles.th, { color: colors.tabBarInactive, flex: 1.2, textAlign: 'right' }]}>Value</Text>
          <Text style={[styles.th, { color: colors.tabBarInactive, flex: 1.4, textAlign: 'right' }]}>P&L</Text>
        </View>

        {holdings.map((h, i) => {
          const plColor = h.unrealized_pl >= 0 ? colors.success : colors.error;
          return (
            <View
              key={h.ticker}
              style={[
                styles.tableRow,
                i < holdings.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
              ]}
            >
              <View style={{ flex: 1.3 }}>
                <Text style={[styles.holdingTicker, { color: colors.text }]}>{h.ticker}</Text>
                <Text style={[styles.holdingDesc, { color: colors.tabBarInactive }]} numberOfLines={1}>
                  ${h.average_cost.toFixed(2)} avg
                </Text>
              </View>
              <Text style={[styles.td, { color: colors.text, flex: 1, textAlign: 'right' }]}>
                {h.quantity}
              </Text>
              <Text style={[styles.td, { color: colors.text, flex: 1.2, textAlign: 'right', fontWeight: '700' }]}>
                ${h.market_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
              <View style={{ flex: 1.4, alignItems: 'flex-end' }}>
                <Text style={[styles.holdingPnl, { color: plColor }]}>
                  {h.unrealized_pl >= 0 ? '+' : ''}${h.unrealized_pl.toFixed(2)}
                </Text>
                <Text style={[styles.holdingPnlPct, { color: plColor }]}>
                  {h.unrealized_pl_pct >= 0 ? '+' : ''}{h.unrealized_pl_pct.toFixed(2)}%
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardLabel, { color: colors.text, marginBottom: 10 }]}>Sector Allocation</Text>
        {sectorSlices.length === 0 ? (
          <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive }]}>
            Robinhood didn't return sector data for these holdings.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <AllocationPieChart slices={sectorSlices} size={104} colors={colors} />
            <AllocationLegend slices={sectorSlices} colors={colors} />
          </View>
        )}
        {sectorSlices.length > 0 && missingSectorCount > 0 && (
          <Text style={[styles.footnote, { color: colors.tabBarInactive }]}>
            {missingSectorCount} holding{missingSectorCount === 1 ? '' : 's'} without sector data excluded above.
          </Text>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, gap: 4, borderWidth: 1 },
  cardLabel: { fontSize: 17, fontWeight: '700' },
  cardSubtitle: { fontSize: 12 },

  tableHeader: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  th: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  td: { fontSize: 13, fontWeight: '600' },

  holdingTicker: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  holdingDesc: { fontSize: 10 },
  holdingPnl: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  holdingPnlPct: { fontSize: 10, fontWeight: '600' },

  footnote: { fontSize: 10, marginTop: 10 },
});
