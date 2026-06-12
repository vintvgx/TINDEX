import { useMemo, useState } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, StyleSheet, ActivityIndicator, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { useStrategyTrades } from '@/hooks/queries/strategy/useStrategyTrades';
import { useStrategyStats, useStrategyStatsByProfile, useStrategyPerformance } from '@/hooks/queries/strategy/useStrategyStats';
import { useStrategyDebugLogs } from '@/hooks/queries/strategy/useStrategyDebugLogs';
import type { ProfileKey, ORBTrade, StrategyStats, StrategyPerformance, RatingBreakdownItem, DebugLogEntry, DebugLevel } from '@/common/types/strategy';
import { formatContractSymbol } from '@/lib/formatContract';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  const [filter, setFilter]     = useState<Filter>('ALL');
  const [tab, setTab]           = useState<Tab>('log');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: trades, isLoading: tradesLoading } = useStrategyTrades({
    profile: filter,
    limit: 50,
  });
  const { data: stats,       isLoading: statsLoading }  = useStrategyStats(filter);
  const { data: byProfile }                             = useStrategyStatsByProfile();
  const { data: performance }                           = useStrategyPerformance();

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
              <Text style={[styles.tabText, { color: tab === t ? colors.accentForeground : colors.tabBarInactive }]}>
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
                <TradeRow
                  key={trade.id}
                  trade={trade}
                  colors={colors}
                  expanded={expandedId === trade.id}
                  onToggle={() => setExpandedId(id => id === trade.id ? null : trade.id)}
                />
              ))}
            </>
          )
        ) : (
          statsLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : (
            <>
              {performance && <RatingCard performance={performance} colors={colors} />}
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

// ── Trade detail helpers ──────────────────────────────────────────────────────

const EXIT_REASON_LABELS: Record<string, string> = {
  HARD_STOP:         'Hard Stop',
  TP1:               'TP1 Hit — Partial Close',
  TP2:               'TP2 Hit — Partial Close',
  TP2_FULL_CLOSE:    'TP2 Hit — Full Close',
  RUNNER_TRAIL_STOP: 'Runner Trailing Stop',
  EOD_CLOSE:         'EOD Close',
  EOD_HARD_CLOSE:    'EOD Hard Close',
  BREAKEVEN_STOP:    'Breakeven Stop',
  CONSOLIDATION:     'Consolidation Exit',
  LOW_VOLUME_EXIT:   'Low Volume Exit',
  MANUAL_CLOSE:      'Manually Closed',
  FORCE_CLOSE:       'Force Closed',
  MANUAL_EXIT:       'Manual Exit',
};

const fmtEt = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }) + ' ET';
  } catch { return iso; }
};

const fmtDuration = (entry: string, exit: string | null): string => {
  if (!exit) return 'Still open';
  const ms  = new Date(exit).getTime() - new Date(entry).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
};

// ── TradeDetail ───────────────────────────────────────────────────────────────

