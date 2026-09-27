import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatPill } from '@/common/components/ui/StatPill';
import type { RobinhoodAccountSummary, RobinhoodEquityHistory } from '@/common/types/robinhood';
import type { BothAccountsResponse } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { ChartPoint, MiniLineChart } from './MiniLineChart';

const ROBINHOOD_GREEN = '#00C805';
const ALPACA_YELLOW = '#FFD60A';
const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 32 - 32;
const CHART_H = 64;

type BrokerKey = 'robinhood' | 'alpaca' | 'tradier' | 'combined';

const BROKERS: { key: BrokerKey; label: string; accent: string }[] = [
  { key: 'robinhood', label: 'Robinhood', accent: ROBINHOOD_GREEN },
  { key: 'alpaca', label: 'Alpaca', accent: ALPACA_YELLOW },
  { key: 'tradier', label: 'Tradier', accent: '#8E8E93' },
  { key: 'combined', label: 'Combined', accent: '#5AC8FA' },
];

const money = (v: number, min = 2) => `$${v.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: 2 })}`;

/**
 * Broker toggle (Robinhood / Alpaca / Tradier / Combined) + the selected
 * broker's balance, cash-vs-margin breakdown (Robinhood only — see
 * robinhood_service.py's honest null-when-cash-account handling), and Day
 * P/L sparkline.
 *
 * Tradier is a visible-but-stub option on purpose: this app's Tradier
 * integration (api/services/tradier/) is market-data/options-chain only —
 * there's no personal Tradier brokerage account or balance endpoint wired
 * up, so it's never faked here, just clearly labeled "Not connected."
 *
 * The Day P/L sparkline only exists for Robinhood — there's no equivalent
 * intraday-equity endpoint for Alpaca in this codebase (its /accounts/both
 * poll is a point-in-time snapshot, not a historical series), so Alpaca and
 * Combined show the P/L figure without a chart rather than a fabricated one.
 */
