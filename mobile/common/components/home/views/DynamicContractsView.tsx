import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';

/**
 * Dynamic card "contracts" view: open / tracked contracts at a glance.
 */
export function DynamicContractsView() {
  const colors = useThemeColors();
  const { data: contracts, isLoading } = useTrackedContracts();
  const open = (contracts ?? []).filter((c) => c.status === 'tracking' || c.status === 'entered');

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
          OPEN CONTRACTS
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
          {open.length} OPEN
        </Text>
      </View>

      {isLoading ? (
        <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16 }}>Loading contracts…</Text>
      ) : open.length === 0 ? (
        <View style={{ marginTop: 20, alignItems: 'center', gap: 8 }}>
          <Ionicons name="layers-outline" size={28} color={colors.textTertiary} />
          <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center' }}>
            No open contracts.
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: 6 }}>
          {open.map((c) => {
            const up = c.option_type === 'CALL';
            const dirColor = up ? colors.success : colors.error;
            return (
              <View key={c.id} style={[styles.row, { borderColor: colors.border }]}>
                <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: colors.text }]}>
                  {c.ticker}
                </Text>
                <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
                  <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: dirColor }]}>
                    {c.option_type}
                  </Text>
                </View>
                <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]}>
                  {c.strike} · {c.expiration_date}
                </Text>
                <View style={{ flex: 1 }} />
                <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
                  {c.status.toUpperCase()}
                </Text>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
});
