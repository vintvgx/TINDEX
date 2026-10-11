import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaAccountsHistory } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useLiveEquity } from '@/hooks/queries/strategy/useLiveEquity';
import { accountAvailableFunds } from '@/common/components/home/views/DynamicAccountView';

const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (v: number | null | undefined) =>
  v == null ? '—' : `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface LiveAccountStripProps {
  bottomInset?: number;
}

/**
 * Read-only LIVE account summary pinned under the chart toolbar: Live Equity,
 * Available funds, and today's P&L — the same figures the Home account card
 * shows. Also gives the ticker wheel thumb room above the screen edge.
 */
export function LiveAccountStrip({ bottomInset = 0 }: LiveAccountStripProps) {
  const colors = useThemeColors();
  const { account, displayEquity } = useLiveEquity('live');
  const { data: history } = useAlpacaAccountsHistory();

  const available = accountAvailableFunds(account);
  const pnlToday = history?.live?.pnl_today ?? account?.pnl_today;
  const pnlPct = history?.live?.pnl_today_pct ?? account?.pnl_today_pct;
  const pnlColor = pnlToday == null ? colors.textSecondary : pnlToday >= 0 ? colors.success : colors.error;
  const unavailable = account != null && !account.available;

  return (
    <View
      style={[
        s.bar,
        { backgroundColor: colors.background, borderTopColor: colors.separator, paddingBottom: 6 + bottomInset },
      ]}
    >
      <View style={s.cell}>
        <Text style={[s.label, { color: colors.textTertiary }]}>LIVE EQUITY</Text>
        <Text style={[s.value, { color: colors.text }]} numberOfLines={1}>
          {unavailable ? '—' : account ? money(displayEquity) : '…'}
        </Text>
      </View>
      <View style={[s.cell, { alignItems: 'center' }]}>
        <Text style={[s.label, { color: colors.textTertiary }]}>AVAILABLE</Text>
        <Text style={[s.value, { color: colors.success }]} numberOfLines={1}>
          {unavailable ? '—' : money(available)}
        </Text>
      </View>
      <View style={[s.cell, { alignItems: 'flex-end' }]}>
        <Text style={[s.label, { color: colors.textTertiary }]}>DAY P&L</Text>
        <Text style={[s.value, { color: pnlColor }]} numberOfLines={1}>
          {signedMoney(pnlToday)}
          {pnlPct != null ? (
            <Text style={{ fontSize: 10, fontWeight: '600' }}>{` ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}</Text>
          ) : null}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    // Extra side room: the display's rounded bottom corners clip the
    // left/right-aligned figures at a normal 14px gutter.
    paddingHorizontal: 28,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cell: { flex: 1 },
  label: { fontFamily: 'Menlo', fontSize: 9, letterSpacing: 1 },
  value: { fontFamily: 'Menlo', fontSize: 13, fontWeight: '700', marginTop: 1 },
});
