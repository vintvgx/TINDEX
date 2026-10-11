import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { usePnlSummary, type PnlPeriod } from '@/hooks/queries/strategy/usePnlSummary';
import { useStrategyPerformance } from '@/hooks/queries/strategy/useStrategyStats';
import { useLiveEquity } from '@/hooks/queries/strategy/useLiveEquity';

const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (v: number | null | undefined) =>
  v == null ? '—' : `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Account mode's spendable cash for options — options buying power when
 *  the broker reports it, else the unlevered available balance, else cash. */
export function accountAvailableFunds(acct: { options_buying_power?: number; available_balance?: number; cash?: number } | undefined): number | null {
  if (!acct) return null;
  return acct.options_buying_power ?? acct.available_balance ?? acct.cash ?? null;
}

/**
 * Dynamic card "account" view: Live Equity hero (the same figure the
 * Positions screen shows — cash + open positions' market value), available
 * funds beside it, mode-pure P&L by period, and mode-pure strategy
 * performance. The LIVE/PAPER toggle flips every number on the card.
 *
 * Period P&L is the unified summary's `total` (realized net of fees + open
 * positions live) — the same endpoint the Trade Log reads, so the two can't
 * disagree. The broker's equity − last_equity is only a dev-log cross-check.
 */
export function DynamicAccountView() {
  const colors = useThemeColors();
  const [mode, setMode] = useState<'live' | 'paper'>('live');

  const { data: accounts, isLoading } = useAlpacaBothAccounts();
  const { data: pnl } = usePnlSummary(mode);
  const { data: perf } = useStrategyPerformance(mode);
  const { account, displayEquity, positionCount } = useLiveEquity(mode);

  const overall = perf?.overall;
  const available = accountAvailableFunds(account);
  const tone = (v: number | null | undefined) =>
    v == null ? colors.textSecondary : v >= 0 ? colors.success : colors.error;

  const periods: Array<[string, PnlPeriod]> = [
    ['TODAY', 'today'],
    ['WEEK', 'week'],
    ['MONTH', 'month'],
    ['YTD', 'ytd'],
  ];

  useEffect(() => {
    if (!__DEV__ || !pnl || account?.pnl_today == null) return;
    const drift = account.pnl_today - pnl.today.total;
    if (Math.abs(drift) > 25) {
      console.log(`[pnl] ${mode} today: summary ${pnl.today.total.toFixed(2)} vs equity Δ ${account.pnl_today.toFixed(2)}`);
    }
  }, [pnl, account?.pnl_today, mode]);

  const modeColor = mode === 'live' ? colors.success : colors.warning;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
          {mode === 'live' ? 'LIVE ACCOUNT' : 'PAPER ACCOUNT'}
        </Text>
        <View style={{ flex: 1 }} />
        {account && !account.available ? (
          <Text style={[styles.mono, { fontSize: 10, color: colors.error, marginRight: 8 }]}>UNAVAILABLE</Text>
        ) : null}
        {/* LIVE / PAPER toggle — flips every number on this card */}
        <View style={[styles.toggle, { borderColor: colors.border, backgroundColor: colors.text + '0A' }]}>
          {(['live', 'paper'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              activeOpacity={0.7}
              style={[
                styles.toggleOpt,
                mode === m && { backgroundColor: (m === 'live' ? colors.success : colors.warning) + '22' },
              ]}
            >
              <Text
                style={[
                  styles.mono,
                  {
                    fontSize: 10,
                    fontWeight: '800',
                    color: mode === m ? (m === 'live' ? colors.success : colors.warning) : colors.textTertiary,
                  },
                ]}
              >
                {m === 'live' ? 'LIVE' : 'PAPER'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Hero: Live Equity (big) + Available funds beside it */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]}>
            Live Equity{positionCount > 0 ? ` · ${positionCount} open` : ''}
          </Text>
          <Text style={[styles.mono, { fontSize: 30, fontWeight: '800', color: colors.text, marginTop: 2 }]}>
            {isLoading ? '…' : money(displayEquity)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]}>Available</Text>
          <Text style={[styles.mono, { fontSize: 19, fontWeight: '800', color: modeColor, marginTop: 2 }]}>
            {isLoading && available == null ? '…' : money(available)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2, marginTop: 4 }}>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary }]}>
          Options BP <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>{money(account?.options_buying_power)}</Text>
        </Text>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary }]}>Cash {money(account?.cash)}</Text>
      </View>

      {/* Mode-pure P&L by period */}
      <View style={[styles.grid, { borderColor: colors.border }]}>
        {periods.map(([label, key]) => {
          const v = pnl?.[key].total;
          return (
            <View key={label} style={styles.cell}>
              <Text style={[styles.mono, { fontSize: 9, letterSpacing: 1.2, color: colors.textTertiary }]}>{label}</Text>
              <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: tone(v), marginTop: 3 }]}>
                {signedMoney(v)}
              </Text>
            </View>
          );
        })}
      </View>
      {pnl ? (
        <Text style={[styles.mono, { fontSize: 10.5, color: colors.textTertiary, marginTop: 8 }]}>
          Today {signedMoney(pnl.today.realized_net)} realized · {signedMoney(pnl.today.unrealized)} open · est. fees {money(pnl.today.fees)}
        </Text>
      ) : null}

      {/* Mode-pure strategy performance */}
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
  toggle: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 2,
  },
  toggleOpt: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
});
