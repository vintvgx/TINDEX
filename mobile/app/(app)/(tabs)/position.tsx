import React from 'react';
import { View, Text, ScrollView, SafeAreaView, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useStrategyPosition } from '@/hooks/queries/strategy/useStrategyPosition';
import { useAlpacaAccount } from '@/hooks/queries/strategy/useAlpacaAccount';
import { useForceClosePosition } from '@/hooks/mutations/strategy/useUpdateStrategyConfig';
import { PositionCard } from '@/common/components/strategy/PositionCard';

export default function PositionScreen() {
  const colors = useThemeColors();
  const toast  = useToast();

  const { data: position, isLoading } = useStrategyPosition();
  const { data: account } = useAlpacaAccount();
  const { mutate: forceClose, isPending: closing } = useForceClosePosition();

  const handleForceClose = () => {
    forceClose(undefined, {
      onSuccess: () => toast.success('Position closed'),
      onError:   () => toast.error('Close failed — check Alpaca manually'),
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Live Position</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* Account summary */}
        {account && (
          <View style={[styles.accountRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <AccountStat
              label={account.paper_mode ? 'Paper Equity' : 'Account Equity'}
              value={`$${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              colors={colors}
            />
            <AccountStat
              label="Today P&L"
              value={`${account.pnl_today >= 0 ? '+' : ''}$${account.pnl_today.toFixed(2)}`}
              color={account.pnl_today >= 0 ? colors.success : colors.error}
              colors={colors}
            />
            <AccountStat
              label="Day Trades"
              value={String(account.day_trade_count)}
              colors={colors}
            />
          </View>
        )}

        {/* Position card */}
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : position ? (
          <PositionCard
            position={position}
            onForceClose={position.active ? handleForceClose : undefined}
          />
        ) : null}

        {/* Fib levels */}
        {position?.active && position.fib_levels && (
          <View style={[styles.fibCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fibTitle, { color: colors.tabBarInactive }]}>Fibonacci Levels</Text>
            {Object.entries(position.fib_levels)
              .filter(([k]) => !['orh', 'orl', 'mid'].includes(k))
              .map(([key, val]) => (
                <View key={key} style={styles.fibRow}>
                  <Text style={[styles.fibKey, { color: colors.tabBarInactive }]}>
                    {key.replace('_', ' ').replace('up', '↑').replace('dn', '↓')}
                  </Text>
                  <Text style={[styles.fibVal, { color: colors.text }]}>
                    ${(val as number).toFixed(2)}
                  </Text>
                </View>
              ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const AccountStat = ({ label, value, color, colors }: any) => (
  <View style={styles.accountStat}>
    <Text style={[styles.acctLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.acctValue, { color: color ?? colors.text }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title:     { fontSize: 20, fontWeight: '700' },
  accountRow: { flexDirection: 'row', justifyContent: 'space-around', borderRadius: 14, borderWidth: 1, padding: 14 },
  accountStat: { alignItems: 'center' },
  acctLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  acctValue: { fontSize: 15, fontWeight: '700' },
  fibCard:   { borderRadius: 14, borderWidth: 1, padding: 14 },
  fibTitle:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  fibRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  fibKey:    { fontSize: 13 },
  fibVal:    { fontSize: 13, fontWeight: '600' },
});
