import React, { useState } from 'react';
import {
  View, Text, ScrollView, SafeAreaView,
  ActivityIndicator, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useStrategyPositions } from '@/hooks/queries/strategy/useStrategyPosition';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { LivePositionPanel } from '@/common/components/strategy/LivePositionPanel';
import { ExitTradeModal } from '@/common/components/strategy/ExitTradeModal';
import { AddContractModal } from '@/common/components/strategy/AddContractModal';
import type { FibLevels, ImmediatePosition } from '@/common/types/strategy';
import { TRADE_HORIZON_RANK, getTradeHorizon } from '@/lib/formatContract';

/**
 * /strategy/immediate-positions now returns the same shape /strategy/positions
 * does (active, hard_stop, tp1, tp2, qty_total, fib_levels, ...) — see that
 * route's docstring — but the ImmediatePosition TS type still only declares
 * the older, narrower field set the "Immediate Trades" dashboard card reads
 * (pnl/pnl_pct/mid_price). This reads the extra fields off the same runtime
 * object rather than widening ImmediatePosition, so dashboard.tsx's usage is
 * untouched.
 */
function toPositionEntry(pos: ImmediatePosition): PositionEntry {
  const full = pos as ImmediatePosition & Partial<PositionEntry>;
  return {
    strategy_id:        pos.strategy_id,
    strategy_name:       full.strategy_name ?? '',
    active:              full.active ?? true,
    paper_mode:          pos.paper_mode,
    ticker:              pos.ticker,
    profile:             pos.profile,
    direction:           pos.direction,
    contract:            pos.contract,
    qty_remaining:       pos.qty_remaining,
    qty_total:           full.qty_total,
    entry_premium:       pos.entry_premium ?? undefined,
    current_price:       full.current_price ?? pos.mid_price ?? undefined,
    unrealized_pnl:      full.unrealized_pnl ?? pos.pnl ?? undefined,
    unrealized_pnl_pct:  full.unrealized_pnl_pct ?? pos.pnl_pct ?? undefined,
    hard_stop:           full.hard_stop,
    tp1:                 full.tp1,
    tp2:                 full.tp2,
    tp1_hit:             pos.tp1_hit,
    tp2_hit:             pos.tp2_hit,
    be_stop_active:      full.be_stop_active,
    runner_trail:        full.runner_trail,
    fib_levels:          full.fib_levels,
  };
}

const MOCK_POSITIONS: PositionEntry[] = [
  {
    strategy_id:    'mock-1',
    strategy_name:  'IWM Bull Dog M/W/F',
    active:         true,
    paper_mode:     true,
    ticker:         'IWM',
    profile:        'BULL_DOG',
    direction:      'CALL',
    contract:       'IWM250107C00215000',
    qty_remaining:  2,
    qty_total:      3,
    entry_premium:  1.45,
    current_price:  2.18,
    unrealized_pnl: 146.00,
    unrealized_pnl_pct: 50.3,
    hard_stop:      0.94,
    tp1:            2.175,
    tp2:            2.90,
    tp1_hit:        true,
    tp2_hit:        false,
    be_stop_active: true,
    runner_trail:   1.90,
    fib_levels: {
      'up_1.0': 215.50, 'up_1.618': 216.32, 'up_2.618': 217.80,
      'dn_1.0': 213.50, 'dn_1.618': 212.68, 'dn_2.618': 211.20,
      mid: 214.50, orh: 215.00, orl: 214.00,
    } as FibLevels,
  },
];

interface Props {
  /**
   * True when rendered as a SegmentedPager scene (Home/Accounts tabs) instead
   * of a standalone pushed route — hides the back arrow (there's nothing to
   * pop back to within a pager page) and the redundant title (the segment
   * pill above already names this page).
   */
  embedded?: boolean;
}

