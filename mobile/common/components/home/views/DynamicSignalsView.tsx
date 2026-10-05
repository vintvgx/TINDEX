import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useSocialSignalContracts } from '@/hooks/queries/social/useSocialSignalContracts';

/**
 * Dynamic card "signals" view: tracked social-signal contracts, compact.
 * The backend feed is quiet right now (owner debugging) — the view renders
 * whatever the signal store returns, with an honest empty state.
 */
export function DynamicSignalsView() {
  const colors = useThemeColors();
  const { data: contracts, isLoading } = useSocialSignalContracts();
  const tracking = (contracts ?? []).filter((c) => c.status === 'tracking');

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
          SIGNALS
        </Text>
        <View style={{ flex: 1 }} />
        <View style={[styles.liveDot, { backgroundColor: tracking.length > 0 ? colors.success : colors.textTertiary }]} />
        <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
          {tracking.length} TRACKING
        </Text>
      </View>

      {isLoading ? (
        <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16 }}>Loading signals…</Text>
      ) : tracking.length === 0 ? (
        <View style={{ marginTop: 20, alignItems: 'center', gap: 8 }}>
          <Ionicons name="radio-outline" size={28} color={colors.textTertiary} />
          <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
            No signals right now.{'\n'}The feed has been quiet — check the Signals screen for status.
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: 8 }}>
          {tracking.map((c) => {
            const up = (c.price_change_pct ?? 0) >= 0;
            return (
              <View key={c.id} style={[styles.row, { borderColor: colors.border }]}>
                <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: colors.text }]}>
                  {c.ticker}
                </Text>
                <Text style={[styles.mono, { fontSize: 10, color: colors.textSecondary }]}>
                  {c.option_type} {c.strike}
                </Text>
                <View style={{ flex: 1 }} />
                {c.price_change_pct != null && (
                  <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', color: up ? colors.success : colors.error }]}>
                    {up ? '+' : ''}{c.price_change_pct.toFixed(1)}%
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
