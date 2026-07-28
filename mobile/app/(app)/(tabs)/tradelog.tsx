import { useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useThemeColors } from '@/lib/useColorScheme';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { useStrategyTrades } from '@/hooks/queries/strategy/useStrategyTrades';
import { useStrategyPerformance } from '@/hooks/queries/strategy/useStrategyStats';
import { useStrategyDebugLogs } from '@/hooks/queries/strategy/useStrategyDebugLogs';
import {
  PnlSummaryCard, DayHeader, StatsHero, DailyPnlChart,
  KeyMetricsGrid, ExitQualityCard, ProfileLeaderboard, groupTradesByDay,
  filterTradesByRange, TIME_RANGES, type TimeRange,
} from '@/common/components/strategy/TradeAnalytics';
import { useStrategySessionState } from '@/hooks/queries/strategy/useStrategySessionState';
import { useAlpacaAccountsHistory } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useReconcileTrades } from '@/hooks/mutations/strategy/useReconcileTrades';
import { LiveModeToggle, type AccountMode } from '@/common/components/strategy/LiveModeToggle';
import type { ORBTrade, StrategyPerformance, RatingBreakdownItem, DebugLogEntry, DebugLevel, ExitStage } from '@/common/types/strategy';
import { formatContractSymbol, getTradeHorizon } from '@/lib/formatContract';
import { useToast } from '@/common/components/ui/Toast';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Tab = 'log' | 'stats' | 'debug';

const DEBUG_COLORS: Record<DebugLevel, string> = {
  ERROR:   '#EF4444',
  WARN:    '#F59E0B',
  INFO:    '#3B82F6',
  DEBUG:   '#8B5CF6',
  SUCCESS: '#22C55E',
};

const PROFILE_EMOJI: Record<string, string> = {
  BULL_DOG:       '🐂',
  THUNDER_CAT:    '🐱',
  WOLF:           '🐺',
  TREND_RIDER:    '🚀',
  RETESTER:       '🎯',
  REVERSAL:       '🔄',
  SCALPER:        '⚡',
  PRECISION:      '🎯',
  MOMENTUM:       '📈',
  CONVICTION:     '💎',
  ALL_IN:         '🔥',
  OTM_RUNNER:     '🏃',
  OTM_CONVICTION: '🎯',
  MANUAL:         '🖐️',
};

interface Props {
  /** True when rendered as a SegmentedPager scene (ORB tab) — hides the back
   *  arrow and the redundant title (the segment pill above already names it). */
  embedded?: boolean;
}

