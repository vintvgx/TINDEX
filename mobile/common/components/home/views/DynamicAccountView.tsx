import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaBothAccounts, useAlpacaAccountsHistory } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useStrategyPerformance } from '@/hooks/queries/strategy/useStrategyStats';

const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (v: number | null | undefined) =>
  v == null ? '—' : `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Live account's spendable cash for options — options buying power when
 *  the broker reports it, else the unlevered available balance, else cash. */
export function liveAvailableFunds(acct: ReturnType<typeof useAlpacaBothAccounts>['data']): number | null {
  const live = acct?.live;
  if (!live || !live.available) return null;
  return live.options_buying_power ?? live.available_balance ?? live.cash ?? null;
}

/**
 * Dynamic card "account" view: the LIVE account's available funds plus
 * performance — live P&L by period and the strategy rating (win rate,
 * profit factor, grade) from the trade log.
 */
export function DynamicAccountView() {
  const colors = useThemeColors();
  const { data: accounts, isLoading } = useAlpacaBothAccounts();
  const { data: history } = useAlpacaAccountsHistory();
  const { data: perf } = useStrategyPerformance();
  const live = accounts?.live;
  const liveHist = history?.live;
  const overall = perf?.overall;
  const available = liveAvailableFunds(accounts);
  const tone = (v: number | null | undefined) =>
    v == null ? colors.textSecondary : v >= 0 ? colors.success : colors.error;

  const periods: Array<[string, number | null | undefined]> = [
    ['TODAY', liveHist?.pnl_today ?? live?.pnl_today],
    ['WEEK', liveHist?.pnl_week],
    ['MONTH', liveHist?.pnl_month],
    ['YTD', liveHist?.pnl_ytd],
  ];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
          LIVE ACCOUNT
        </Text>
        <View style={{ flex: 1 }} />
        {live && !live.available ? (
          <Text style={[styles.mono, { fontSize: 10, color: colors.error }]}>UNAVAILABLE</Text>
        ) : null}
      </View>

      {/* Hero: available funds */}
      <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary, marginTop: 12 }]}>Available funds</Text>
      <Text style={[styles.mono, { fontSize: 30, fontWeight: '800', color: colors.text, marginTop: 2 }]}>
        {isLoading && available == null ? '…' : money(available)}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2, marginTop: 4 }}>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary }]}>
          Options BP <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>{money(live?.options_buying_power)}</Text>
        </Text>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary }]}>Equity {money(live?.equity)}</Text>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary }]}>Cash {money(live?.cash)}</Text>
      </View>

      {/* Live P&L by period */}
      <View style={[styles.grid, { borderColor: colors.border }]}>
        {periods.map(([label, v]) => (
          <View key={label} style={styles.cell}>
            <Text style={[styles.mono, { fontSize: 9, letterSpacing: 1.2, color: colors.textTertiary }]}>{label}</Text>
            <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: tone(v), marginTop: 3 }]}>
              {signedMoney(v)}
            </Text>
          </View>
        ))}
      </View>

      {/* Strategy performance */}
      <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary, marginTop: 16 }]}>
        PERFORMANCE
      </Text>
      {overall ? (
        <View style={[styles.grid, { borderColor: colors.border, marginTop: 8 }]}>
          <View style={styles.cell}>
            <Text style={[styles.mono, { fontSize: 9, letterSpacing: 1.2, color: colors.textTertiary }]}>GRADE</Text>
            <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 3 }]}>
              {overall.grade}
            </Text>
          </View>
          <View style={styles.cell}>
            <Text style={[styles.mono, { fontSize: 9, letterSpacing: 1.2, color: colors.textTertiary }]}>WIN RATE</Text>
            <Text
              style={[
                styles.mono,
                { fontSize: 13, fontWeight: '800', marginTop: 3, color: overall.win_rate_pct >= 55 ? colors.success : colors.error },
              ]}
            >
              {overall.win_rate_pct}%
            </Text>
          </View>
          <View style={styles.cell}>
            <Text style={[styles.mono, { fontSize: 9, letterSpacing: 1.2, color: colors.textTertiary }]}>P. FACTOR</Text>
            <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 3 }]}>
              {overall.profit_factor.toFixed(2)}
            </Text>
          </View>
          <View style={styles.cell}>
            <Text style={[styles.mono, { fontSize: 9, letterSpacing: 1.2, color: colors.textTertiary }]}>
              {overall.total_trades} TRADES
            </Text>
            <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: tone(overall.total_pnl), marginTop: 3 }]}>
              {signedMoney(overall.total_pnl)}
            </Text>
          </View>
        </View>
      ) : (
        <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 8 }}>No closed trades yet.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    rowGap: 10,
  },
  cell: { width: '50%' },
});
