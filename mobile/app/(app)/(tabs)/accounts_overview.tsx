import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaAccountsHistory, useAlpacaTransfers } from '@/hooks/queries/strategy/useAlpacaAccounts';
import type { AccountHistoryEntry, AccountTransfer } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useAccountValueDisplay } from '@/hooks/queries/strategy/useAccountValueDisplay';
import { StatPill } from '@/common/components/ui/StatPill';

type Period = 'today' | 'week' | 'month' | 'ytd' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week:  'This Week',
  month: 'This Month',
  ytd:   'YTD',
  all:   'All Time',
};

function getPnl(entry: AccountHistoryEntry | undefined, period: Period): { value: number; pct: number } | null {
  if (!entry?.available) return null;
  if (period === 'today')  return { value: entry.pnl_today ?? 0, pct: entry.pnl_today_pct ?? 0 };
  if (period === 'week')   return entry.pnl_week      != null ? { value: entry.pnl_week,      pct: entry.pnl_week_pct      ?? 0 } : null;
  if (period === 'month')  return entry.pnl_month     != null ? { value: entry.pnl_month,     pct: entry.pnl_month_pct     ?? 0 } : null;
  if (period === 'ytd')    return entry.pnl_ytd       != null ? { value: entry.pnl_ytd,       pct: entry.pnl_ytd_pct       ?? 0 } : null;
  if (period === 'all')    return entry.pnl_all_time  != null ? { value: entry.pnl_all_time,  pct: entry.pnl_all_time_pct  ?? 0 } : null;
  return null;
}

interface Props {
  /** True when rendered as a SegmentedPager scene (Accounts tab) — hides the
   *  back arrow and redundant title (the segment pill above already names it). */
  embedded?: boolean;
}

