import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStrategyPositions } from '@/hooks/queries/strategy/useStrategyPosition';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';
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
 * Shared "list of open positions" data + UI — originally position.tsx's own
 * body, extracted so the same live list (fetch, paper/live filter, hidden
 * trades, per-row WS live pricing) can be embedded in more than one place:
 * the standalone Live Positions page (position.tsx, which still owns its
 * own header/account-bar chrome around this), the Accounts tab's own
 * "Live Positions" section (accounts_overview.tsx), and a single ticker's
 * open contracts at the bottom of PriceChartFullScreen (via `tickerFilter`).
 */

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
    use_tp2:             full.use_tp2,
  };
}

export interface UseLivePositionsDataResult {
  isLoading: boolean;
  /** Mode-filtered (and ticker-filtered, if requested), sorted 0DTE-first. */
  filteredPositions: PositionEntry[];
  /** filteredPositions minus/only hidden trades, per `showHidden`. */
  displayedPositions: PositionEntry[];
  hiddenCount: number;
  showHidden: boolean;
  setShowHidden: React.Dispatch<React.SetStateAction<boolean>>;
  /** Every visible row's latest WS tick, keyed by strategy_id — lets a
   *  parent (e.g. position.tsx's account bar) derive live equity from the
   *  same sockets the rows already hold open, instead of a separate poll. */
  liveByStrategy: Record<string, LivePriceData>;
  handleLiveUpdate: (strategyId: string, data: LivePriceData | null) => void;
}

export function useLivePositionsData(mode: 'live' | 'paper', tickerFilter?: string): UseLivePositionsDataResult {
  const { data: stratPositions = [], isLoading: stratLoading } = useStrategyPositions();
  const { data: immPositions = [], isLoading: immLoading } = useImmediatePositions();
  const isLoading = stratLoading || immLoading;
  const livePositions = [...stratPositions, ...immPositions.map(toPositionEntry)];

  const activePositions = livePositions.filter(p => p.active);
  const filteredPositions = activePositions
    .filter(p => (mode === 'live' ? !p.paper_mode : !!p.paper_mode))
    .filter(p => !tickerFilter || p.ticker.toUpperCase() === tickerFilter.toUpperCase())
    .sort((a, b) =>
      TRADE_HORIZON_RANK[getTradeHorizon(a.contract ?? '')] -
      TRADE_HORIZON_RANK[getTradeHorizon(b.contract ?? '')],
    );

  const { isHidden } = useHiddenPositions();
  const [showHidden, setShowHidden] = useState(false);
  const hiddenPositions = filteredPositions.filter(p => isHidden(positionHideKey(p)));
  const visiblePositions = filteredPositions.filter(p => !isHidden(positionHideKey(p)));
  const hiddenCount = hiddenPositions.length;
  const displayedPositions = showHidden ? hiddenPositions : visiblePositions;

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

  return {
    isLoading, filteredPositions, displayedPositions, hiddenCount,
    showHidden, setShowHidden, liveByStrategy, handleLiveUpdate,
  };
}

// ── PositionRow ────────────────────────────────────────────────────────────────
// Owns the live-price WS subscription + exit-modal state for one position —
// same shape as strategy.tsx's StrategyCard/ImmediatePositionCard, so each
// row here needs its own component (hooks can't be called per-item inside
// a parent's .map()).

