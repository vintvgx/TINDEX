import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaAccountsHistory } from '@/hooks/queries/strategy/useAlpacaAccounts';
import type { AccountHistoryEntry } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useAccountValueDisplay } from '@/hooks/queries/strategy/useAccountValueDisplay';

type Period = 'today' | 'week' | 'month';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week:  'This Week',
  month: 'This Month',
};

function getPnl(entry: AccountHistoryEntry | undefined, period: Period): { value: number; pct: number } | null {
  if (!entry?.available) return null;
  if (period === 'today')  return { value: entry.pnl_today ?? 0, pct: entry.pnl_today_pct ?? 0 };
  if (period === 'week')   return entry.pnl_week   != null ? { value: entry.pnl_week,  pct: entry.pnl_week_pct  ?? 0 } : null;
  if (period === 'month')  return entry.pnl_month  != null ? { value: entry.pnl_month, pct: entry.pnl_month_pct ?? 0 } : null;
  return null;
}

export default function AccountsScreen() {
  const colors = useThemeColors();
  const [period, setPeriod] = useState<Period>('today');
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const { paper: paperDisplay, live: liveDisplay, has_open_positions } = useAccountValueDisplay();
  const { data: history, isLoading: histLoading, refetch: refetchHistory } = useAlpacaAccountsHistory();

  const isLoading = histLoading && !paperDisplay && !liveDisplay;

  const handlePullRefresh = useCallback(async () => {
    setManualRefreshing(true);
    await refetchHistory();
    setManualRefreshing(false);
  }, [refetchHistory]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>

      {/* Sticky header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Trading Accounts</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Period toggle */}
      <View style={[styles.periodBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => {
          const active = period === p;
          return (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              activeOpacity={0.7}
              style={[
                styles.periodBtn,
                active && { backgroundColor: colors.accent + '20', borderRadius: 8 },
              ]}
            >
              <Text style={[
                styles.periodBtnText,
                { color: active ? colors.accent : colors.tabBarInactive, fontWeight: active ? '700' : '500' },
              ]}>
                {PERIOD_LABELS[p]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={manualRefreshing}
            onRefresh={handlePullRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Paper Account */}
            <AccountCard
              label="Paper Trading"
              subtitle="Simulated — no real money"
              accentColor="#FF9F0A"
              account={paperDisplay}
              history={history?.paper}
              period={period}
              colors={colors}
            />

            {/* Live Account */}
            <AccountCard
              label="Live Trading"
              subtitle="Real money — trade with caution"
              accentColor={colors.success}
              account={liveDisplay}
              history={history?.live}
              period={period}
              colors={colors}
            />

            {/* Live indicator when positions are open */}
            {has_open_positions && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' }} />
                <Text style={{ color: colors.tabBarInactive, fontSize: 11 }}>
                  Equity updating every 5 s from live positions
                </Text>
              </View>
            )}

            {/* P&L comparison — only shown for today */}
            {period === 'today' && paperDisplay?.available && liveDisplay?.available && (
              <ComparisonCard
                paper={paperDisplay}
                live={liveDisplay}
                colors={colors}
              />
            )}

            {period !== 'today' && (
              <Text style={[styles.disclaimer, { color: colors.tabBarInactive }]}>
                Pull down to refresh period data. Week and month P&L are based on Alpaca portfolio history.
              </Text>
            )}

            <Text style={[styles.disclaimer, { color: colors.tabBarInactive }]}>
              Paper and Live account data shown above. Trading mode (paper vs live) is
              configured per-strategy in the ORB Strategy screen.
            </Text>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

interface AccountCardProps {
  label: string;
  subtitle: string;
  accentColor: string;
  account?: {
    available: boolean;
    equity?: number;
    cash?: number;
    buying_power?: number;
    pnl_today?: number;
    pnl_today_pct?: number;
    day_trade_count?: number;
    live_derived?: boolean;
    total_unrealized_pl?: number;
    error?: string;
  } | null;
  history?: AccountHistoryEntry;
  period: Period;
  colors: any;
}

const AccountCard: React.FC<AccountCardProps> = ({
  label, subtitle, accentColor, account, history, period, colors,
}) => {
  const unavailable = !account?.available;
  const pnlData = getPnl(history ?? (account as any), period);
  const pnl    = pnlData?.value ?? 0;
  const pnlPct = pnlData?.pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const hasHistoryData = pnlData !== null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Card header */}
      <View style={styles.cardHeader}>
        <View>
          <View style={styles.labelRow}>
            <View style={[styles.dot, { backgroundColor: accentColor }]} />
            <Text style={[styles.cardLabel, { color: colors.text }]}>{label}</Text>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive }]}>{subtitle}</Text>
        </View>
        <View style={[styles.periodTag, { backgroundColor: accentColor + '18', borderColor: accentColor + '44' }]}>
          <Text style={[styles.periodTagText, { color: accentColor }]}>{PERIOD_LABELS[period]}</Text>
        </View>
      </View>

      {unavailable ? (
        <View style={styles.unavailableRow}>
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={[styles.unavailableText, { color: colors.warning }]}>
            {account?.error?.includes('403') || account?.error?.includes('401')
              ? 'API credentials not authorised for this account type'
              : 'Account unavailable — check API key permissions'}
          </Text>
        </View>
      ) : (
        <>
          {/* Main equity */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={[styles.equity, { color: colors.text }]}>
              ${(account?.equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </Text>
            {account?.live_derived && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#10B981' }} />
                <Text style={{ color: colors.tabBarInactive, fontSize: 10 }}>LIVE</Text>
              </View>
            )}
          </View>

          {/* Unrealized P&L from open positions */}
          {account?.live_derived && account.total_unrealized_pl !== undefined && (
            <Text style={{ color: account.total_unrealized_pl >= 0 ? colors.success : colors.error, fontSize: 13, fontWeight: '600', marginTop: -4 }}>
              {account.total_unrealized_pl >= 0 ? '+' : ''}${account.total_unrealized_pl.toFixed(2)} unrealized
            </Text>
          )}

          {/* P&L for selected period */}
          {hasHistoryData ? (
            <View style={styles.pnlRow}>
              <View style={[styles.pnlPill, { backgroundColor: pnlColor + '18' }]}>
                <Ionicons
                  name={pnl >= 0 ? 'trending-up' : 'trending-down'}
                  size={14}
                  color={pnlColor}
                />
                <Text style={[styles.pnlValue, { color: pnlColor }]}>
                  {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)}
                </Text>
                <Text style={[styles.pnlPct, { color: pnlColor }]}>
                  ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                </Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.noData, { color: colors.tabBarInactive }]}>
              Period data loading…
            </Text>
          )}

          {/* Stats row */}
          <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
            <Stat label="Cash" value={`$${(account?.cash ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
            <Stat label="Buying Power" value={`$${(account?.buying_power ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
            <Stat label="Day Trades" value={String(account?.day_trade_count ?? 0)} colors={colors} />
          </View>
        </>
      )}
    </View>
  );
};

const ComparisonCard = ({ paper, live, colors }: any) => {
  const paperPnl = paper.pnl_today ?? 0;
  const livePnl  = live.pnl_today  ?? 0;

  return (
    <View style={[styles.compCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.compTitle, { color: colors.tabBarInactive }]}>{"TODAY'S P&L COMPARISON"}</Text>
      <View style={styles.compRow}>
        <CompStat label="Paper" value={paperPnl} colors={colors} />
        <View style={[styles.compDivider, { backgroundColor: colors.border }]} />
        <CompStat label="Live" value={livePnl} colors={colors} />
        <View style={[styles.compDivider, { backgroundColor: colors.border }]} />
        <CompStat
          label="Combined"
          value={paperPnl + livePnl}
          colors={colors}
        />
      </View>
    </View>
  );
};

const CompStat = ({ label, value, colors }: { label: string; value: number; colors: any }) => (
  <View style={styles.compStat}>
    <Text style={[styles.compLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.compValue, { color: value >= 0 ? colors.success : colors.error }]}>
      {value >= 0 ? '+' : ''}${value.toFixed(2)}
    </Text>
  </View>
);

const Stat = ({ label, value, colors }: { label: string; value: string; colors: any }) => (
  <View style={styles.stat}>
    <Text style={[styles.statLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title:     { fontSize: 20, fontWeight: '700' },

  periodBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  periodBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  periodBtnText: { fontSize: 13 },

  card:         { borderRadius: 16, padding: 16, gap: 10, borderWidth: 1 },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  labelRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  dot:          { width: 9, height: 9, borderRadius: 5 },
  cardLabel:    { fontSize: 17, fontWeight: '700' },
  cardSubtitle: { fontSize: 12 },

  periodTag:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  periodTagText: { fontSize: 11, fontWeight: '700' },

  unavailableRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  unavailableText: { fontSize: 12, flex: 1 },

  equity:  { fontSize: 30, fontWeight: '700' },
  pnlRow:  { flexDirection: 'row' },
  pnlPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  pnlValue:{ fontSize: 15, fontWeight: '700' },
  pnlPct:  { fontSize: 13, fontWeight: '600' },
  noData:  { fontSize: 13, fontStyle: 'italic' },

  statsRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 0 },
  stat:     { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 10, marginBottom: 3 },
  statValue: { fontSize: 13, fontWeight: '600' },

  compCard:  { borderRadius: 14, borderWidth: 1, padding: 14 },
  compTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  compRow:   { flexDirection: 'row', alignItems: 'center' },
  compDivider: { width: StyleSheet.hairlineWidth, height: 36, marginHorizontal: 8 },
  compStat:  { flex: 1, alignItems: 'center' },
  compLabel: { fontSize: 11, marginBottom: 4 },
  compValue: { fontSize: 16, fontWeight: '700' },

  disclaimer: { fontSize: 11, lineHeight: 17, marginTop: 4 },
});
