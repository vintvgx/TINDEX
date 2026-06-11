import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { useStrategyTrades } from '@/hooks/queries/strategy/useStrategyTrades';
import { useStrategyStats, useStrategyStatsByProfile } from '@/hooks/queries/strategy/useStrategyStats';
import { useStrategyDebugLogs } from '@/hooks/queries/strategy/useStrategyDebugLogs';
import type { ProfileKey, ORBTrade, StrategyStats, DebugLogEntry, DebugLevel } from '@/common/types/strategy';

type Filter = 'ALL' | ProfileKey;
type Tab = 'log' | 'stats' | 'debug';

const DEBUG_COLORS: Record<DebugLevel, string> = {
  ERROR:   '#EF4444',
  WARN:    '#F59E0B',
  INFO:    '#3B82F6',
  DEBUG:   '#8B5CF6',
  SUCCESS: '#22C55E',
};

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'ALL' },
  { label: '🐂 Bull Dog', value: 'BULL_DOG' },
  { label: '🐱 Thunder Cat', value: 'THUNDER_CAT' },
  { label: '🐺 Wolf', value: 'WOLF' },
];

export default function TradeLogScreen() {
  const colors = useThemeColors();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [tab, setTab] = useState<Tab>('log');

  const { data: trades, isLoading: tradesLoading } = useStrategyTrades({
    profile: filter,
    limit: 50,
  });
  const { data: stats,   isLoading: statsLoading }  = useStrategyStats(filter);
  const { data: byProfile } = useStrategyStatsByProfile();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>

      {/* Sticky header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Trade Log & Stats</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Tab toggle (sticky) */}
      <View style={[styles.tabToggleWrap, { backgroundColor: colors.background }]}>
        <View style={[styles.tabToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['log', 'stats', 'debug'] as const).map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tabBtn, tab === t && { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.tabText, { color: tab === t ? '#fff' : colors.tabBarInactive }]}>
                {t === 'log' ? 'Trade Log' : t === 'stats' ? 'Stats' : 'Debug'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'debug' ? (
        <DebugLogPanel colors={colors} />
      ) : (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.value}
              onPress={() => setFilter(f.value)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === f.value ? colors.accent : colors.card,
                  borderColor: filter === f.value ? colors.accent : colors.border,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: filter === f.value ? '#fff' : colors.text }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {tab === 'log' ? (
          tradesLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : (
            <>
              {(!trades || trades.length === 0) && (
                <Text style={[styles.empty, { color: colors.tabBarInactive }]}>No trades yet</Text>
              )}
              {trades?.map(trade => (
                <TradeRow key={trade.id} trade={trade} colors={colors} />
              ))}
            </>
          )
        ) : (
          statsLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : (
            <>
              {stats && <StatsPanel stats={stats} label={filter === 'ALL' ? 'All Profiles' : filter} colors={colors} />}
              {byProfile && (
                <>
                  <Text style={[styles.byProfileTitle, { color: colors.tabBarInactive }]}>
                    PERFORMANCE BY PROFILE
                  </Text>
                  {byProfile.map(s => (
                    <StatsPanel key={s.profile} stats={s} label={s.profile ?? ''} colors={colors} compact />
                  ))}
                </>
              )}
            </>
          )
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
      )}

    </SafeAreaView>
  );
}