export function PositionRow({
  pos, colors, onLiveUpdate, hideChartButton,
}: {
  pos: PositionEntry;
  colors: any;
  onLiveUpdate: (strategyId: string, data: LivePriceData | null) => void;
  /** True when rendered inside PriceChartFullScreen's own open-contracts
   *  section — a button that reopens the chart you're on is noise there. */
  hideChartButton?: boolean;
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
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {!hideChartButton && (
          <TouchableOpacity
            onPress={() => toTicker(pos.ticker, { fullScreenChart: true })}
            hitSlop={6}
            activeOpacity={0.75}
            style={[styles.viewChartBtn, { backgroundColor: colors.text + '1F' }]}
          >
            <Ionicons name="bar-chart-outline" size={11} color={colors.text} />
            <Text style={[styles.viewChartText, { color: colors.text }]}>View Chart</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Same live-position display used for an active trade within Strategy —
          its own header includes the "Open Chart" icon (see LivePositionPanel). */}
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
          use_tp2:       pos.use_tp2,
        }}
        streaming={connected}
        accentColor={accentColor}
        profile={pos.profile}
        strategyId={pos.strategy_id}
        ticker={pos.ticker}
        paperMode={pos.paper_mode}
        onExitPress={() => setExitOpen(true)}
        onAddPress={() => setAddOpen(true)}
        colors={colors}
        patchData={patchData}
        hideKey={positionHideKey(pos)}
      />

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

interface LivePositionsBodyProps {
  /** Result of useLivePositionsData(mode[, tickerFilter]) — called by the
   *  caller (not internally here) so a screen that also needs the live
   *  equity data (e.g. position.tsx's account bar) shares the exact same
   *  hook instance/WS-tick state as what actually renders, instead of a
   *  second, independent copy that would never see the same live ticks. */
  data: UseLivePositionsDataResult;
  mode: 'live' | 'paper';
  colors: any;
  emptyTitle?: string;
  emptySubtitle?: string;
  /** True when embedded inside PriceChartFullScreen's own open-contracts
   *  section — hides each row's "open chart" icon (it would just reopen the
   *  chart you're already looking at). */
  hideChartButton?: boolean;
}

/** Hidden banner + list/empty-state — no header, no account bar, no own
 *  ScrollView, so it can be embedded inside any parent scroll container. */
export function LivePositionsBody({
  data, mode, colors, emptyTitle, emptySubtitle, hideChartButton,
}: LivePositionsBodyProps) {
  const {
    isLoading, displayedPositions, hiddenCount, showHidden, setShowHidden, handleLiveUpdate,
  } = data;

  return (
    <>
      {hiddenCount > 0 && (
        <TouchableOpacity
          onPress={() => setShowHidden(v => !v)}
          activeOpacity={0.75}
          style={[styles.hiddenBanner, { backgroundColor: '#4A9EFF1A', borderColor: colors.border }]}
        >
          <Ionicons name="eye-off-outline" size={14} color="#4A9EFF" />
          <Text style={[styles.hiddenBannerText, { color: '#4A9EFF' }]}>
            {showHidden ? 'Showing Hidden — Tap to Return' : `${hiddenCount} Hidden`}
          </Text>
          <Ionicons name={showHidden ? 'chevron-up' : 'chevron-forward'} size={14} color="#4A9EFF" />
        </TouchableOpacity>
      )}

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : displayedPositions.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="pulse-outline" size={40} color={colors.tabBarInactive} style={{ opacity: 0.4 }} />
          <Text style={[styles.emptyTitle, { color: colors.tabBarInactive }]}>
            {emptyTitle ?? `No ${mode === 'live' ? 'Live' : 'Paper'} Positions`}
          </Text>
          {!!emptySubtitle && (
            <Text style={[styles.emptySubtitle, { color: colors.tabBarInactive }]}>{emptySubtitle}</Text>
          )}
        </View>
      ) : (
        displayedPositions.map(pos => (
          <PositionRow
            key={pos.strategy_id}
            pos={pos}
            colors={colors}
            onLiveUpdate={handleLiveUpdate}
            hideChartButton={hideChartButton}
          />
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hiddenBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: 10, borderWidth: 1, marginBottom: 10,
  },
  hiddenBannerText: { fontSize: 12, fontWeight: '700' },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  emptySubtitle: { fontSize: 12, textAlign: 'center', maxWidth: 260, lineHeight: 17 },

  positionBlock: { marginBottom: 20 },
  stratLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stratTicker:   { fontSize: 18, fontWeight: '700' },
  stratName:     { fontSize: 13, flex: 1 },
  viewChartBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
  },
  viewChartText: { fontSize: 10, fontWeight: '700' },
});