export default function TradeLogScreen({ embedded = false }: Props) {
  const colors = useThemeColors();
  const toast = useToast();
  const [tab, setTab]               = useState<Tab>('log');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mode, setMode]             = useState<AccountMode>('live');
  const [range, setRange]           = useState<TimeRange>('TODAY');
  const [refreshing, setRefreshing] = useState(false);

  // Deep-link from a notification tap (see NotificationNavigationService) —
  // consume `paper_mode` exactly once, same pattern as orb.tsx's `section`.
  const { paper_mode: paperModeParam } = useLocalSearchParams<{ paper_mode?: string }>();
  useFocusEffect(
    useCallback(() => {
      if (paperModeParam != null) {
        setMode(paperModeParam === 'true' ? 'paper' : 'live');
        router.setParams({ paper_mode: undefined });
      }
    }, [paperModeParam]),
  );

  const wantPaper = mode === 'paper';

  // One deep fetch feeds both the log and every Stats-tab figure — stats are
  // computed client-side AFTER the paper/live split (see TradeAnalytics.tsx),
  // so the toggle changes the actual numbers, not just which rows render.
  const { data: trades,  isLoading: tradesLoading } = useStrategyTrades({ limit: 500 });
  const { data: performance }                       = useStrategyPerformance();
  const { data: sessionStates }                     = useStrategySessionState();
  const { data: acctHistory }                       = useAlpacaAccountsHistory();
  const reconcileTrades                             = useReconcileTrades();

  // Pull-to-refresh doesn't just refetch — it cross-references every still-
  // open trade against Alpaca's real position state first, so a position
  // closed directly on Alpaca (bypassing this app) gets its exit data filled
  // in instead of sitting "open" forever with no P/L. See
  // docs/incidents/2026-07-14-position-lost-on-restart.md.
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await reconcileTrades.mutateAsync();
      if (result.mismatches.length > 0) {
        toast.error(
          `${result.mismatches.length} trade(s) marked closed but still open at the broker — check manually`,
        );
      } else if (result.reconciled.length > 0) {
        toast.info(`Reconciled ${result.reconciled.length} trade(s) from Alpaca`);
      } else if (result.errors.length > 0) {
        toast.error(`${result.errors.length} trade(s) failed to reconcile`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reconcile failed');
    } finally {
      setRefreshing(false);
    }
  };

  // Trades don't carry which account they trace back to except via
  // `paper_mode` — split here so the toggle mirrors position.tsx/strategy.tsx.
  const modeTrades = useMemo(
    () => (trades ?? []).filter(t => !!t.paper_mode === wantPaper),
    [trades, wantPaper],
  );
  const modeCounts = useMemo(() => ({
    live:  (trades ?? []).filter(t => !t.paper_mode).length,
    paper: (trades ?? []).filter(t => !!t.paper_mode).length,
  }), [trades]);
  const modeAccountEquity = wantPaper ? acctHistory?.paper?.equity : acctHistory?.live?.equity;
  const rangeTrades = useMemo(() => filterTradesByRange(modeTrades, range), [modeTrades, range]);
  const dayGroups = useMemo(() => groupTradesByDay(rangeTrades), [rangeTrades]);

  const haltedEngines = useMemo(() => {
    if (!sessionStates) return [];
    return Object.values(sessionStates).filter(e => e.session_halted);
  }, [sessionStates]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>

      {/* Sticky header */}
      {!embedded && (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Trade Log & Stats</Text>
          <View style={{ width: 22 }} />
        </View>
      )}

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

      {/* Live/Paper account toggle — applies to both the log AND every Stats
          figure (stats are computed from the mode-filtered trades). */}
      {tab !== 'debug' && (
        <LiveModeToggle mode={mode} onChange={setMode} counts={modeCounts} colors={colors} />
      )}

      {/* Time range — applies to both the log AND every Stats figure, same as
          the account toggle above. Defaults to Today. */}
      {tab !== 'debug' && (
        <View style={styles.rangeRow}>
          {TIME_RANGES.map(r => {
            const active = range === r.value;
            return (
              <TouchableOpacity
                key={r.value}
                onPress={() => setRange(r.value)}
                style={[styles.rangeChip, {
                  backgroundColor: active ? colors.accent : 'transparent',
                }]}
              >
                <Text style={[styles.rangeChipText, { color: active ? colors.accentForeground : colors.text }]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Session halt banner */}
      {haltedEngines.length > 0 && (
        <View style={{ backgroundColor: '#7f1d1d', paddingHorizontal: 16, paddingVertical: 10,
                       flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="warning" size={16} color="#fca5a5" />
          <Text style={{ color: '#fca5a5', fontSize: 13, flex: 1 }}>
            Daily loss limit reached — {haltedEngines.map(e => e.ticker).join(', ')} engine(s) halted.
            Session P&amp;L: {haltedEngines.map(e => `${e.ticker} $${e.session_pnl.toFixed(0)}`).join(', ')}
          </Text>
        </View>
      )}

      {tab === 'debug' ? (
        <DebugLogPanel colors={colors} />
      ) : (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
      >

        {tab === 'log' ? (
          tradesLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : (
            <>
              {rangeTrades.length === 0 ? (
                <Text style={[styles.empty, { color: colors.tabBarInactive }]}>
                  No {mode} trades {range === 'TODAY' ? 'today' : range === 'ALL' ? 'yet' : 'in this range'}
                </Text>
              ) : (
                <>
                  {/* P&L story first: hero summary + equity curve */}
                  <PnlSummaryCard trades={rangeTrades} colors={colors} />

                  {/* Trades grouped by session day with a per-day net */}
                  {dayGroups.map(group => (
                    <View key={group.date} style={{ gap: 10 }}>
                      <DayHeader group={group} colors={colors} />
                      {group.trades.map(trade => (
                        <TradeRow
                          key={trade.id}
                          trade={trade}
                          colors={colors}
                          expanded={expandedId === trade.id}
                          onToggle={() => setExpandedId(id => id === trade.id ? null : trade.id)}
                          accountEquity={modeAccountEquity}
                          accountLabel={mode === 'live' ? 'Live' : 'Paper'}
                        />
                      ))}
                    </View>
                  ))}
                </>
              )}
            </>
          )
        ) : (
          tradesLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : rangeTrades.length === 0 ? (
            <Text style={[styles.empty, { color: colors.tabBarInactive }]}>
              No {mode} trades to analyze {range === 'TODAY' ? 'today' : range === 'ALL' ? 'yet' : 'in this range'}
            </Text>
          ) : (
            <>
              <StatsHero trades={rangeTrades} colors={colors} />
              <DailyPnlChart trades={rangeTrades} colors={colors} />
              <KeyMetricsGrid trades={rangeTrades} colors={colors} />
              <ExitQualityCard trades={rangeTrades} colors={colors} />
              <ProfileLeaderboard trades={rangeTrades} colors={colors} />
              {performance && <RatingCard performance={performance} colors={colors} />}
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
  MANUAL_EXIT:         'Manual Exit',
  REVERSAL_TIME_CUT:   'Reversal Bleed Stop (20m)',
  'RECONCILED FROM ALPACA':         'Exit Reason: Reconciled from Alpaca',
  'UNKNOWN — RECONCILED FROM ALPACA': 'Exit Reason: Unknown — pulled from Alpaca',
  EXPIRED_WORTHLESS: 'Expired Worthless',
  'RECONCILED — QTY ALREADY ZERO': 'Reconciled — Already Closed',
};

const fmtEt = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true,
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

// "2026-06-15" → "Jun 15"
const fmtTradeDate = (d: string): string => {
  const p = d?.split('-');
  if (!p || p.length !== 3) return d ?? '';
  const dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

  const isOpen = trade.exit_time == null;
  // Realized pnl/pnl_pct stay null for the whole life of an open trade —
  // fall back to the live, unrealized estimate so this section isn't just
  // dashes until the position actually closes.
  const displayPnl    = isOpen ? trade.live_pnl ?? null : trade.pnl;
  const displayPnlPct = isOpen ? trade.live_pnl_pct ?? null : trade.pnl_pct;
  const pnlColor = displayPnl == null
    ? undefined
    : displayPnl >= 0 ? colors.success : colors.error;

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
        label={isOpen ? 'Current Price (live)' : 'Exit Premium'}
        value={
          isOpen
            ? (trade.live_price != null ? `$${trade.live_price.toFixed(2)}` : '—')
            : (trade.exit_premium != null ? `$${trade.exit_premium.toFixed(2)}` : '—')
        }
        valueColor={
          isOpen
            ? (trade.live_price == null ? undefined : trade.live_price >= trade.entry_premium ? colors.success : colors.error)
            : (trade.exit_premium == null ? undefined : trade.exit_premium >= trade.entry_premium ? colors.success : colors.error)
        }
        colors={colors}
      />
      <DetailRow
        label="Underlying Exit"
        value={trade.underlying_price_exit != null ? `$${trade.underlying_price_exit.toFixed(2)}` : '—'}
        colors={colors}
      />
      <DetailRow
        label={isOpen ? 'P&L (live, unrealized)' : 'P&L'}
        value={displayPnl != null ? `${displayPnl >= 0 ? '+' : ''}$${displayPnl.toFixed(2)}` : '—'}
        valueColor={pnlColor}
        colors={colors}
      />
      <DetailRow
        label={isOpen ? 'P&L % (live)' : 'P&L %'}
        value={displayPnlPct != null ? `${displayPnlPct >= 0 ? '+' : ''}${displayPnlPct.toFixed(1)}%` : '—'}
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
      {trade.account_balance_before != null && trade.account_balance_after != null && (
        <DetailRow
          label="Account Balance"
          value={`$${trade.account_balance_before.toFixed(2)} → $${trade.account_balance_after.toFixed(2)}`}
          valueColor={pnlColor}
          colors={colors}
        />
      )}

      {/* Per-stage exit breakdown */}
      {trade.exit_stages && trade.exit_stages.length > 0 && (
        <>
          <Text style={[styles.detailSectionHeader, { color: colors.tabBarInactive, marginTop: 8 }]}>
            EXIT BREAKDOWN
          </Text>
          {trade.exit_stages.map((stage: ExitStage, i: number) => {
            const stageColor = stage.pnl >= 0 ? colors.success : colors.error;
            return (
              <View key={i} style={[styles.detailRow, {
                backgroundColor: colors.card, borderRadius: 6,
                marginBottom: 4, paddingHorizontal: 8, paddingVertical: 6,
              }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>
                    {EXIT_REASON_LABELS[stage.reason] ?? stage.reason}
                  </Text>
                  <Text style={{ color: colors.tabBarInactive, fontSize: 11, marginTop: 2 }}>
                    {stage.qty} contract{stage.qty !== 1 ? 's' : ''} @ ${stage.premium.toFixed(2)}
                    {'  ·  '}{fmtEt(stage.time)}
                  </Text>
                </View>
                <Text style={{ color: stageColor, fontWeight: '700', fontSize: 14 }}>
                  {stage.pnl >= 0 ? '+' : ''}${stage.pnl.toFixed(2)}
                </Text>
              </View>
            );
          })}
        </>
      )}

      {/* TP1 / TP2 summary rows (if exit_stages absent but columns populated) */}
      {(!trade.exit_stages || trade.exit_stages.length === 0) && trade.tp1_pnl != null && (
        <>
          <Text style={[styles.detailSectionHeader, { color: colors.tabBarInactive, marginTop: 8 }]}>
            EXIT BREAKDOWN
          </Text>
          {trade.tp1_pnl != null && (
            <DetailRow
              label="TP1"
              value={`${trade.tp1_qty ?? '?'} contracts @ $${trade.tp1_premium?.toFixed(2) ?? '?'}  →  ${trade.tp1_pnl >= 0 ? '+' : ''}$${trade.tp1_pnl.toFixed(2)}`}
              valueColor={trade.tp1_pnl >= 0 ? colors.success : colors.error}
              colors={colors}
            />
          )}
          {trade.tp2_pnl != null && (
            <DetailRow
              label="TP2"
              value={`${trade.tp2_qty ?? '?'} contracts @ $${trade.tp2_premium?.toFixed(2) ?? '?'}  →  ${trade.tp2_pnl >= 0 ? '+' : ''}$${trade.tp2_pnl.toFixed(2)}`}
              valueColor={trade.tp2_pnl >= 0 ? colors.success : colors.error}
              colors={colors}
            />
          )}
        </>
      )}
    </View>
  );
};

// ── TradeRow ──────────────────────────────────────────────────────────────────

const TradeRow = ({
  trade, colors, expanded, onToggle, accountEquity, accountLabel,
}: {
  trade: ORBTrade; colors: any; expanded: boolean; onToggle: () => void;
  /** Current equity of the account this trade belongs to (paper or live),
   *  so the card can show how this trade's realized P&L relates to the
   *  account's current total, not just the trade in isolation. */
  accountEquity?: number;
  accountLabel?: string;
}) => {
  const pnl          = trade.pnl ?? 0;
  const isOpen       = trade.exit_time == null;
  // Open trades have no realized pnl yet (only ever written at exit) — show
  // the live, unrealized estimate instead so a still-open swing/weekly hold
  // isn't just a bare "OPEN" with no number at all.
  const displayPnl    = isOpen ? trade.live_pnl ?? null : pnl;
  const displayPnlPct = isOpen ? trade.live_pnl_pct ?? null : trade.pnl_pct;
  const pnlColor     = displayPnl == null ? colors.accent
                     : displayPnl > 0 ? colors.success
                     : displayPnl < 0 ? colors.error : colors.tabBarInactive;
  const accentColor  = isOpen ? colors.accent
                     : pnl > 0 ? colors.success
                     : pnl < 0 ? colors.error : colors.border;
  const profileEmoji = PROFILE_EMOJI[trade.profile] ?? '📊';
  const isLive       = trade.paper_mode === false;
  const isImmediate  = trade.trade_type === 'IMMEDIATE';
  // Classified from the trade's own entry date, not today — otherwise a
  // closed trade whose expiry is now in the past would always read as 0DTE.
  const isSwing      = getTradeHorizon(trade.contract_symbol, trade.trade_date) === 'SWING';
  const isCall       = trade.direction === 'CALL';
  const dirColor     = isCall ? colors.success : colors.error;

  const exitLabel = trade.exit_reason
    ? (EXIT_REASON_LABELS[trade.exit_reason] ?? trade.exit_reason)
    : isOpen ? 'Open' : null;

  const handlePress = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      style={[styles.tradeRow, {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderLeftColor: accentColor,
        borderLeftWidth: 3,
      }]}
    >
      <View style={styles.tradeRowMain}>
        {/* Identity */}
        <View style={styles.tradeLeft}>
          <View style={styles.tradeTitleRow}>
            <Text style={[styles.tradeTicker, { color: colors.text }]}>
              {profileEmoji} {trade.ticker}
            </Text>
            <View style={[styles.dirPill, { backgroundColor: dirColor + '1A' }]}>
              <Ionicons name={isCall ? 'trending-up' : 'trending-down'} size={10} color={dirColor} />
              <Text style={[styles.dirPillText, { color: dirColor }]}>{trade.direction}</Text>
            </View>
            {isLive && (
              <View style={[styles.tag, { backgroundColor: colors.error + '1A' }]}>
                <Text style={[styles.tagText, { color: colors.error }]}>LIVE</Text>
              </View>
            )}
            {isImmediate && (
              <View style={[styles.tag, { backgroundColor: colors.accent + '1A' }]}>
                <Text style={[styles.tagText, { color: colors.accent }]}>IMMED</Text>
              </View>
            )}
            {isSwing && (
              <View style={[styles.tag, { backgroundColor: '#6366F11A' }]}>
                <Text style={[styles.tagText, { color: '#6366F1' }]}>SWING</Text>
              </View>
            )}
          </View>

          <Text style={[styles.tradeContract, { color: colors.text }]} numberOfLines={1}>
            {formatContractSymbol(trade.contract_symbol)}
          </Text>

          <Text style={[styles.tradeMeta, { color: colors.tabBarInactive }]} numberOfLines={1}>
            {fmtTradeDate(trade.trade_date)}
            {'  ·  '}
            ${trade.entry_premium?.toFixed(2) ?? '—'} → {trade.exit_premium != null ? `$${trade.exit_premium.toFixed(2)}` : '—'}
            {exitLabel ? `  ·  ${exitLabel}` : ''}
          </Text>

          {/* Real account-level impact of this trade, snapshotted at entry and
              exit — e.g. "$300.12 → $240.12  ·  -$60.00 account swing". Only
              present for trades logged after this tracking was added; older
              trades fall back to the current-balance approximation below. */}
          {!isOpen && trade.account_balance_change != null ? (
            <Text style={[styles.tradeAcctRef, { color: colors.tabBarInactive }]} numberOfLines={1}>
              {trade.account_balance_before != null && trade.account_balance_after != null
                ? `$${trade.account_balance_before.toFixed(2)} → $${trade.account_balance_after.toFixed(2)}  ·  `
                : ''}
              {trade.account_balance_change >= 0 ? '+' : '-'}${Math.abs(trade.account_balance_change).toFixed(2)} account swing
            </Text>
          ) : !isOpen && accountEquity != null && (
            <Text style={[styles.tradeAcctRef, { color: colors.tabBarInactive }]} numberOfLines={1}>
              {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)} of ${accountEquity.toFixed(2)} {accountLabel} balance
            </Text>
          )}
        </View>

        {/* P&L */}
        <View style={styles.tradeRight}>
          <Text style={[styles.tradePnl, { color: pnlColor }]}>
            {displayPnl == null
              ? (isOpen ? 'OPEN' : `${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`)
              : `${displayPnl > 0 ? '+' : ''}$${displayPnl.toFixed(2)}`}
          </Text>
          {isOpen && displayPnl != null && (
            <Text style={{ fontSize: 9, fontWeight: '700', letterSpacing: 0.4, color: colors.accent, marginTop: 1 }}>
              OPEN · LIVE
            </Text>
          )}
          {displayPnlPct != null && (
            <View style={[styles.pnlPctPill, { backgroundColor: pnlColor + '1A' }]}>
              <Text style={[styles.tradePnlPct, { color: pnlColor }]}>
                {displayPnlPct > 0 ? '+' : ''}{displayPnlPct.toFixed(1)}%
              </Text>
            </View>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.tabBarInactive}
            style={{ marginTop: 6 }}
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

// ── Debug log panel ──────────────────────────────────────────────────────────────

const DEBUG_FILTERS: ('ALL' | DebugLevel)[] = ['ALL', 'ERROR', 'WARN', 'SUCCESS', 'INFO', 'DEBUG'];

const formatLogTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
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
  rangeRow:       { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  rangeChip:      { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 8 },
  rangeChipText:  { fontSize: 12, fontWeight: '600' },
  empty:     { textAlign: 'center', marginTop: 40, fontSize: 14 },
  tradeRow:     { borderRadius: 12, borderWidth: 1, padding: 13, paddingLeft: 13 },
  tradeRowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  tradeLeft: { flex: 1, gap: 5 },
  tradeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tradeTicker:   { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  dirPill:   { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  dirPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  tag:      { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  tagText:  { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  tradeContract: { fontSize: 12, fontWeight: '600' },
  tradeMeta: { fontSize: 11 },
  tradeAcctRef: { fontSize: 10.5, marginTop: 1, fontStyle: 'italic' },
  tradeRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  tradePnl:  { fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  pnlPctPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  tradePnlPct: { fontSize: 11, fontWeight: '700' },

  // Trade detail expansion
  detailSection:       { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 5 },
  detailSectionHeader: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  detailRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  detailLabel: { fontSize: 11, fontWeight: '600', flex: 1 },
  detailValue: { fontSize: 11, flex: 2, textAlign: 'right' },
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