export default function AccountsScreen({ embedded = false }: Props) {
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
      {!embedded && (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Trading Accounts</Text>
          <View style={{ width: 22 }} />
        </View>
      )}

      {/* Period toggle */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.periodBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
        contentContainerStyle={styles.periodBarContent}
      >
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
      </ScrollView>

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

            {/* Transfer History — live-account only. Paper accounts start
                with a fixed virtual balance and don't take real ACH
                transfers, so there's nothing meaningful to show for that
                side. */}
            <TransferHistoryCard colors={colors} />

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
    available_balance?: number;
    options_buying_power?: number;
    long_market_value?: number;
    short_market_value?: number;
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
              No trading history for this period yet
            </Text>
          )}

          {/* Stats — horizontally scrollable so more data points fit than a
              fixed 3-column row could hold intuitively. Day Trades stays
              last regardless of how many pills precede it. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.statsScroll, { borderTopColor: colors.border }]}
            contentContainerStyle={styles.statsScrollContent}
          >
            <StatPill label="Cash" value={`$${(account?.cash ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={colors.accent} colors={colors} />
            <StatPill label="Buying Power" value={`$${(account?.buying_power ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={colors.accent} colors={colors} />
            <StatPill label="Available Balance" value={`$${(account?.available_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={colors.accent} colors={colors} />
            <StatPill label="Options BP" value={`$${(account?.options_buying_power ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={colors.accent} colors={colors} />
            <StatPill label="Long Value" value={`$${(account?.long_market_value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={colors.accent} colors={colors} />
            <StatPill label="Short Value" value={`$${(account?.short_market_value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={colors.accent} colors={colors} />
            <StatPill label="Day Trades" value={String(account?.day_trade_count ?? 0)} accentColor={colors.accent} colors={colors} />
          </ScrollView>

          {/* Lifetime capital summary — deposits vs. actual trading P&L, always
              visible regardless of the selected period since this is "since
              the account started", not a filtered window. */}
          {!!history && ((history.total_deposited ?? 0) > 0 || (history.total_withdrawn ?? 0) > 0) && (
            <View style={[styles.capitalRow, { borderTopColor: colors.border }]}>
              <CapitalStat label="Deposited" value={`$${(history.total_deposited ?? 0).toFixed(2)}`} colors={colors} />
              {(history.total_withdrawn ?? 0) > 0 && (
                <CapitalStat label="Withdrawn" value={`$${(history.total_withdrawn ?? 0).toFixed(2)}`} colors={colors} />
              )}
              {history.pnl_all_time != null && (
                <CapitalStat
                  label="All-Time P&L"
                  value={`${history.pnl_all_time >= 0 ? '+' : ''}$${history.pnl_all_time.toFixed(2)}`}
                  valueColor={history.pnl_all_time >= 0 ? colors.success : colors.error}
                  colors={colors}
                />
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
};

function formatTransferDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

/**
 * Status wording here reflects Alpaca's Activities endpoint (settled cash
 * movements only — CSD/CSW) via NonTradeActivityStatus ("executed"/
 * "correct"/"canceled"), NOT the richer pending/queued/rejected states
 * Alpaca's own dashboard shows for in-flight ACH transfers — those live on
 * a separate Broker-API-only Transfers object this app's retail API keys
 * can't reach, so a transfer that hasn't settled yet simply won't have an
 * Activity row here until it does.
 */
function transferStatusLabel(status: string | null): { label: string; color: 'success' | 'muted' } {
  if (status === 'canceled') return { label: 'Canceled', color: 'muted' };
  return { label: 'Complete', color: 'success' };
}

const TransferHistoryCard = ({ colors }: { colors: any }) => {
  const { data, isLoading } = useAlpacaTransfers();
  const transfers = data?.transfers ?? [];

  if (isLoading || transfers.length === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardLabel, { color: colors.text, marginBottom: 2 }]}>Transfer History</Text>
      <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive, marginBottom: 10 }]}>
        Live account deposits &amp; withdrawals
      </Text>
      {transfers.slice(0, 10).map((t: AccountTransfer, i: number) => {
        const status = transferStatusLabel(t.status);
        const statusColor = status.color === 'success' ? colors.success : colors.tabBarInactive;
        const amountColor = t.direction === 'deposit' ? colors.success : colors.error;
        return (
          <View
            key={t.id}
            style={[
              styles.transferRow,
              i < Math.min(transfers.length, 10) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.transferDate, { color: colors.text }]}>{formatTransferDate(t.date)}</Text>
              <Text style={[styles.transferDesc, { color: colors.tabBarInactive }]} numberOfLines={1}>
                {t.description || (t.direction === 'deposit' ? 'Deposit' : 'Withdrawal')}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.transferAmount, { color: amountColor }]}>
                {t.direction === 'deposit' ? '+' : '-'}${Math.abs(t.amount).toFixed(2)}
              </Text>
              <Text style={[styles.transferStatus, { color: statusColor }]}>{status.label}</Text>
            </View>
          </View>
        );
      })}
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

const CapitalStat = ({ label, value, valueColor, colors }: { label: string; value: string; valueColor?: string; colors: any }) => (
  <View style={styles.stat}>
    <Text style={[styles.statLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.statValue, { color: valueColor ?? colors.text }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title:     { fontSize: 20, fontWeight: '700' },

  periodBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  periodBarContent: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  periodBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
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

  statsScroll: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  statsScrollContent: { paddingTop: 12, paddingRight: 4 },
  stat:     { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 10, marginBottom: 3 },
  statValue: { fontSize: 13, fontWeight: '600' },

  capitalRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 0 },

  compCard:  { borderRadius: 14, borderWidth: 1, padding: 14 },
  compTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  compRow:   { flexDirection: 'row', alignItems: 'center' },
  compDivider: { width: StyleSheet.hairlineWidth, height: 36, marginHorizontal: 8 },
  compStat:  { flex: 1, alignItems: 'center' },
  compLabel: { fontSize: 11, marginBottom: 4 },
  compValue: { fontSize: 16, fontWeight: '700' },

  disclaimer: { fontSize: 11, lineHeight: 17, marginTop: 4 },

  transferRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  transferDate: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  transferDesc: { fontSize: 11 },
  transferAmount: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  transferStatus: { fontSize: 10, fontWeight: '600' },
});