export function BrokerBalanceCard({
  robinhood, robinhoodEquityHistory, alpaca, colors,
}: {
  robinhood?: RobinhoodAccountSummary | null;
  robinhoodEquityHistory?: RobinhoodEquityHistory | null;
  alpaca?: BothAccountsResponse | null;
  colors: any;
}) {
  const [selected, setSelected] = useState<BrokerKey>('robinhood');

  // Prefer the live Alpaca account (real money, comparable to Robinhood) —
  // fall back to paper if live isn't available (e.g. no live keys configured).
  const alpacaAccount = alpaca?.live?.available ? alpaca.live : (alpaca?.paper?.available ? alpaca.paper : null);
  const alpacaLabel = alpaca?.live?.available ? 'Alpaca — Live' : 'Alpaca — Paper';

  const sparklinePoints = useMemo((): ChartPoint[] => {
    if (!robinhoodEquityHistory?.available) return [];
    return robinhoodEquityHistory.points.map(p => ({ t: new Date(p.timestamp).getTime(), v: p.equity }));
  }, [robinhoodEquityHistory]);

  const combined = useMemo(() => {
    const parts: { label: string; equity: number; pnl: number }[] = [];
    if (robinhood?.available) {
      parts.push({ label: 'Robinhood', equity: robinhood.equity ?? 0, pnl: robinhood.pnl_today ?? 0 });
    }
    if (alpacaAccount?.available) {
      parts.push({ label: alpacaLabel, equity: alpacaAccount.equity ?? 0, pnl: alpacaAccount.pnl_today ?? 0 });
    }
    const totalEquity = parts.reduce((s, p) => s + p.equity, 0);
    const totalPnl = parts.reduce((s, p) => s + p.pnl, 0);
    return { parts, totalEquity, totalPnl };
  }, [robinhood, alpacaAccount, alpacaLabel]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.toggleRow}>
        {BROKERS.map(b => {
          const active = selected === b.key;
          return (
            <TouchableOpacity
              key={b.key}
              onPress={() => setSelected(b.key)}
              activeOpacity={0.75}
              style={[
                styles.togglePill,
                { borderColor: active ? b.accent : colors.border, backgroundColor: active ? b.accent + '18' : 'transparent' },
              ]}
            >
              <Text style={[styles.togglePillText, { color: active ? b.accent : colors.tabBarInactive }]}>{b.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {selected === 'robinhood' && (
        <RobinhoodBalance account={robinhood} sparkline={sparklinePoints} colors={colors} />
      )}
      {selected === 'alpaca' && (
        <AlpacaBalance account={alpacaAccount} label={alpacaLabel} colors={colors} />
      )}
      {selected === 'tradier' && <TradierStub colors={colors} />}
      {selected === 'combined' && <CombinedBalance combined={combined} colors={colors} />}
    </View>
  );
}

const RobinhoodBalance = ({ account, sparkline, colors }: { account?: RobinhoodAccountSummary | null; sparkline: ChartPoint[]; colors: any }) => {
  if (!account?.available) {
    return <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>Not connected.</Text>;
  }
  const pnl = account.pnl_today ?? 0;
  const pnlPct = account.pnl_today_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.equity, { color: colors.text }]}>{money(account.equity ?? 0)}</Text>

      <View style={styles.pnlRow}>
        <View style={[styles.pnlPill, { backgroundColor: pnlColor + '18' }]}>
          <Ionicons name={pnl >= 0 ? 'trending-up' : 'trending-down'} size={14} color={pnlColor} />
          <Text style={[styles.pnlValue, { color: pnlColor }]}>{pnl >= 0 ? '+' : ''}{money(Math.abs(pnl))}</Text>
          <Text style={[styles.pnlPct, { color: pnlColor }]}>({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</Text>
        </View>
      </View>

      {sparkline.length > 1 && (
        <MiniLineChart
          series={[{ key: 'rh', color: pnlColor, points: sparkline }]}
          width={CHART_W}
          height={CHART_H}
          fillFirstSeries
        />
      )}

      <View style={[styles.divider, { borderTopColor: colors.border }]} />

      <Text style={[styles.sectionLabel, { color: colors.tabBarInactive }]}>Cash vs. Margin</Text>
      {account.is_margin_account && account.margin ? (
        <View style={styles.pillRow}>
          <StatPill label="Cash" value={money(account.cash ?? 0, 0)} accentColor={ROBINHOOD_GREEN} colors={colors} />
          <StatPill label="Margin Limit" value={money(account.margin.margin_limit, 0)} accentColor={ROBINHOOD_GREEN} colors={colors} />
          <StatPill label="Unallocated Margin" value={money(account.margin.unallocated_margin_cash, 0)} accentColor={ROBINHOOD_GREEN} colors={colors} />
          <StatPill label="Overnight BP" value={money(account.margin.overnight_buying_power, 0)} accentColor={ROBINHOOD_GREEN} colors={colors} />
        </View>
      ) : (
        <View style={styles.pillRow}>
          <StatPill label="Cash" value={money(account.cash ?? 0, 0)} accentColor={ROBINHOOD_GREEN} colors={colors} />
          <StatPill label="Buying Power" value={money(account.buying_power ?? 0, 0)} accentColor={ROBINHOOD_GREEN} colors={colors} />
          <StatPill label="Market Value" value={money(account.market_value ?? 0, 0)} accentColor={ROBINHOOD_GREEN} colors={colors} />
        </View>
      )}
      {!account.is_margin_account && (
        <Text style={[styles.footnote, { color: colors.tabBarInactive }]}>
          Cash account — Robinhood hasn't extended margin here, so there's no margin balance to show.
        </Text>
      )}
    </View>
  );
};

const AlpacaBalance = ({ account, label, colors }: { account?: any; label: string; colors: any }) => {
  if (!account?.available) {
    return <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>Not connected.</Text>;
  }
  const pnl = account.pnl_today ?? 0;
  const pnlPct = account.pnl_today_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.sectionLabel, { color: colors.tabBarInactive }]}>{label}</Text>
      <Text style={[styles.equity, { color: colors.text }]}>{money(account.equity ?? 0)}</Text>
      <View style={styles.pnlRow}>
        <View style={[styles.pnlPill, { backgroundColor: pnlColor + '18' }]}>
          <Ionicons name={pnl >= 0 ? 'trending-up' : 'trending-down'} size={14} color={pnlColor} />
          <Text style={[styles.pnlValue, { color: pnlColor }]}>{pnl >= 0 ? '+' : ''}{money(Math.abs(pnl))}</Text>
          <Text style={[styles.pnlPct, { color: pnlColor }]}>({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</Text>
        </View>
      </View>
      <View style={styles.pillRow}>
        <StatPill label="Cash" value={money(account.cash ?? 0, 0)} accentColor={ALPACA_YELLOW} colors={colors} />
        <StatPill label="Buying Power" value={money(account.buying_power ?? 0, 0)} accentColor={ALPACA_YELLOW} colors={colors} />
        <StatPill label="Non-Marginable BP" value={money(account.available_balance ?? 0, 0)} accentColor={ALPACA_YELLOW} colors={colors} />
      </View>
    </View>
  );
};

const TradierStub = ({ colors }: { colors: any }) => (
  <View style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
    <Ionicons name="unlink-outline" size={26} color={colors.tabBarInactive} />
    <Text style={[styles.sectionLabel, { color: colors.text }]}>Not connected</Text>
    <Text style={[styles.emptyText, { color: colors.tabBarInactive, textAlign: 'center' }]}>
      Tradier is only used in this app for market data / the options chain — there's no personal Tradier brokerage account configured.
    </Text>
  </View>
);

const CombinedBalance = ({
  combined, colors,
}: {
  combined: { parts: { label: string; equity: number; pnl: number }[]; totalEquity: number; totalPnl: number };
  colors: any;
}) => {
  if (combined.parts.length === 0) {
    return <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>No connected accounts to combine yet.</Text>;
  }
  const pnlColor = combined.totalPnl >= 0 ? colors.success : colors.error;

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.sectionLabel, { color: colors.tabBarInactive }]}>Net Worth Across Accounts</Text>
      <Text style={[styles.equity, { color: colors.text }]}>{money(combined.totalEquity)}</Text>
      <View style={styles.pnlRow}>
        <View style={[styles.pnlPill, { backgroundColor: pnlColor + '18' }]}>
          <Ionicons name={combined.totalPnl >= 0 ? 'trending-up' : 'trending-down'} size={14} color={pnlColor} />
          <Text style={[styles.pnlValue, { color: pnlColor }]}>
            {combined.totalPnl >= 0 ? '+' : ''}{money(Math.abs(combined.totalPnl))} today
          </Text>
        </View>
      </View>
      <View style={[styles.divider, { borderTopColor: colors.border }]} />
      {combined.parts.map(p => (
        <View key={p.label} style={styles.combinedRow}>
          <Text style={[styles.combinedLabel, { color: colors.text }]}>{p.label}</Text>
          <Text style={[styles.combinedValue, { color: colors.text }]}>{money(p.equity)}</Text>
        </View>
      ))}
      <Text style={[styles.footnote, { color: colors.tabBarInactive }]}>
        Tradier isn't included — no personal Tradier account is connected in this app.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, gap: 12, borderWidth: 1 },

  toggleRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  togglePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  togglePillText: { fontSize: 12, fontWeight: '700' },

  equity: { fontSize: 28, fontWeight: '700' },
  pnlRow: { flexDirection: 'row' },
  pnlPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  pnlValue: { fontSize: 14, fontWeight: '700' },
  pnlPct: { fontSize: 12, fontWeight: '600' },

  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  emptyText: { fontSize: 12, lineHeight: 17, paddingVertical: 12 },
  footnote: { fontSize: 10, lineHeight: 14, marginTop: 2 },

  combinedRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  combinedLabel: { fontSize: 13, fontWeight: '600' },
  combinedValue: { fontSize: 13, fontWeight: '700' },
});
