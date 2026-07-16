import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useXApiUsage } from '@/hooks/queries/social/useXApiUsage';

interface Props {
  colors: any;
}

/** X has no public endpoint for the actual $ credit balance — this shows a
 *  self-tracked spend estimate (our own request log × known unit pricing)
 *  plus a link to the Developer Console for the authoritative figure. See
 *  docs/features/social-signal-contracts.md, "X balance display". */
export function XApiUsageBadge({ colors }: Props) {
  const { data, isLoading } = useXApiUsage();

  if (isLoading || !data) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: colors.tabBarInactive }]}>EST. X API SPEND</Text>
        <View style={styles.row}>
          <Text style={[styles.value, { color: colors.text }]}>
            ${data.estimated_spend_month_usd.toFixed(2)} <Text style={styles.period}>this month</Text>
          </Text>
          <Text style={[styles.today, { color: colors.tabBarInactive }]}>
            · ${data.estimated_spend_today_usd.toFixed(2)} today
          </Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => Linking.openURL(data.console_url)}
        style={[styles.consoleBtn, { borderColor: colors.border }]}
        hitSlop={6}
      >
        <Text style={[styles.consoleText, { color: colors.accent }]}>Console</Text>
        <Ionicons name="open-outline" size={12} color={colors.accent} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  label: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, marginBottom: 3 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  value: { fontSize: 15, fontWeight: '700' },
  period: { fontSize: 11, fontWeight: '500' },
  today: { fontSize: 11 },
  consoleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  consoleText: { fontSize: 12, fontWeight: '600' },
});
