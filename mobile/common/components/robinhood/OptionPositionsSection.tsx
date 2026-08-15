import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { RobinhoodOptionPosition } from '@/common/types/robinhood';

/** Open Robinhood option positions — separate from the stock holdings table
 *  (see robinhood_service.py's get_option_positions). Renders nothing when
 *  the account has none, same "just don't show the section" convention the
 *  stock holdings card already uses. */
export function OptionPositionsSection({ positions, colors }: { positions: RobinhoodOptionPosition[]; colors: any }) {
  if (positions.length === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardLabel, { color: colors.text, marginBottom: 2 }]}>Option Positions</Text>
      <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive, marginBottom: 10 }]}>
        {positions.length} open position{positions.length === 1 ? '' : 's'}
      </Text>

      {positions.map((p, i) => {
        const isCall = p.option_type === 'call';
        const typeColor = isCall ? colors.success : colors.error;
        const isShort = p.position_type === 'short';

        return (
          <View
            key={`${p.ticker}-${p.strike}-${p.expiration_date}-${i}`}
            style={[
              styles.row,
              i < positions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
            ]}
          >
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.ticker, { color: colors.text }]}>{p.ticker}</Text>
                {p.option_type && (
                  <View style={[styles.typePill, { backgroundColor: typeColor + '18' }]}>
                    <Text style={[styles.typePillText, { color: typeColor }]}>
                      {isShort ? 'SHORT ' : ''}{p.option_type.toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.desc, { color: colors.tabBarInactive }]} numberOfLines={1}>
                {p.strike != null ? `$${p.strike} strike` : 'Strike unknown'}
                {p.expiration_date ? ` · exp ${p.expiration_date}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.value, { color: colors.text }]}>
                ${p.cost_basis.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
              <Text style={[styles.sub, { color: colors.tabBarInactive }]}>
                {p.quantity} ct @ ${p.average_price.toFixed(2)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, gap: 4, borderWidth: 1 },
  cardLabel: { fontSize: 17, fontWeight: '700' },
  cardSubtitle: { fontSize: 12 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  ticker: { fontSize: 13, fontWeight: '700' },
  desc: { fontSize: 11, marginTop: 2 },
  value: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  sub: { fontSize: 10 },

  typePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  typePillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
});