const DetailRow = ({ label, value, colors, valueColor, mono }: {
  label: string; value: string; colors: any; valueColor?: string; mono?: boolean;
}) => (
  <View style={styles.detailRow}>
    <Text style={[styles.detailLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text
      style={[styles.detailValue, { color: valueColor ?? colors.text },
              mono && { fontFamily: 'monospace' }]}
      selectable
    >
      {value}
    </Text>
  </View>
);

const TradeDetail = ({ trade, colors }: { trade: ORBTrade; colors: any }) => {
  const orbRef  = trade.direction === 'CALL' ? trade.orh : trade.orl;
  const dirWord = trade.direction === 'CALL' ? 'above ORH' : 'below ORL';
  const exitLabel = trade.exit_reason
    ? (EXIT_REASON_LABELS[trade.exit_reason] ?? trade.exit_reason)
    : 'Open — position not yet closed';
  const duration = fmtDuration(trade.entry_time, trade.exit_time);

  // Entry stop-loss price is entry_premium × (1 − ~35%). We don't store max_loss_pct
  // per trade, but we can show a note if the exit was HARD_STOP.
  const stopHit = trade.exit_reason === 'HARD_STOP';

  const pnlColor = trade.pnl == null
    ? undefined
    : trade.pnl >= 0 ? colors.success : colors.error;

  return (
    <View style={[styles.detailSection, { borderTopColor: colors.border }]}>
      {/* Entry signal */}
      <Text style={[styles.detailSectionHeader, { color: colors.tabBarInactive }]}>ENTRY SIGNAL</Text>
      <DetailRow
        label={`${trade.direction} Breakout`}
        value={`Price closed ${dirWord} $${orbRef?.toFixed(2) ?? '—'}`}
        colors={colors}
      />
      <DetailRow
        label="Flow Confirmed"
        value={trade.flow_confirmed ? '✓ Yes' : '✗ No'}
        valueColor={trade.flow_confirmed ? colors.success : colors.error}
        colors={colors}
      />
      <DetailRow label="ORH"              value={`$${trade.orh?.toFixed(2) ?? '—'}`}                       colors={colors} />
      <DetailRow label="ORL"              value={`$${trade.orl?.toFixed(2) ?? '—'}`}                       colors={colors} />
      <DetailRow label="Underlying Entry" value={trade.underlying_price_entry != null ? `$${trade.underlying_price_entry.toFixed(2)}` : '—'} colors={colors} />
      {trade.vix_at_entry != null && (
        <DetailRow label="VIX" value={trade.vix_at_entry.toFixed(2)} colors={colors} />
      )}

      {/* Contract */}
      <Text style={[styles.detailSectionHeader, { color: colors.tabBarInactive, marginTop: 8 }]}>CONTRACT</Text>
      <DetailRow label="Contract" value={formatContractSymbol(trade.contract_symbol)} colors={colors} />
      <DetailRow label="Symbol"   value={trade.contract_symbol} colors={colors} mono />
      <DetailRow label="Strike" value={`$${trade.strike?.toFixed(2) ?? '—'}`} colors={colors} />
      <DetailRow label="Expiry" value={trade.expiry ?? '—'} colors={colors} />

      {/* Timing & P&L */}
      <Text style={[styles.detailSectionHeader, { color: colors.tabBarInactive, marginTop: 8 }]}>TRADE HISTORY</Text>
      <DetailRow label="Entered"           value={fmtEt(trade.entry_time)}                                  colors={colors} />
      <DetailRow label="Exited"            value={trade.exit_time ? fmtEt(trade.exit_time) : '—'}           colors={colors} />
      <DetailRow label="Duration"          value={duration}                                                  colors={colors} />
      <DetailRow label="Entry Premium"     value={`$${trade.entry_premium?.toFixed(2) ?? '—'}`}             colors={colors} />
      <DetailRow
        label="Exit Premium"
        value={trade.exit_premium != null ? `$${trade.exit_premium.toFixed(2)}` : '—'}
        valueColor={
          trade.exit_premium == null ? undefined
          : trade.exit_premium >= trade.entry_premium ? colors.success : colors.error
        }
        colors={colors}
      />
      <DetailRow
        label="Underlying Exit"
        value={trade.underlying_price_exit != null ? `$${trade.underlying_price_exit.toFixed(2)}` : '—'}
        colors={colors}
      />
      <DetailRow
        label="P&L"
        value={trade.pnl != null ? `${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}` : '—'}
        valueColor={pnlColor}
        colors={colors}
      />
      <DetailRow
        label="P&L %"
        value={trade.pnl_pct != null ? `${trade.pnl_pct >= 0 ? '+' : ''}${trade.pnl_pct.toFixed(1)}%` : '—'}
        valueColor={pnlColor}
        colors={colors}
      />
      <DetailRow
        label="Exit Reason"
        value={exitLabel}
        valueColor={stopHit ? colors.error : undefined}
        colors={colors}
      />
      <DetailRow label="Qty"
        value={`${trade.qty_entered} entered · ${trade.qty_exited} exited`}
        colors={colors}
      />
    </View>
  );
};

// ── TradeRow ──────────────────────────────────────────────────────────────────

const TradeRow = ({
  trade, colors, expanded, onToggle,
}: {
  trade: ORBTrade; colors: any; expanded: boolean; onToggle: () => void;
}) => {
  const pnl          = trade.pnl ?? 0;
  const pnlColor     = pnl > 0 ? colors.success : pnl < 0 ? colors.error : colors.tabBarInactive;
  const profileEmoji = trade.profile === 'BULL_DOG' ? '🐂'
    : trade.profile === 'WOLF'        ? '🐺'
    : trade.profile === 'TREND_RIDER' ? '🚀'
    : trade.profile === 'RETESTER'    ? '🎯'
    : '🐱';

  const handlePress = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      style={[styles.tradeRow, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.tradeRowMain}>
        <View style={styles.tradeLeft}>
          <Text style={[styles.tradeDate, { color: colors.tabBarInactive }]}>{trade.trade_date}</Text>
          <Text style={[styles.tradeTicker, { color: colors.text }]}>
            {profileEmoji} {trade.ticker}
          </Text>
          <Text style={[styles.tradeContract, { color: colors.tabBarInactive }]}>
            {formatContractSymbol(trade.contract_symbol)}
          </Text>
          <View style={styles.tradeBadges}>
            <View style={[styles.dirBadge, {
              backgroundColor: trade.direction === 'CALL' ? colors.success + '22' : colors.error + '22',
            }]}>
              <Text style={[styles.dirText, {
                color: trade.direction === 'CALL' ? colors.success : colors.error,
              }]}>
                {trade.direction}
              </Text>
            </View>
          </View>
          {trade.exit_reason && !expanded && (
            <Text style={[styles.exitReason, { color: colors.tabBarInactive }]}>
              {EXIT_REASON_LABELS[trade.exit_reason] ?? trade.exit_reason}
            </Text>
          )}
        </View>
        <View style={styles.tradeRight}>
          <Text style={[styles.tradePnl, { color: pnlColor }]}>
            {pnl > 0 ? '+' : ''}${pnl.toFixed(2)}
          </Text>
          {trade.pnl_pct != null && (
            <Text style={[styles.tradePnlPct, { color: pnlColor }]}>
              {trade.pnl_pct > 0 ? '+' : ''}{trade.pnl_pct.toFixed(1)}%
            </Text>
          )}
          <Text style={[styles.tradeEntry, { color: colors.tabBarInactive }]}>
            ${trade.entry_premium?.toFixed(2)} → {trade.exit_premium != null ? `$${trade.exit_premium.toFixed(2)}` : '—'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.tabBarInactive}
            style={{ marginTop: 4 }}
          />
        </View>
      </View>

      {expanded && <TradeDetail trade={trade} colors={colors} />}
    </TouchableOpacity>
  );
};

// ── RatingCard ─────────────────────────────────────────────────────────────────

const GRADE_COLOR = (grade: string, colors: any): string => {
  if (grade === 'A') return colors.success;
  if (grade === 'B') return '#3B82F6';
  if (grade === 'C') return '#F59E0B';
  if (grade === 'D' || grade === 'F') return colors.error;
  return colors.tabBarInactive;
};

const BreakdownBar = ({ item, colors }: { item: RatingBreakdownItem; colors: any }) => {
  const pct = item.max > 0 ? item.score / item.max : 0;
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, { color: colors.tabBarInactive }]}>{item.label}</Text>
      <View style={[styles.breakdownTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.breakdownFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: colors.accent }]} />
      </View>
      <Text style={[styles.breakdownScore, { color: colors.text }]}>
        {item.score}/{item.max}
      </Text>
    </View>
  );
};

