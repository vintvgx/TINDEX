import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { LivePositionPanel } from '@/common/components/strategy/LivePositionPanel';
import { ExitTradeModal } from '@/common/components/strategy/ExitTradeModal';
import { AddContractModal } from '@/common/components/strategy/AddContractModal';
import type { ImmediatePosition } from '@/common/types/strategy';
import { TRADE_HORIZON_RANK, getTradeHorizon } from '@/lib/formatContract';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { useHiddenPositions } from '@/hooks/useHiddenPositions';
import { positionHideKey } from '@/lib/positionHideKey';

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

  const activePositions   = livePositions.filter(p => p.active);
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

  // Hidden trades (e.g. a contract that expired worthless) stay out of the
  // default list but are never excluded from the equity math above — hiding
  // is purely a client-side display filter (never touches the backend), the
  // position is still real and still open.
  const { isHidden } = useHiddenPositions();
  const [showHidden, setShowHidden] = useState(false);
  const hiddenPositions = filteredPositions.filter(p => isHidden(positionHideKey(p)));
  const visiblePositions = filteredPositions.filter(p => !isHidden(positionHideKey(p)));
  const hiddenCount = hiddenPositions.length;
  const displayedPositions = showHidden ? hiddenPositions : visiblePositions;

  // Each rendered PositionRow already holds its own open WebSocket
  // (useStrategyLivePrice) streaming that position's live mark-to-market
  // value for its own P&L display. Rows report their latest tick up here via
  // onLiveUpdate so the account bar's equity can be derived from the same
  // already-open sockets instead of a separate slow REST poll.
  const [liveByStrategy, setLiveByStrategy] = useState<Record<string, LivePriceData>>({});
  const handleLiveUpdate = useCallback((strategyId: string, data: LivePriceData | null) => {
    setLiveByStrategy(prev => {
      if (!data) {
        if (!(strategyId in prev)) return prev;
        const next = { ...prev };
        delete next[strategyId];
        return next;
      }
      return { ...prev, [strategyId]: data };
    });
  }, []);

  // Live-derived equity = cash (stable mid-trade, from the slow account poll)
  // + the sum of every open position's live market value. Falls back to a
  // position's static cost basis (entry_premium * qty * 100) for the brief
  // window before its socket delivers a first tick, and to the account's own
  // (slower) equity field entirely when nothing is open to aggregate.
  const liveDerivedEquity = useMemo(() => {
    if (!account?.available || filteredPositions.length === 0) return null;
    let sumMarketValue = 0;
    for (const pos of filteredPositions) {
      const live = liveByStrategy[pos.strategy_id];
      if (live?.market_value != null) {
        sumMarketValue += live.market_value;
      } else if (pos.entry_premium != null && pos.qty_remaining != null) {
        sumMarketValue += pos.entry_premium * pos.qty_remaining * 100;
      }
    }
    return account.cash + sumMarketValue;
  }, [account, filteredPositions, liveByStrategy]);

  const displayEquity = liveDerivedEquity ?? account?.equity ?? 0;
  const displayPnlToday =
    liveDerivedEquity != null && account?.last_equity != null
      ? liveDerivedEquity - account.last_equity
      : account?.pnl_today ?? 0;

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
          onPress={toggleMode}
          hitSlop={8}
          activeOpacity={0.75}
          style={[styles.activeBadge, { backgroundColor: (mode === 'live' ? '#30D158' : '#FF9F0A') + '22' }]}
        >
          <View style={[styles.liveDot, { backgroundColor: mode === 'live' ? '#30D158' : '#FF9F0A' }]} />
          <Text style={[styles.activeBadgeText, { color: mode === 'live' ? '#30D158' : '#FF9F0A' }]}>
            {mode === 'live' ? 'LIVE' : 'PAPER'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Account bar (sticky), horizontally scrollable — every data point
          lives in one row now. Not touchable: the header's LIVE/PAPER badge
          above is the only way to flip mode, so nothing here fights the
          scroll gesture. Day Trades stays last. ── */}
      {account?.available && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.accountBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
          contentContainerStyle={styles.accountBarContent}
        >
          <AccountStat
            label={mode === 'live' ? 'Live Equity' : 'Paper Equity'}
            value={`$${displayEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            color={mode === 'live' ? '#30D158' : '#FF9F0A'}
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat
            label="Today P&L"
            value={`${displayPnlToday >= 0 ? '+' : ''}$${displayPnlToday.toFixed(2)}`}
            color={displayPnlToday >= 0 ? colors.success : colors.error}
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Available Balance" value={`$${(account.available_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Buying Power" value={`$${account.buying_power.toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Options BP" value={`$${(account.options_buying_power ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Long Value" value={`$${(account.long_market_value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Short Value" value={`$${(account.short_market_value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Cash" value={`$${account.cash.toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Day Trades" value={String(account.day_trade_count ?? 0)} colors={colors} />
        </ScrollView>
      )}

      {/* ── Hidden-trades banner — only shown when at least one trade is
          hidden; tap to reveal them (they only un-hide via the Edit menu). ── */}
      {hiddenCount > 0 && (
        <TouchableOpacity
          onPress={() => setShowHidden(v => !v)}
          activeOpacity={0.75}
          style={[styles.hiddenBanner, { backgroundColor: '#4A9EFF1A', borderBottomColor: colors.border }]}
        >
          <Ionicons name="eye-off-outline" size={14} color="#4A9EFF" />
          <Text style={[styles.hiddenBannerText, { color: '#4A9EFF' }]}>
            {showHidden ? 'Showing Hidden — Tap to Return' : `${hiddenCount} Hidden`}
          </Text>
          <Ionicons name={showHidden ? 'chevron-up' : 'chevron-forward'} size={14} color="#4A9EFF" />
        </TouchableOpacity>
      )}

      {/* ── Scrollable content ── */}
      <ScrollView style={styles.contentScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
        ) : displayedPositions.length === 0 ? (
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
          </View>
        ) : (
          displayedPositions
            .map(pos => (
              <PositionRow key={pos.strategy_id} pos={pos} colors={colors} onLiveUpdate={handleLiveUpdate} />
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

function PositionRow({
  pos, colors, onLiveUpdate,
}: {
  pos: PositionEntry;
  colors: any;
  onLiveUpdate: (strategyId: string, data: LivePriceData | null) => void;
}) {
  const { toTicker } = useBaseNavigation();
  const { data: live, connected, patchData } = useStrategyLivePrice(pos.strategy_id, pos.active);
  const [exitOpen, setExitOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const accentColor = pos.direction === 'CALL' ? colors.success : colors.error;

  // Report every tick (and clear on unmount, e.g. mode toggle or exit) so the
  // parent's account-bar equity always reflects exactly the rows on screen.
  useEffect(() => {
    onLiveUpdate(pos.strategy_id, live);
  }, [pos.strategy_id, live, onLiveUpdate]);
  useEffect(() => {
    return () => onLiveUpdate(pos.strategy_id, null);
  }, [pos.strategy_id, onLiveUpdate]);

  return (
    <View style={styles.positionBlock}>
      {/* Strategy label row */}
      <View style={styles.stratLabelRow}>
        <TouchableOpacity
          onPress={() => toTicker(pos.ticker)}
          hitSlop={6}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
        >
          <TickerLogo
            uri={`https://financialmodelingprep.com/image-stock/${pos.ticker.toUpperCase()}.png`}
            ticker={pos.ticker}
            size={18}
          />
          <Text style={[styles.stratTicker, { color: colors.text }]}>{pos.ticker}</Text>
        </TouchableOpacity>
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
        accentColor={accentColor}
        strategyId={pos.strategy_id}
        ticker={pos.ticker}
        paperMode={pos.paper_mode}
        onExitPress={() => setExitOpen(true)}
        onAddPress={() => setAddOpen(true)}
        colors={colors}
        patchData={patchData}
        hideKey={positionHideKey(pos)}
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
    </View>
  );
}

const AccountStat = ({ label, value, color, colors }: any) => (
  <View style={styles.accountStat}>
    <Text style={[styles.acctLabel, { color: colors.tabBarInactive }]} numberOfLines={1}>
      {label}
    </Text>
    <Text
      style={[styles.acctValue, { color: color ?? colors.text }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
    >
      {value}
    </Text>
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
    flexGrow: 0,
    flexShrink: 0,
  },
  headerSide:      { width: 36, alignItems: 'flex-start', justifyContent: 'center' },
  headerCenter:    { flex: 1, alignItems: 'center', gap: 4 },
  title:           { fontSize: 18, fontWeight: '700' },
  activeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  activeBadgeText: { fontSize: 11, fontWeight: '600' },
  liveDot:         { width: 6, height: 6, borderRadius: 3 },

  // ── Hidden-trades banner ──
  hiddenBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hiddenBannerText: { fontSize: 12, fontWeight: '700' },

  // ── Account bar (scrollable) ──
  accountBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: 68,
    maxHeight: 68,
    minHeight: 68,
    // Pinned to exactly 68 regardless of sibling content — this bar was
    // stretching to fill leftover screen space (visibly centered inside a
    // much taller box) whenever the position list below it was short (0 or
    // 1 rows), since neither it nor the content ScrollView below had an
    // explicit flexGrow/flexShrink telling Yoga who actually owns the
    // remaining space.
    flexGrow: 0,
    flexShrink: 0,
  },
  accountBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  accountStat: { alignItems: 'center', minWidth: 88, paddingHorizontal: 6, flexShrink: 0 },
  acctLabel:   { fontSize: 9, lineHeight: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3 },
  acctValue:   { fontSize: 14, lineHeight: 17, fontWeight: '700' },
  divider:     { width: StyleSheet.hairlineWidth, height: 28, flexShrink: 0 },

  // ── Scroll content ──
  // Explicit flex:1 so this ScrollView — not the fixed-height header/account
  // bar above it — is the thing that actually owns all leftover screen
  // space; flexGrow:1 on its contentContainerStyle is what lets the empty
  // state below correctly center within that space instead of collapsing
  // to its own intrinsic (tiny) size.
  contentScroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, flexGrow: 1 },

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
