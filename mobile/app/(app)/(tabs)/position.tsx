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
import { useAlpacaAccount } from '@/hooks/queries/strategy/useAlpacaAccount';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { LivePositionPanel } from '@/common/components/strategy/LivePositionPanel';
import { ExitTradeModal } from '@/common/components/strategy/ExitTradeModal';
import type { FibLevels } from '@/common/types/strategy';

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

  const { data: livePositions = [], isLoading } = useStrategyPositions();
  const { data: account } = useAlpacaAccount();

  const positions         = showMock ? MOCK_POSITIONS : livePositions;
  const activePositions   = positions.filter(p => p.active);
  const filteredPositions = activePositions.filter(p =>
    mode === 'live' ? !p.paper_mode : !!p.paper_mode,
  );
  const activeCount = filteredPositions.length;

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

      {/* ── Account bar (sticky) ── */}
      {account && (
        <View style={[styles.accountBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <AccountStat
            label={account.paper_mode ? 'Paper Equity' : 'Live Equity'}
            value={`$${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
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
        </View>
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