const TradeRow = ({ trade, colors }: { trade: ORBTrade; colors: any }) => {
  const pnl      = trade.pnl ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const profileEmoji = trade.profile === 'BULL_DOG' ? '🐂' : trade.profile === 'WOLF' ? '🐺' : '🐱';

  return (
    <View style={[styles.tradeRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.tradeLeft}>
        <Text style={[styles.tradeDate, { color: colors.tabBarInactive }]}>{trade.trade_date}</Text>
        <Text style={[styles.tradeTicker, { color: colors.text }]}>
          {profileEmoji} {trade.ticker}
        </Text>
        <View style={styles.tradeBadges}>
          <View style={[styles.dirBadge, { backgroundColor: trade.direction === 'CALL' ? colors.success + '22' : colors.error + '22' }]}>
            <Text style={[styles.dirText, { color: trade.direction === 'CALL' ? colors.success : colors.error }]}>
              {trade.direction}
            </Text>
          </View>
        </View>
        {trade.exit_reason && (
          <Text style={[styles.exitReason, { color: colors.tabBarInactive }]}>{trade.exit_reason}</Text>
        )}
      </View>
      <View style={styles.tradeRight}>
        <Text style={[styles.tradePnl, { color: pnlColor }]}>
          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
        </Text>
        {trade.pnl_pct != null && (
          <Text style={[styles.tradePnlPct, { color: pnlColor }]}>
            {trade.pnl_pct.toFixed(1)}%
          </Text>
        )}
        <Text style={[styles.tradeEntry, { color: colors.tabBarInactive }]}>
          ${trade.entry_premium?.toFixed(2)} → {trade.exit_premium ? `$${trade.exit_premium.toFixed(2)}` : '—'}
        </Text>
      </View>
    </View>
  );
};

const StatsPanel = ({ stats, label, colors, compact = false }: { stats: StrategyStats; label: string; colors: any; compact?: boolean }) => (
  <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }, compact && styles.statsCardCompact]}>
    <Text style={[styles.statsLabel, { color: colors.text }]}>{label.replace('_', ' ')}</Text>
    <View style={styles.statsGrid}>
      <StatItem label="Win Rate"    value={`${stats.win_rate_pct}%`}   color={stats.win_rate_pct >= 60 ? colors.success : colors.text} colors={colors} />
      <StatItem label="Total P&L"   value={`$${stats.total_pnl}`}       color={stats.total_pnl >= 0 ? colors.success : colors.error} colors={colors} />
      <StatItem label="Trades"      value={String(stats.total_trades)}  colors={colors} />
      <StatItem label="W/L"         value={`${stats.wins}/${stats.losses}`} colors={colors} />
      <StatItem label="Avg Winner"  value={`$${stats.avg_winner}`}      color={colors.success} colors={colors} />
      <StatItem label="Avg Loser"   value={`$${stats.avg_loser}`}       color={colors.error} colors={colors} />
    </View>
  </View>
);

const StatItem = ({ label, value, color, colors }: { label: string; value: string; color?: string; colors: any }) => (
  <View style={styles.statItem}>
    <Text style={[styles.statLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.statValue, { color: color ?? colors.text }]}>{value}</Text>
  </View>
);

// ── Debug log panel ──────────────────────────────────────────────────────────────

const DEBUG_FILTERS: ('ALL' | DebugLevel)[] = ['ALL', 'ERROR', 'WARN', 'SUCCESS', 'INFO', 'DEBUG'];

const formatLogTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