function RatingCard({ performance, colors }: { performance: StrategyPerformance; colors: any }) {
  const overall = performance.overall;
  const gradeColor = GRADE_COLOR(overall.grade, colors);

  return (
    <View style={[styles.ratingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header row */}
      <View style={styles.ratingHeader}>
        <View>
          <Text style={[styles.ratingTitle, { color: colors.text }]}>System Rating</Text>
          <Text style={[styles.ratingSubtitle, { color: colors.tabBarInactive }]}>
            {overall.total_trades} trade{overall.total_trades !== 1 ? 's' : ''} · {overall.label}
          </Text>
        </View>
        <View style={[styles.ratingScoreBadge, { borderColor: gradeColor }]}>
          <Text style={[styles.ratingScore, { color: gradeColor }]}>{overall.score}</Text>
          <Text style={[styles.ratingGrade, { color: gradeColor }]}>{overall.grade}</Text>
        </View>
      </View>

      {/* Score breakdown bars */}
      <View style={styles.breakdownList}>
        {Object.values(overall.breakdown).map((item) => (
          <BreakdownBar key={item.label} item={item} colors={colors} />
        ))}
      </View>

      {/* Key metrics row */}
      <View style={[styles.ratingMetrics, { borderTopColor: colors.border }]}>
        <View style={styles.ratingMetricItem}>
          <Text style={[styles.ratingMetricVal, { color: overall.win_rate_pct >= 55 ? colors.success : colors.error }]}>
            {overall.win_rate_pct}%
          </Text>
          <Text style={[styles.ratingMetricLabel, { color: colors.tabBarInactive }]}>Win Rate</Text>
        </View>
        <View style={styles.ratingMetricItem}>
          <Text style={[styles.ratingMetricVal, { color: overall.profit_factor >= 1.5 ? colors.success : colors.error }]}>
            {overall.profit_factor}x
          </Text>
          <Text style={[styles.ratingMetricLabel, { color: colors.tabBarInactive }]}>Prof. Factor</Text>
        </View>
        <View style={styles.ratingMetricItem}>
          <Text style={[styles.ratingMetricVal, { color: overall.total_pnl >= 0 ? colors.success : colors.error }]}>
            {overall.total_pnl >= 0 ? '+' : ''}${overall.total_pnl}
          </Text>
          <Text style={[styles.ratingMetricLabel, { color: colors.tabBarInactive }]}>Total P&L</Text>
        </View>
      </View>

      {/* Per-strategy ratings */}
      {performance.by_strategy.length > 0 && (
        <>
          <Text style={[styles.byProfileTitle, { color: colors.tabBarInactive, marginTop: 12 }]}>
            STRATEGY RATINGS
          </Text>
          {performance.by_strategy.map((s) => (
            <View key={s.strategy_id} style={[styles.stratRatingRow, { borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stratRatingName, { color: colors.text }]} numberOfLines={1}>
                  {s.strategy_name || s.ticker}
                </Text>
                <Text style={[styles.stratRatingMeta, { color: colors.tabBarInactive }]}>
                  {s.ticker} · {s.total_trades} trades · {s.win_rate_pct}% WR
                </Text>
              </View>
              <View style={[styles.stratRatingBadge, { borderColor: GRADE_COLOR(s.grade, colors) }]}>
                <Text style={[styles.stratRatingScore, { color: GRADE_COLOR(s.grade, colors) }]}>{s.score}</Text>
                <Text style={[styles.stratRatingGrade, { color: GRADE_COLOR(s.grade, colors) }]}>{s.grade}</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

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
          logs.map(log => <DebugRow key={String(log.id)} log={log} colors={colors} />)
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
  tradeRow:     { borderRadius: 12, borderWidth: 1, padding: 12 },
  tradeRowMain: { flexDirection: 'row', justifyContent: 'space-between' },
  tradeLeft: { flex: 1, gap: 3 },
  tradeDate:     { fontSize: 11 },
  tradeTicker:   { fontSize: 15, fontWeight: '700' },
  tradeContract: { fontSize: 11, marginTop: 1 },
  tradeBadges: { flexDirection: 'row', gap: 6 },
  dirBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  dirText:  { fontSize: 11, fontWeight: '700' },
  exitReason: { fontSize: 10 },
  tradeRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 2 },
  tradePnl:  { fontSize: 17, fontWeight: '700' },
  tradePnlPct: { fontSize: 12, fontWeight: '600' },
  tradeEntry: { fontSize: 10 },

  // Trade detail expansion
  detailSection:       { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 5 },
  detailSectionHeader: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  detailRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  detailLabel: { fontSize: 11, fontWeight: '600', flex: 1 },
  detailValue: { fontSize: 11, flex: 2, textAlign: 'right' },
  statsCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  statsCardCompact: { padding: 10 },
  statsLabel: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statItem:  { width: '30%' },
  statLabel: { fontSize: 10, marginBottom: 2 },
  statValue: { fontSize: 14, fontWeight: '700' },
  byProfileTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },

  // Rating card
  ratingCard:         { borderRadius: 14, borderWidth: 1, padding: 16 },
  ratingHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  ratingTitle:        { fontSize: 15, fontWeight: '700' },
  ratingSubtitle:     { fontSize: 11, marginTop: 2 },
  ratingScoreBadge:   { width: 60, height: 60, borderRadius: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  ratingScore:        { fontSize: 20, fontWeight: '800', lineHeight: 22 },
  ratingGrade:        { fontSize: 11, fontWeight: '700' },
  breakdownList:      { gap: 8 },
  breakdownRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLabel:     { fontSize: 11, width: 110 },
  breakdownTrack:     { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  breakdownFill:      { height: '100%', borderRadius: 3 },
  breakdownScore:     { fontSize: 11, fontWeight: '600', width: 34, textAlign: 'right' },
  ratingMetrics:      { flexDirection: 'row', justifyContent: 'space-around', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  ratingMetricItem:   { alignItems: 'center' },
  ratingMetricVal:    { fontSize: 15, fontWeight: '700' },
  ratingMetricLabel:  { fontSize: 10, marginTop: 2 },
  stratRatingRow:     { flexDirection: 'row', alignItems: 'center', paddingTop: 10, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  stratRatingName:    { fontSize: 13, fontWeight: '600' },
  stratRatingMeta:    { fontSize: 10, marginTop: 2 },
  stratRatingBadge:   { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stratRatingScore:   { fontSize: 14, fontWeight: '800', lineHeight: 16 },
  stratRatingGrade:   { fontSize: 10, fontWeight: '700' },

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