export default function PositionScreen({ embedded = false }: Props) {
  const colors = useThemeColors();
  const [showMock, setShowMock] = useState(false);
  const [mode, setMode] = useState<'live' | 'paper'>('live');

  const { data: stratPositions = [], isLoading: stratLoading } = useStrategyPositions();
  // Ad-hoc immediate trades (not tied to a saved strategy) — merged in so Live
  // Positions shows every open trade, not just saved-strategy ones. Before this,
  // an immediate trade was visible on Dashboard but invisible here, which meant
  // it couldn't be edited (SL/TP) or exited from this screen at all.
  const { data: immPositions = [], isLoading: immLoading } = useImmediatePositions();
  const isLoading = stratLoading || immLoading;
  const livePositions = [...stratPositions, ...immPositions.map(toPositionEntry)];
  // Both accounts, each built from its own dedicated paper/live TradingClient
  // (unlike /strategy/account, which resolved to "whichever saved strategy
  // engine happens to be first" — unrelated to which account an active trade
  // was actually in, and the reason the balance shown here could silently be
  // the wrong account's the whole session). Picking by `mode` below means
  // this always matches what's actually being viewed.
  const { data: accounts } = useAlpacaBothAccounts();
  const account = accounts ? (mode === 'live' ? accounts.live : accounts.paper) : undefined;

  const positions         = showMock ? MOCK_POSITIONS : livePositions;
  const activePositions   = positions.filter(p => p.active);
  // 0DTE/weekly positions need more immediate attention than a swing trade's,
  // so they always list first — sort is stable, so relative order within the
  // same horizon (e.g. saved-strategy vs immediate) is otherwise unchanged.
  const filteredPositions = activePositions
    .filter(p => (mode === 'live' ? !p.paper_mode : !!p.paper_mode))
    .sort((a, b) =>
      TRADE_HORIZON_RANK[getTradeHorizon(a.contract ?? '')] -
      TRADE_HORIZON_RANK[getTradeHorizon(b.contract ?? '')],
    );
  const activeCount = filteredPositions.length;

  const toggleMode = () => setMode(m => (m === 'live' ? 'paper' : 'live'));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>

      {/* ── Sticky header ── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {embedded ? (
          <View style={styles.headerSide} />
        ) : (
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerSide}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
        )}

        <View style={styles.headerCenter}>
          {!embedded && <Text style={[styles.title, { color: colors.text }]}>Live Positions</Text>}
          {activeCount > 0 && (
            <View style={[styles.activeBadge, { backgroundColor: colors.success + '22' }]}>
              <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.activeBadgeText, { color: colors.success }]}>
                {activeCount} active
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          onPress={() => setShowMock(v => !v)}
          hitSlop={12}
          style={[styles.headerSide, styles.headerSideRight,
            showMock && { backgroundColor: colors.accent + '22', borderRadius: 8 },
          ]}
        >
          <Ionicons
            name={showMock ? 'flask' : 'flask-outline'}
            size={20}
            color={showMock ? colors.accent : colors.tabBarInactive}
          />
        </TouchableOpacity>
      </View>

      {/* ── Account bar (sticky) — tap to toggle Live/Paper ── */}
      {account?.available && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={toggleMode}
          style={[styles.accountBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
        >
          <AccountStat
            label={mode === 'live' ? 'Live Equity' : 'Paper Equity'}
            value={`$${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            color={mode === 'live' ? '#30D158' : '#FF9F0A'}
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat
            label="Today P&L"
            value={`${account.pnl_today >= 0 ? '+' : ''}$${account.pnl_today.toFixed(2)}`}
            color={account.pnl_today >= 0 ? colors.success : colors.error}
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat
            label="Day Trades"
            value={String(account.day_trade_count)}
            colors={colors}
          />
          <Ionicons name="swap-horizontal" size={16} color={colors.tabBarInactive} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      )}

      {/* ── LIVE / PAPER toggle ── */}
      <View style={[styles.modeToggleRow, { borderBottomColor: colors.border }]}>
        {(['live', 'paper'] as const).map((m) => {
          const isActive = mode === m;
          const accentClr = m === 'live' ? '#30D158' : '#FF9F0A';
          return (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              style={[
                styles.modeBtn,
                isActive && { backgroundColor: accentClr + '22', borderColor: accentClr + '66' },
                !isActive && { borderColor: colors.border },
              ]}
            >
              {m === 'live' && (
                <View style={[styles.modeDot, { backgroundColor: isActive ? '#30D158' : colors.textTertiary }]} />
              )}
              <Text style={[styles.modeBtnText, { color: isActive ? accentClr : colors.textTertiary }]}>
                {m === 'live' ? 'LIVE' : 'PAPER'}
              </Text>
              {activePositions.filter(p => m === 'live' ? !p.paper_mode : !!p.paper_mode).length > 0 && (
                <View style={[styles.modeBadge, { backgroundColor: isActive ? accentClr : colors.border }]}>
                  <Text style={[styles.modeBadgeText, { color: isActive ? '#fff' : colors.textSecondary }]}>
                    {activePositions.filter(p => m === 'live' ? !p.paper_mode : !!p.paper_mode).length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Mock banner ── */}
      {showMock && (
        <View style={[styles.mockBanner, { backgroundColor: colors.accent + '15', borderBottomColor: colors.accent + '44' }]}>
          <Ionicons name="flask" size={12} color={colors.accent} />
          <Text style={[styles.mockBannerText, { color: colors.accent }]}>Preview mode — mock data</Text>
        </View>
      )}

      {/* ── Scrollable content ── */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {isLoading && !showMock ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
        ) : activeCount === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="pulse-outline" size={52} color={colors.tabBarInactive} style={{ opacity: 0.4 }} />
            <Text style={[styles.emptyTitle, { color: colors.tabBarInactive }]}>
              No {mode === 'live' ? 'Live' : 'Paper'} Positions
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.tabBarInactive }]}>
              {mode === 'live'
                ? 'Active live positions will appear here in real time'
                : 'Active paper positions will appear here'}
            </Text>
            {mode === 'live' && (
              <TouchableOpacity
                onPress={() => setShowMock(true)}
                style={[styles.mockPreviewBtn, { borderColor: colors.accent + 'AA' }]}
                activeOpacity={0.7}
              >
                <Ionicons name="flask-outline" size={14} color={colors.accent} />
                <Text style={[styles.mockPreviewText, { color: colors.accent }]}>Preview with mock data</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          filteredPositions
            .map(pos => (
              <PositionRow key={pos.strategy_id} pos={pos} showMock={showMock} colors={colors} />
            ))
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── PositionRow ────────────────────────────────────────────────────────────────
// Owns the live-price WS subscription + exit-modal state for one position —
// same shape as strategy.tsx's StrategyCard/ImmediatePositionCard, so each
// row here needs its own component (hooks can't be called per-item inside
// a parent's .map()).

function PositionRow({ pos, showMock, colors }: { pos: PositionEntry; showMock: boolean; colors: any }) {
  const { data: live, connected } = useStrategyLivePrice(pos.strategy_id, pos.active && !showMock);
  const [exitOpen, setExitOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const accentColor = pos.direction === 'CALL' ? colors.success : colors.error;

  return (
    <View style={styles.positionBlock}>
      {/* Strategy label row */}
      <View style={styles.stratLabelRow}>
        <Text style={[styles.stratTicker, { color: colors.text }]}>{pos.ticker}</Text>
        {pos.strategy_name ? (
          <Text style={[styles.stratName, { color: colors.tabBarInactive }]}>{pos.strategy_name}</Text>
        ) : null}
        {pos.paper_mode && (
          <View style={[styles.paperBadge, { backgroundColor: '#FF9F0A22' }]}>
            <Text style={[styles.paperBadgeText, { color: '#FF9F0A' }]}>PAPER</Text>
          </View>
        )}
      </View>

      {/* Same live-position display used for an active trade within Strategy */}
      <LivePositionPanel
        live={live}
        staticFallback={{
          contract:      pos.contract,
          entry_premium: pos.entry_premium,
          mid_price:     pos.current_price,
          qty_remaining: pos.qty_remaining,
          pnl:           pos.unrealized_pnl,
          pnl_pct:       pos.unrealized_pnl_pct,
          hard_stop:     pos.hard_stop,
          tp1:           pos.tp1,
          tp2:           pos.tp2,
          tp1_hit:       pos.tp1_hit,
          tp2_hit:       pos.tp2_hit,
        }}
        streaming={connected}
        isMock={showMock}
        accentColor={accentColor}
        strategyId={pos.strategy_id}
        ticker={pos.ticker}
        paperMode={pos.paper_mode}
        onExitPress={() => setExitOpen(true)}
        onAddPress={showMock ? undefined : () => setAddOpen(true)}
        colors={colors}
      />

      {/* Fib levels */}
      {pos.fib_levels && (
        <View style={[styles.fibCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.fibTitle, { color: colors.tabBarInactive }]}>Fibonacci Levels</Text>
          <View style={styles.fibGrid}>
            {Object.entries(pos.fib_levels)
              .filter(([k]) => !['orh', 'orl', 'mid'].includes(k))
              .map(([key, val]) => (
                <View key={key} style={styles.fibItem}>
                  <Text style={[styles.fibKey, { color: colors.tabBarInactive }]}>
                    {key.replace('_', ' ').replace('up', '↑').replace('dn', '↓')}
                  </Text>
                  <Text style={[styles.fibVal, { color: colors.text }]}>
                    ${(val as number).toFixed(2)}
                  </Text>
                </View>
              ))}
          </View>
        </View>
      )}

      {!showMock && (
        <ExitTradeModal
          visible={exitOpen}
          colors={colors}
          strategyId={pos.strategy_id}
          ticker={pos.ticker}
          contract={live?.contract ?? pos.contract}
          qtyRemaining={live?.qty_remaining ?? pos.qty_remaining ?? 1}
          paperMode={pos.paper_mode}
          onClose={() => setExitOpen(false)}
        />
      )}
      {!showMock && (
        <AddContractModal
          visible={addOpen}
          colors={colors}
          strategyId={pos.strategy_id}
          ticker={pos.ticker}
          contract={live?.contract ?? pos.contract}
          qtyHeld={live?.qty_remaining ?? pos.qty_remaining ?? 0}
          entryPremium={live?.entry_premium ?? pos.entry_premium}
          midPrice={live?.mid_price ?? pos.current_price}
          paperMode={pos.paper_mode}
          onClose={() => setAddOpen(false)}
        />
      )}
    </View>
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

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide:      { width: 36, alignItems: 'flex-start', justifyContent: 'center' },
  headerSideRight: { alignItems: 'flex-end', padding: 6 },
  headerCenter:    { flex: 1, alignItems: 'center', gap: 4 },
  title:           { fontSize: 18, fontWeight: '700' },
  activeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  activeBadgeText: { fontSize: 11, fontWeight: '600' },
  liveDot:         { width: 6, height: 6, borderRadius: 3 },

  // ── Account bar ──
  accountBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accountStat: { alignItems: 'center', flex: 1 },
  acctLabel:   { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  acctValue:   { fontSize: 14, fontWeight: '700' },
  divider:     { width: StyleSheet.hairlineWidth, height: 28 },

  // ── Mode toggle ──
  modeToggleRow: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1,
  },
  modeDot:      { width: 6, height: 6, borderRadius: 3 },
  modeBtnText:  { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  modeBadge:    { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  modeBadgeText:{ fontSize: 11, fontWeight: '700' },

  // ── Mock banner ──
  mockBanner:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1 },
  mockBannerText: { fontSize: 12, fontWeight: '600' },

  // ── Scroll content ──
  content: { paddingHorizontal: 16, paddingTop: 16 },

  // ── Empty state ──
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle:    { fontSize: 17, fontWeight: '600', marginTop: 8 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', maxWidth: 260, lineHeight: 18 },
  mockPreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  mockPreviewText: { fontSize: 13, fontWeight: '600' },

  // ── Position blocks ──
  positionBlock: { marginBottom: 20 },
  stratLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stratTicker:   { fontSize: 18, fontWeight: '700' },
  stratName:     { fontSize: 13, flex: 1 },
  paperBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  paperBadgeText:{ fontSize: 10, fontWeight: '700' },

  // ── Fib card ──
  fibCard:  { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 8 },
  fibTitle: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  fibGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fibItem:  { width: '30%', marginBottom: 4 },
  fibKey:   { fontSize: 11, marginBottom: 1 },
  fibVal:   { fontSize: 12, fontWeight: '600' },
});