function DebugLogPanel({ colors }: { colors: any }) {
  const [levelFilter, setLevelFilter] = useState<'ALL' | DebugLevel>('ALL');
  const { data, isLoading } = useStrategyDebugLogs(true);

  const clearLogs = async () => {
    try {
      await fetch(`${RAILWAY_BASE_URL}/strategy/debug-logs/clear`, { method: 'POST' });
    } catch {
      /* best-effort */
    }
  };

  const logs = useMemo(() => {
    const all = data ?? [];
    const filtered = levelFilter === 'ALL' ? all : all.filter(l => l.level === levelFilter);
    return [...filtered].reverse(); // newest first
  }, [data, levelFilter]);

  return (
    <View style={{ flex: 1 }}>
      {/* Controls */}
      <View style={[styles.debugControls, { borderBottomColor: colors.border }]}>
        <View style={styles.debugToggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.debugToggleLabel, { color: colors.text }]}>Engine Debug Log</Text>
            <Text style={[styles.debugToggleHint, { color: colors.tabBarInactive }]}>
              Always on · persisted · live
            </Text>
          </View>
          <TouchableOpacity onPress={clearLogs} style={[styles.debugClearBtn, { borderColor: colors.border }]} hitSlop={8}>
            <Ionicons name="trash-outline" size={16} color={colors.error} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
          {DEBUG_FILTERS.map(lvl => {
            const active = levelFilter === lvl;
            const tint = lvl === 'ALL' ? colors.accent : DEBUG_COLORS[lvl];
            return (
              <TouchableOpacity
                key={lvl}
                onPress={() => setLevelFilter(lvl)}
                style={[styles.debugChip, { borderColor: active ? tint : colors.border, backgroundColor: active ? tint + '22' : 'transparent' }]}
              >
                <Text style={[styles.debugChipText, { color: active ? tint : colors.tabBarInactive }]}>
                  {lvl === 'ALL' ? 'All' : lvl}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.debugList} showsVerticalScrollIndicator={false}>
        {isLoading && !data ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : logs.length === 0 ? (
          <Text style={[styles.empty, { color: colors.tabBarInactive }]}>No debug events yet</Text>
        ) : (
          logs.map(log => <DebugRow key={`${log.strategy_id}-${log.id}`} log={log} colors={colors} />)
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const DebugRow = ({ log, colors }: { log: DebugLogEntry; colors: any }) => {
  const tint = DEBUG_COLORS[log.level] ?? colors.tabBarInactive;
  return (
    <View style={[styles.debugRow, { backgroundColor: colors.card, borderLeftColor: tint }]}>
      <View style={styles.debugRowHeader}>
        <Text style={[styles.debugLevel, { color: tint }]}>{log.level}</Text>
        {!!log.ticker && (
          <View style={[styles.debugTickerBadge, { backgroundColor: tint + '22' }]}>
            <Text style={[styles.debugTickerText, { color: tint }]}>{log.ticker}</Text>
          </View>
        )}
        <Text style={[styles.debugTime, { color: colors.tabBarInactive }]}>{formatLogTime(log.ts)}</Text>
      </View>
      <Text style={[styles.debugMsg, { color: colors.text }]} selectable>{log.message}</Text>
      {log.data && (
        <Text style={[styles.debugData, { color: colors.tabBarInactive }]} selectable>
          {JSON.stringify(log.data)}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container:      { flex: 1 },
  content:        { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title:          { fontSize: 20, fontWeight: '700' },
  tabToggleWrap:  { paddingHorizontal: 16, paddingVertical: 10 },
  tabToggle:      { flexDirection: 'row', borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  tabBtn:         { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabText:        { fontSize: 13, fontWeight: '600' },
  filterRow:      { marginBottom: 4 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  filterText: { fontSize: 13, fontWeight: '600' },
  empty:     { textAlign: 'center', marginTop: 40, fontSize: 14 },
  tradeRow:  { flexDirection: 'row', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, padding: 12 },
  tradeLeft: { flex: 1, gap: 3 },
  tradeDate: { fontSize: 11 },
  tradeTicker: { fontSize: 15, fontWeight: '700' },
  tradeBadges: { flexDirection: 'row', gap: 6 },
  dirBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  dirText:  { fontSize: 11, fontWeight: '700' },
  exitReason: { fontSize: 10 },
  tradeRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 2 },
  tradePnl:  { fontSize: 17, fontWeight: '700' },
  tradePnlPct: { fontSize: 12, fontWeight: '600' },
  tradeEntry: { fontSize: 10 },
  statsCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  statsCardCompact: { padding: 10 },
  statsLabel: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statItem:  { width: '30%' },
  statLabel: { fontSize: 10, marginBottom: 2 },
  statValue: { fontSize: 14, fontWeight: '700' },
  byProfileTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },

  // Debug tab
  debugControls:    { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  debugToggleRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  debugToggleLabel: { fontSize: 14, fontWeight: '700' },
  debugToggleHint:  { fontSize: 11, marginTop: 1 },
  debugClearBtn:    { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  debugChip:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, marginRight: 8 },
  debugChipText:    { fontSize: 12, fontWeight: '600' },
  debugList:        { paddingHorizontal: 16, paddingTop: 10, gap: 6 },
  debugRow:         { borderRadius: 8, borderLeftWidth: 3, padding: 10 },
  debugRowHeader:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  debugLevel:       { fontSize: 10, fontWeight: '800' },
  debugTickerBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  debugTickerText:  { fontSize: 10, fontWeight: '700' },
  debugTime:        { fontSize: 10, marginLeft: 'auto' },
  debugMsg:         { fontSize: 12, fontFamily: 'monospace' },
  debugData:        { fontSize: 10, fontFamily: 'monospace', marginTop: 4 },
});
