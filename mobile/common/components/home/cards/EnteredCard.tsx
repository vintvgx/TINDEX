import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';

export interface EnteredInfo {
  ticker: string;
  direction: 'CALL' | 'PUT';
  /** e.g. "252.5C" — null when the contract is auto-picked at entry. */
  contractLabel: string | null;
  qty: number | null;
  limit: number | null;
  paper: boolean;
}

/**
 * Brief "order sent" card shown right after confirming a play on the
 * confirm card (a few seconds, like the Sold card) — then the dynamic card
 * moves to its Open page, where the position shows once it fills.
 */
export function EnteredCard({ info }: { info: EnteredInfo }) {
  const colors = useThemeColors();
  const modeColor = info.paper ? colors.warning : colors.error;
  const dirColor = info.direction === 'CALL' ? colors.success : colors.error;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: modeColor + '66' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
        <Text style={[styles.mono, { fontSize: 15, fontWeight: '800', color: colors.text }]}>Order sent</Text>
        <View style={{ flex: 1 }} />
        <View style={[styles.badge, { backgroundColor: modeColor + '22', borderColor: modeColor + '55' }]}>
          <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: modeColor }]}>
            {info.paper ? 'PAPER' : 'LIVE'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <Text style={[styles.mono, { fontSize: 22, fontWeight: '800', color: colors.text }]}>{info.ticker}</Text>
        <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
          <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: dirColor }]}>{info.direction}</Text>
        </View>
        <Text style={[styles.mono, { fontSize: 14, color: colors.textSecondary }]}>
          {info.contractLabel ?? 'auto-pick'}
          {info.qty ? ` × ${info.qty}` : ''}
        </Text>
      </View>
      <Text style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 8, lineHeight: 18 }}>
        {info.limit != null ? `Limit order working at $${info.limit.toFixed(2)}. ` : 'Limit order working. '}
        It'll appear under Open once filled.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  card: { borderRadius: 16, borderWidth: 1.5, padding: 14 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
});
