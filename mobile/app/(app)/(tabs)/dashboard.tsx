import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, SafeAreaView,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useThemeColors } from '@/lib/useColorScheme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { Skeleton } from '@/common/components/ui/Skeleton';
import { useStrategyPositions, type PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';
import { useStrategySessionState } from '@/hooks/queries/strategy/useStrategySessionState';
import { usePendingConfirmations } from '@/hooks/queries/strategy/usePendingConfirmations';
import { PendingConfirmationCard } from '@/common/components/strategy/PendingConfirmationCard';
import { useORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { useOrbServiceAlert } from '@/hooks/useOrbServiceAlert';
import { ExitTradeModal } from '@/common/components/strategy/ExitTradeModal';
import { AddContractModal } from '@/common/components/strategy/AddContractModal';
import { EditExitsButton } from '@/common/components/shared/EditExitsButton';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import {
  ORBNotificationModal,
  type ORBBreakoutNotificationData,
} from '@/common/components/FEED/modals/ORBNotificationModal';
import { useQueryClient } from '@tanstack/react-query';
import type { ImmediatePosition } from '@/common/types/strategy';
import { formatContractSymbolShort, getTradeHorizon, TRADE_HORIZON_RANK } from '@/lib/formatContract';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { useHiddenPositions } from '@/hooks/useHiddenPositions';
import { positionHideKey } from '@/lib/positionHideKey';

// ─── Constants ────────────────────────────────────────────────────────────────

const WATCHED_TICKERS = ['SPY', 'IWM', 'QQQ'];

const SENTIMENT_COLOR: Record<string, string> = {
  green:  '#30D158',
  gray:   '#8E8E93',
  yellow: '#FFD60A',
  orange: '#FF9F0A',
  red:    '#FF453A',
};

const PROFILE_EMOJI: Record<string, string> = {
  BULL_DOG: '🐂', THUNDER_CAT: '🐱', WOLF: '🐺', TREND_RIDER: '🚀',
  RETESTER: '🎯', REVERSAL: '🔄', CUSTOM: '⚙️', SCALPER: '⚡',
  PRECISION: '🎯', MOMENTUM: '📈', CONVICTION: '💎', ALL_IN: '🔥',
  OTM_RUNNER: '🏃', OTM_CONVICTION: '💎', MANUAL: '🖐️',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

// ─── Market Tile ─────────────────────────────────────────────────────────────

function MarketTile({
  label, value, formatValue, sub, accentColor, colors, loading,
}: {
  label: string;
  /** Raw numeric value — null while nothing has arrived yet. */
  value: number | null;
  formatValue: (n: number) => string;
  sub?: string;
  accentColor: string;
  colors: any;
  /** Extra readiness gate beyond `value == null` (e.g. ORB range data). */
  loading?: boolean;
}) {
  // Counts up from 0 on first arrival, then smoothly tracks each later tick —
  // "stock number" style, not a flat pop-in.
  const animatedValue = useAnimatedNumber(value);
  const showSkeleton = loading || value == null;

  return (
    <View style={[styles.tile, { backgroundColor: accentColor + '12', borderColor: accentColor + '30' }]}>
      <Text style={[styles.tileLabel, { color: colors.textTertiary }]}>{label}</Text>
      {showSkeleton ? (
        <>
          <Skeleton width={56} height={22} borderRadius={5} style={{ marginTop: 3 }} />
          <Skeleton width={64} height={11} borderRadius={4} style={{ marginTop: 6 }} />
        </>
      ) : (
        <Animated.View entering={FadeIn.duration(700)}>
          <Text style={[styles.tileValue, { color: accentColor }]}>
            {formatValue(animatedValue ?? value)}
          </Text>
          {sub != null && (
            <Text style={[styles.tileSub, { color: accentColor + 'CC' }]}>{sub}</Text>
          )}
        </Animated.View>
      )}
    </View>
  );
}

// ─── Position Card ────────────────────────────────────────────────────────────

interface ExitTarget {
  strategyId: string;
  ticker: string;
  contract?: string;
  qtyRemaining: number;
  paperMode: boolean;
}

interface AddTarget {
  strategyId: string;
  ticker: string;
  contract?: string;
  qtyHeld: number;
  entryPremium?: number;
  midPrice?: number;
  paperMode: boolean;
}

function StrategyPositionCard({
  pos, colors, onExit, onAdd,
}: { pos: PositionEntry; colors: any; onExit: (t: ExitTarget) => void; onAdd: (t: AddTarget) => void }) {
  const { toTicker } = useBaseNavigation();
  const dirColor = pos.direction === 'CALL' ? colors.success : colors.error;
  const isLive   = pos.paper_mode === false;

  // Same WS the Live Positions tab uses. REST here (useStrategyPositions)
  // only polls every 15s, so without this merge every field on this card —
  // not just stop/TP — would visibly lag behind the Live Positions tab,
  // which merges this same `live` snapshot into everything it renders. Also
  // gets the patchData escape hatch so a submitted edit reflects immediately.
  const { data: live, patchData } = useStrategyLivePrice(pos.strategy_id, pos.active);
  const hardStop      = live?.hard_stop     ?? pos.hard_stop;
  const tp1           = live?.tp1           ?? pos.tp1;
  const tp2           = live?.tp2           ?? pos.tp2;
  const entryPremium  = live?.entry_premium ?? pos.entry_premium;
  const tp1Hit        = live?.tp1_hit       ?? pos.tp1_hit;
  const tp2Hit        = live?.tp2_hit       ?? pos.tp2_hit;
  const currentPrice  = live?.mid_price     ?? pos.current_price;
  const qtyRemaining  = live?.qty_remaining ?? pos.qty_remaining;
  const marketValue   = live?.market_value
    ?? (currentPrice != null && qtyRemaining != null ? currentPrice * qtyRemaining * 100 : undefined);
  const pnl           = live?.pnl     ?? pos.unrealized_pnl     ?? 0;
  const pnlPct        = live?.pnl_pct ?? pos.unrealized_pnl_pct ?? 0;
  const pnlColor      = pnl >= 0 ? colors.success : colors.error;
  const canEditExits  = hardStop != null && tp1 != null && entryPremium != null;

  const stages = [
    { label: 'Stop', value: hardStop,          active: !tp1Hit && !pos.be_stop_active,      color: colors.error },
    { label: 'BE',   value: entryPremium,       active: !!pos.be_stop_active,                color: '#FF9F0A' },
    { label: 'TP1',  value: tp1,                active: !!tp1Hit && !tp2Hit,                 color: '#4A9EFF' },
    { label: 'TP2',  value: tp2,                active: !!tp2Hit,                             color: colors.success },
  ];

  return (
    <View style={[styles.posCard, { backgroundColor: colors.card, borderColor: colors.border,
                                    borderLeftColor: pnlColor, borderLeftWidth: 3 }]}>
      {/* Top row */}
      <View style={styles.posHeader}>
        <View style={{ flex: 1 }}>
          <TouchableOpacity
            onPress={() => toTicker(pos.ticker)}
            hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          >
            <TickerLogo
              uri={`https://financialmodelingprep.com/image-stock/${pos.ticker.toUpperCase()}.png`}
              ticker={pos.ticker}
              size={16}
            />
            <Text style={[styles.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
          </TouchableOpacity>
          <Text style={[styles.posContract, { color: colors.textSecondary }]} numberOfLines={1}>
            {pos.contract ? formatContractSymbolShort(pos.contract) : '—'}
          </Text>
          <View style={styles.posBadges}>
            <View style={[styles.badge, { backgroundColor: dirColor + '22' }]}>
              <Text style={[styles.badgeText, { color: dirColor }]}>{pos.direction}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.border }]}>
              <Text style={[styles.badgeText, { color: colors.text }]}>
                {pos.profile.replace('_', ' ')}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: isLive ? '#30D15822' : '#FF9F0A22' }]}>
              <Text style={[styles.badgeText, { color: isLive ? '#30D158' : '#FF9F0A' }]}>
                {isLive ? 'LIVE' : 'PAPER'}
              </Text>
            </View>
            {pos.contract && getTradeHorizon(pos.contract) === 'SWING' && (
              <View style={[styles.badge, { backgroundColor: '#6366F122' }]}>
                <Text style={[styles.badgeText, { color: '#6366F1' }]}>SWING</Text>
              </View>
            )}
          </View>
        </View>

        {/* P&L */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.posPnl, { color: pnlColor }]}>
            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
          </Text>
          <Text style={[styles.posPnlPct, { color: pnlColor }]}>
            {pnlPct >= 0 ? '+' : '-'}{Math.abs(pnlPct).toFixed(1)}%
          </Text>
          {marketValue != null && (
            <Text style={[styles.posMktVal, { color: colors.textTertiary }]}>
              Mkt ${marketValue.toFixed(2)}
            </Text>
          )}
        </View>
      </View>

      {/* Entry / Current / Qty */}
      <View style={styles.posLevels}>
        {[
          { label: 'Entry',   value: fmtPrice(entryPremium) },
          { label: 'Current', value: fmtPrice(currentPrice), accent: true },
          { label: 'Qty',     value: `${qtyRemaining ?? '?'}/${pos.qty_total ?? '?'}` },
        ].map(({ label, value, accent }) => (
          <View key={label} style={{ alignItems: 'center', flex: 1 }}>
            <Text style={[styles.levelLabel, { color: colors.textTertiary }]}>{label}</Text>
            <Text style={[styles.levelValue, { color: accent ? colors.accent : colors.text }]}>{value}</Text>
          </View>
        ))}
      </View>

      {/* Stage bar */}
      <View style={styles.stageBar}>
        {stages.map((s, i) => (
          <View key={i} style={{ alignItems: 'center', flex: 1 }}>
            <View style={[styles.stageDot, { backgroundColor: s.active ? s.color : colors.border }]} />
            <Text style={[styles.stageLabel, { color: s.active ? s.color : colors.textTertiary }]}>
              {s.label}
            </Text>
            {s.value != null && (
              <Text style={[styles.stageValue, { color: colors.textTertiary }]}>
                ${s.value.toFixed(2)}
              </Text>
            )}
          </View>
        ))}
      </View>

      {/* Edit exits + add + exit buttons */}
      <View style={styles.actionsRow}>
        {canEditExits && (
          <EditExitsButton
            mode="orb"
            strategy_id={pos.strategy_id}
            ticker={pos.ticker}
            hard_stop={hardStop!}
            tp1={tp1!}
            tp2={tp2}
            entry_premium={entryPremium!}
            tp1_hit={tp1Hit}
            tp2_hit={tp2Hit}
            hideKey={positionHideKey(pos)}
            onUpdated={patchData}
            style={{ flex: 1 }}
          />
        )}
        <TouchableOpacity
          onPress={() => onAdd({
            strategyId:   pos.strategy_id,
            ticker:       pos.ticker,
            contract:     pos.contract,
            qtyHeld:      qtyRemaining ?? 0,
            entryPremium: entryPremium,
            midPrice:     currentPrice,
            paperMode:    pos.paper_mode !== false,
          })}
          style={[styles.addBtn, { flex: 1, borderColor: colors.accent + '88' }]}
        >
          <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
          <Text style={[styles.addBtnText, { color: colors.accent }]}>Add</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onExit({
            strategyId:   pos.strategy_id,
            ticker:       pos.ticker,
            contract:     pos.contract,
            qtyRemaining: qtyRemaining ?? 0,
            paperMode:    pos.paper_mode !== false,
          })}
          style={[styles.exitBtn, { flex: 1, borderColor: colors.error + '88' }]}
        >
          <Ionicons name="close-circle-outline" size={16} color={colors.error} />
          <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit Position</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ImmediatePositionCard({
  pos, colors, onExit, onAdd,
}: { pos: ImmediatePosition; colors: any; onExit: (t: ExitTarget) => void; onAdd: (t: AddTarget) => void }) {
  const { toTicker } = useBaseNavigation();
  const dirColor = pos.direction === 'CALL' ? colors.success : colors.error;
  const isLive   = pos.paper_mode === false;

  // ImmediatePosition carries no hard_stop/tp1/tp2 over REST at all, and its
  // REST poll (useImmediatePositions) only refreshes every 5s — same WS the
  // Live Positions tab uses drives every field here too, same as it does there.
  const { data: live, patchData } = useStrategyLivePrice(pos.strategy_id, true);
  const hardStop      = live?.hard_stop;
  const tp1           = live?.tp1;
  const tp2           = live?.tp2;
  const entryPremium  = live?.entry_premium ?? pos.entry_premium ?? undefined;
  const tp1Hit        = live?.tp1_hit ?? pos.tp1_hit;
  const tp2Hit        = live?.tp2_hit ?? pos.tp2_hit;
  const midPrice      = live?.mid_price ?? pos.mid_price ?? undefined;
  const qtyRemaining  = live?.qty_remaining ?? pos.qty_remaining;
  const marketValue   = live?.market_value
    ?? (midPrice != null && qtyRemaining != null ? midPrice * qtyRemaining * 100 : undefined);
  const pnl           = live?.pnl     ?? pos.pnl     ?? 0;
  const pnlPct        = live?.pnl_pct ?? pos.pnl_pct ?? 0;
  const pnlColor      = pnl >= 0 ? colors.success : colors.error;
  const canEditExits  = hardStop != null && tp1 != null && entryPremium != null;

  return (
    <View style={[styles.posCard, { backgroundColor: colors.card, borderColor: colors.border,
                                    borderLeftColor: pnlColor, borderLeftWidth: 3 }]}>
      <View style={styles.posHeader}>
        <View style={{ flex: 1 }}>
          <TouchableOpacity
            onPress={() => toTicker(pos.ticker)}
            hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          >
 
            <TickerLogo
              uri={`https://financialmodelingprep.com/image-stock/${pos.ticker.toUpperCase()}.png`}
              ticker={pos.ticker}
              size={16}
            />
            <Text style={[styles.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
          </TouchableOpacity>
          <Text style={[styles.posContract, { color: colors.textSecondary }]} numberOfLines={1}>
            {pos.contract ? formatContractSymbolShort(pos.contract) : '—'}
          </Text>
          <View style={styles.posBadges}>
            <View style={[styles.badge, { backgroundColor: dirColor + '22' }]}>
              <Text style={[styles.badgeText, { color: dirColor }]}>{pos.direction}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: '#A855F722' }]}>
              <Text style={[styles.badgeText, { color: '#A855F7' }]}>IMMEDIATE</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: isLive ? '#30D15822' : '#FF9F0A22' }]}>
              <Text style={[styles.badgeText, { color: isLive ? '#30D158' : '#FF9F0A' }]}>
                {isLive ? 'LIVE' : 'PAPER'}
              </Text>
            </View>
            {pos.contract && getTradeHorizon(pos.contract) === 'SWING' && (
              <View style={[styles.badge, { backgroundColor: '#6366F122' }]}>
                <Text style={[styles.badgeText, { color: '#6366F1' }]}>SWING</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.posPnl, { color: pnlColor }]}>
            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
          </Text>
          <Text style={[styles.posPnlPct, { color: pnlColor }]}>
            {pnlPct >= 0 ? '+' : '-'}{Math.abs(pnlPct).toFixed(1)}%
          </Text>
          {marketValue != null && (
            <Text style={[styles.posMktVal, { color: colors.textTertiary }]}>
              Mkt ${marketValue.toFixed(2)}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.posLevels}>
        {[
          { label: 'Entry',   value: fmtPrice(entryPremium) },
          { label: 'Current', value: fmtPrice(midPrice), accent: true },
          { label: 'Qty',     value: String(qtyRemaining ?? '?') },
        ].map(({ label, value, accent }) => (
          <View key={label} style={{ alignItems: 'center', flex: 1 }}>
            <Text style={[styles.levelLabel, { color: colors.textTertiary }]}>{label}</Text>
            <Text style={[styles.levelValue, { color: accent ? colors.accent : colors.text }]}>{value}</Text>
          </View>
        ))}
      </View>

      {/* TP milestone badges */}
      <View style={styles.stageBar}>
        {[
          { label: 'Stop',  active: !tp1Hit,                      color: colors.error },
          { label: 'TP1',   active: tp1Hit && !tp2Hit,             color: '#4A9EFF' },
          { label: 'TP2',   active: tp2Hit,                        color: colors.success },
        ].map((s, i) => (
          <View key={i} style={{ alignItems: 'center', flex: 1 }}>
            <View style={[styles.stageDot, { backgroundColor: s.active ? s.color : colors.border }]} />
            <Text style={[styles.stageLabel, { color: s.active ? s.color : colors.textTertiary }]}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.actionsRow}>
        {canEditExits && (
          <EditExitsButton
            mode="orb"
            strategy_id={pos.strategy_id}
            ticker={pos.ticker}
            hard_stop={hardStop!}
            tp1={tp1!}
            tp2={tp2}
            entry_premium={entryPremium!}
            tp1_hit={tp1Hit}
            tp2_hit={tp2Hit}
            hideKey={positionHideKey(pos)}
            onUpdated={patchData}
            style={{ flex: 1 }}
          />
        )}
        <TouchableOpacity
          onPress={() => onAdd({
            strategyId:   pos.strategy_id,
            ticker:       pos.ticker,
            contract:     pos.contract,
            qtyHeld:      qtyRemaining ?? 0,
            entryPremium: entryPremium,
            midPrice:     midPrice,
            paperMode:    pos.paper_mode !== false,
          })}
          style={[styles.addBtn, { flex: 1, borderColor: colors.accent + '88' }]}
        >
          <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
          <Text style={[styles.addBtnText, { color: colors.accent }]}>Add</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onExit({
            strategyId:   pos.strategy_id,
            ticker:       pos.ticker,
            contract:     pos.contract,
            qtyRemaining: qtyRemaining ?? 0,
            paperMode:    pos.paper_mode !== false,
          })}
          style={[styles.exitBtn, { flex: 1, borderColor: colors.error + '88' }]}
        >
          <Ionicons name="close-circle-outline" size={16} color={colors.error} />
          <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit Position</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

const DashboardScreen = () => {
  const colors = useThemeColors();
  const params = useLocalSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { livePrices, vix, spy, sentiment, connected } = useMarketStream(WATCHED_TICKERS);
  const { data: orbData, isLoading: orbLoading } = useORBMonitoringState(false, false);
  const { data: stratPositions, isLoading: stratLoading, refetch: refetchStrat } = useStrategyPositions();
  const { data: immPositions,   isLoading: immLoading,   refetch: refetchImm }   = useImmediatePositions();
  const { data: sessionStates } = useStrategySessionState();

  const isLoading = stratLoading || immLoading;

  const refresh = () => {
    refetchStrat();
    refetchImm();
    queryClient.invalidateQueries({ queryKey: ['strategy-session-state'] });
  };

  // ── ORB range lookup (for ORB position colors) ───────────────────────────
  const orbMap = useMemo(() => {
    const m = new Map<string, { high: number | null; low: number | null }>();
    for (const item of (orbData ?? [])) {
      m.set(item.ticker as string, {
        high: (item as any).orb_high ?? null,
        low:  (item as any).orb_low  ?? null,
      });
    }
    return m;
  }, [orbData]);

  function orbColor(ticker: string, price: number | null): string {
    const orb = orbMap.get(ticker);
    if (!orb || price == null) return colors.accent;
    if (orb.high != null && price > orb.high) return '#30D158';
    if (orb.low  != null && price < orb.low)  return '#FF453A';
    return '#FFD60A';
  }

  function orbSub(ticker: string, price: number | null): string | undefined {
    const orb = orbMap.get(ticker);
    if (!orb || price == null) return undefined;
    if (orb.high != null && price > orb.high) return '↑ Above ORB';
    if (orb.low  != null && price < orb.low)  return '↓ Below ORB';
    return '◉ In Range';
  }

  // ── Active positions (combined, split by mode) ────────────────────────────
  const activeStrat = useMemo(
    () => (stratPositions ?? []).filter(p => p.active),
    [stratPositions],
  );
  const activeImm = useMemo(
    () => (immPositions ?? []).filter(p => (p.qty_remaining ?? 0) > 0),
    [immPositions],
  );

  const liveStrat  = useMemo(() => activeStrat.filter(p => p.paper_mode === false), [activeStrat]);
  const paperStrat = useMemo(() => activeStrat.filter(p => p.paper_mode !== false),  [activeStrat]);
  const liveImm    = useMemo(() => activeImm.filter(p => p.paper_mode === false),    [activeImm]);
  const paperImm   = useMemo(() => activeImm.filter(p => p.paper_mode !== false),    [activeImm]);

  // Hidden trades (e.g. a contract that expired worthless) stay out of the
  // default card list but still count toward the ACTIVE badges above — hiding
  // is purely a client-side display filter (never touches the backend), the
  // position is still real and still open.
  const { isHidden } = useHiddenPositions();
  const [showHidden, setShowHidden] = useState(false);
  const hiddenCount =
    activeStrat.filter(p => isHidden(positionHideKey(p))).length
    + activeImm.filter(p => isHidden(positionHideKey(p))).length;

  // Combined + sorted so a swing trade never ranks above a 0DTE/weekly one —
  // sort is stable, so saved-strategy vs immediate order is otherwise
  // unchanged within the same horizon tier.
  type CombinedPos = { kind: 'strat'; pos: PositionEntry } | { kind: 'imm'; pos: ImmediatePosition };
  const byHorizon = (items: CombinedPos[]) =>
    [...items]
      .filter(({ pos }) => (showHidden ? isHidden(positionHideKey(pos)) : !isHidden(positionHideKey(pos))))
      .sort((a, b) =>
        TRADE_HORIZON_RANK[getTradeHorizon(a.pos.contract ?? '')] -
        TRADE_HORIZON_RANK[getTradeHorizon(b.pos.contract ?? '')],
      );
  const liveCombined = useMemo(
    () => byHorizon([
      ...liveStrat.map(pos => ({ kind: 'strat' as const, pos })),
      ...liveImm.map(pos => ({ kind: 'imm' as const, pos })),
    ]),
    [liveStrat, liveImm],
  );
  const paperCombined = useMemo(
    () => byHorizon([
      ...paperStrat.map(pos => ({ kind: 'strat' as const, pos })),
      ...paperImm.map(pos => ({ kind: 'imm' as const, pos })),
    ]),
    [paperStrat, paperImm],
  );

  const totalLive   = liveStrat.length + liveImm.length;
  const totalPaper  = paperStrat.length + paperImm.length;
  const totalActive = totalLive + totalPaper;

  // ── ORB service-down alert (toast every hour + persistent banner) ─────────
  const { serviceDown } = useOrbServiceAlert();

  // ── Trades awaiting confirm_entry approval — non-blocking cards (see
  // PendingConfirmationCard); TickerTape shows an "Awaiting Trade
  // Confirmation" banner from anywhere in the app while any of these exist.
  const { data: pendingConfirmations } = usePendingConfirmations();

  // ── Session risk state ────────────────────────────────────────────────────
  const haltedEngines = useMemo(() => {
    if (!sessionStates) return [];
    return Object.values(sessionStates).filter(e => e.session_halted);
  }, [sessionStates]);

  const sessionPnl = useMemo(() => {
    if (!sessionStates) return null;
    const vals = Object.values(sessionStates).map(e => e.session_pnl);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0);
  }, [sessionStates]);

  // ── Panel / exit state ────────────────────────────────────────────────────
  const [exitTarget, setExitTarget] = useState<ExitTarget | null>(null);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);

  // ── ORB notification modal ────────────────────────────────────────────────
  const [orbNotificationModalVisible, setOrbNotificationModalVisible] = useState(false);
  const [orbNotificationData, setOrbNotificationData] = useState<ORBBreakoutNotificationData | null>(null);
  const [orbNotificationTitle, setOrbNotificationTitle] = useState<string | undefined>();
  const [orbNotificationBody, setOrbNotificationBody]   = useState<string | undefined>();

  useEffect(() => {
    if (params.notificationData) {
      try {
        const data = JSON.parse(params.notificationData as string) as ORBBreakoutNotificationData;
        setOrbNotificationData(data);
        setOrbNotificationTitle(params.notificationTitle as string | undefined);
        setOrbNotificationBody(params.notificationBody as string | undefined);
        setOrbNotificationModalVisible(true);
        router.setParams({
          notificationData: undefined, notificationTitle: undefined, notificationBody: undefined,
        });
      } catch {}
    }
  }, [params.notificationData, params.notificationTitle, params.notificationBody, router]);

  // ─── Market prices ─────────────────────────────────────────────────────────
  const spyPrice = spy ?? livePrices['SPY'] ?? null;
  const iwmPrice = livePrices['IWM'] ?? null;
  const qqqPrice = livePrices['QQQ'] ?? null;
  const sentimentHex = sentiment
    ? (SENTIMENT_COLOR[sentiment.color] ?? colors.textSecondary)
    : colors.textSecondary;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refresh}
                          tintColor={colors.accent} colors={[colors.accent]} />
        }
        contentContainerStyle={styles.scroll}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        {/* No page title here — the "Dashboard" segment pill above already
            names this page (see feed.tsx's SegmentedPager). */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.screenDate, { color: colors.textTertiary }]}>{todayLabel()}</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.streamDot, {
              backgroundColor: connected ? '#30D158' : colors.textTertiary,
            }]} />
            <Text style={[styles.streamLabel, { color: colors.textTertiary }]}>
              {connected ? 'LIVE' : 'OFF'}
            </Text>
            {sessionPnl != null && (
              <View style={[styles.sessionPnlBadge, {
                backgroundColor: sessionPnl >= 0 ? '#30D15822' : '#FF453A22',
              }]}>
                <Text style={[styles.sessionPnlText, {
                  color: sessionPnl >= 0 ? '#30D158' : '#FF453A',
                }]}>
                  {sessionPnl >= 0 ? '+' : ''}${sessionPnl.toFixed(0)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── ORB service-down banner ──────────────────────────────────────── */}
        {serviceDown && (
          <View style={styles.serviceDownBanner}>
            <Ionicons name="radio-button-off" size={15} color="#fed7aa" />
            <Text style={styles.serviceDownText}>
              ORB service is not running — open Admin to start it
            </Text>
          </View>
        )}

        {/* ── Session halt banner ──────────────────────────────────────────── */}
        {haltedEngines.length > 0 && (
          <View style={styles.haltBanner}>
            <Ionicons name="warning" size={15} color="#fca5a5" />
            <Text style={styles.haltText}>
              Daily loss limit hit — {haltedEngines.map(e => e.ticker).join(', ')} halted
            </Text>
          </View>
        )}

        {/* ── Awaiting trade confirmation — non-blocking cards ─────────────── */}
        {pendingConfirmations != null && pendingConfirmations.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>
              AWAITING CONFIRMATION ({pendingConfirmations.length})
            </Text>
            {pendingConfirmations.map(p => (
              <PendingConfirmationCard key={p.id} pending={p} colors={colors} />
            ))}
          </>
        )}

        {/* ── Market ──────────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>MARKET</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tilesRow}>
          <MarketTile
            label="VIX"
            value={vix}
            formatValue={(n) => n.toFixed(2)}
            sub={sentiment?.label}
            accentColor={sentimentHex}
            colors={colors}
          />
          <MarketTile
            label="SPY"
            value={spyPrice}
            formatValue={(n) => `$${n.toFixed(2)}`}
            sub={orbSub('SPY', spyPrice)}
            accentColor={orbColor('SPY', spyPrice)}
            colors={colors}
            loading={orbLoading}
          />
          <MarketTile
            label="IWM"
            value={iwmPrice}
            formatValue={(n) => `$${n.toFixed(2)}`}
            sub={orbSub('IWM', iwmPrice)}
            accentColor={orbColor('IWM', iwmPrice)}
            colors={colors}
            loading={orbLoading}
          />
          <MarketTile
            label="QQQ"
            value={qqqPrice}
            formatValue={(n) => `$${n.toFixed(2)}`}
            sub={orbSub('QQQ', qqqPrice)}
            accentColor={orbColor('QQQ', qqqPrice)}
            colors={colors}
            loading={orbLoading}
          />
        </ScrollView>

        {/* ── Positions ───────────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>POSITIONS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Hidden trades (e.g. a contract that expired worthless) stay out
                of the list below by default — tap to reveal them; they only
                un-hide again via the Edit menu on the card itself. */}
            {hiddenCount > 0 && (
              <TouchableOpacity
                onPress={() => setShowHidden(v => !v)}
                activeOpacity={0.75}
                style={[styles.activeBadge, { backgroundColor: '#4A9EFF22' }]}
              >
                <Ionicons name="eye-off-outline" size={11} color="#4A9EFF" />
                <Text style={[styles.activeBadgeText, { color: '#4A9EFF' }]}>
                  {showHidden ? 'SHOWING HIDDEN' : `${hiddenCount} HIDDEN`}
                </Text>
              </TouchableOpacity>
            )}
            {totalActive > 0 && (
              <View style={[styles.activeBadge, { backgroundColor: colors.success + '22' }]}>
                <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.activeBadgeText, { color: colors.success }]}>
                  {totalActive} ACTIVE
                </Text>
              </View>
            )}
          </View>
        </View>

        {isLoading && totalActive === 0 ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
        ) : liveCombined.length === 0 && paperCombined.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="moon-outline" size={32} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Active Positions</Text>
            <Text style={[styles.emptySub, { color: colors.textTertiary }]}>
              Watching for the next ORB breakout
            </Text>
          </View>
        ) : (
          <>
            {/* ── LIVE positions ────────────────────────────── */}
            {liveCombined.length > 0 && (
              <>
                <View style={styles.modeSubHeader}>
                  <View style={[styles.modeSubDot, { backgroundColor: '#30D158' }]} />
                  <Text style={[styles.modeSubLabel, { color: '#30D158' }]}>LIVE</Text>
                  <Text style={[styles.modeSubCount, { color: colors.textTertiary }]}>
                    {liveCombined.length} {showHidden ? 'hidden' : 'active'}
                  </Text>
                </View>
                {liveCombined.map(item => item.kind === 'strat' ? (
                  <StrategyPositionCard key={item.pos.strategy_id} pos={item.pos} colors={colors} onExit={setExitTarget} onAdd={setAddTarget} />
                ) : (
                  <ImmediatePositionCard key={item.pos.strategy_id} pos={item.pos} colors={colors} onExit={setExitTarget} onAdd={setAddTarget} />
                ))}
              </>
            )}

            {/* ── PAPER positions ───────────────────────────── */}
            {paperCombined.length > 0 && (
              <>
                <View style={[styles.modeSubHeader, liveCombined.length > 0 && { marginTop: 8 }]}>
                  <View style={[styles.modeSubDot, { backgroundColor: '#FF9F0A' }]} />
                  <Text style={[styles.modeSubLabel, { color: '#FF9F0A' }]}>PAPER</Text>
                  <Text style={[styles.modeSubCount, { color: colors.textTertiary }]}>
                    {paperCombined.length} {showHidden ? 'hidden' : 'active'}
                  </Text>
                </View>
                {paperCombined.map(item => item.kind === 'strat' ? (
                  <StrategyPositionCard key={item.pos.strategy_id} pos={item.pos} colors={colors} onExit={setExitTarget} onAdd={setAddTarget} />
                ) : (
                  <ImmediatePositionCard key={item.pos.strategy_id} pos={item.pos} colors={colors} onExit={setExitTarget} onAdd={setAddTarget} />
                ))}
              </>
            )}
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Exit modal ──────────────────────────────────────────────────── */}
      {exitTarget && (
        <ExitTradeModal
          visible
          colors={colors}
          strategyId={exitTarget.strategyId}
          ticker={exitTarget.ticker}
          contract={exitTarget.contract}
          qtyRemaining={exitTarget.qtyRemaining}
          paperMode={exitTarget.paperMode}
          onClose={() => {
            setExitTarget(null);
            refresh();
          }}
        />
      )}

      {/* ── Add-to-position modal ───────────────────────────────────────── */}
      {addTarget && (
        <AddContractModal
          visible
          colors={colors}
          strategyId={addTarget.strategyId}
          ticker={addTarget.ticker}
          contract={addTarget.contract}
          qtyHeld={addTarget.qtyHeld}
          entryPremium={addTarget.entryPremium}
          midPrice={addTarget.midPrice}
          paperMode={addTarget.paperMode}
          onClose={() => setAddTarget(null)}
        />
      )}

      {/* ── ORB notification modal ───────────────────────────────────────── */}
      <ORBNotificationModal
        visible={orbNotificationModalVisible}
        onClose={() => {
          setOrbNotificationModalVisible(false);
          setTimeout(() => {
            setOrbNotificationData(null);
            setOrbNotificationTitle(undefined);
            setOrbNotificationBody(undefined);
          }, 300);
        }}
        notificationData={orbNotificationData}
        notificationTitle={orbNotificationTitle}
        notificationBody={orbNotificationBody}
      />
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:          { flex: 1 },
  scroll:        { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },

  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
                   paddingVertical: 14 },
  screenTitle:   { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  screenDate:    { fontSize: 13, fontWeight: '500', marginTop: 2 },
  headerRight:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  streamDot:     { width: 6, height: 6, borderRadius: 3 },
  streamLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  sessionPnlBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  sessionPnlText:  { fontSize: 12, fontWeight: '700' },

  serviceDownBanner: { backgroundColor: '#78350f', borderRadius: 10, paddingHorizontal: 14,
                        paddingVertical: 10, flexDirection: 'row', alignItems: 'center',
                        gap: 8, marginBottom: 8 },
  serviceDownText:   { color: '#fed7aa', fontSize: 13, flex: 1 },

  haltBanner:    { backgroundColor: '#7f1d1d', borderRadius: 10, paddingHorizontal: 14,
                   paddingVertical: 10, flexDirection: 'row', alignItems: 'center',
                   gap: 8, marginBottom: 12 },
  haltText:      { color: '#fca5a5', fontSize: 13, flex: 1 },

  sectionTitle:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
                   textTransform: 'uppercase', marginBottom: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   marginTop: 20, marginBottom: 10 },
  activeBadge:   { flexDirection: 'row', alignItems: 'center', gap: 5,
                   borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  activeDot:     { width: 5, height: 5, borderRadius: 3 },
  activeBadgeText: { fontSize: 10, fontWeight: '700' },

  tilesRow:      { paddingBottom: 4, paddingRight: 4 },
  tile:          { borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14,
                   minWidth: 100, marginRight: 10 },
  tileLabel:     { fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
                   letterSpacing: 0.7, marginBottom: 6 },
  tileValue:     { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  tileSub:       { fontSize: 11, fontWeight: '600', marginTop: 4 },

  posCard:       { borderRadius: 14, borderWidth: 1, padding: 16, gap: 14, marginBottom: 12 },
  posHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  posTicker:     { fontSize: 17, fontWeight: '700', marginBottom: 3 },
  posContract:   { fontSize: 12, fontWeight: '500', marginBottom: 6 },
  posBadges:     { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  badge:         { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  badgeText:     { fontSize: 10, fontWeight: '700' },
  posPnl:        { fontSize: 22, fontWeight: '700' },
  posPnlPct:     { fontSize: 13, fontWeight: '600', marginTop: 2 },
  posMktVal:     { fontSize: 11, fontWeight: '500', marginTop: 2 },

  posLevels:     { flexDirection: 'row', justifyContent: 'space-between' },
  levelLabel:    { fontSize: 10, fontWeight: '600', marginBottom: 3 },
  levelValue:    { fontSize: 14, fontWeight: '600' },

  stageBar:      { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 2 },
  stageDot:      { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  stageLabel:    { fontSize: 10, fontWeight: '600' },
  stageValue:    { fontSize: 9, marginTop: 2 },

  actionsRow:    { flexDirection: 'row', gap: 8, marginTop: 2 },
  exitBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 10 },
  exitBtnText:   { fontSize: 13, fontWeight: '600' },
  addBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 10 },
  addBtnText:    { fontSize: 13, fontWeight: '600' },

  emptyCard:     { borderRadius: 14, borderWidth: 1, padding: 32,
                   alignItems: 'center', gap: 8 },
  emptyTitle:    { fontSize: 16, fontWeight: '600' },
  emptySub:      { fontSize: 13, textAlign: 'center' },

  // ── Mode sub-headers (LIVE / PAPER sections) ──
  modeSubHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  modeSubDot:    { width: 7, height: 7, borderRadius: 4 },
  modeSubLabel:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  modeSubCount:  { fontSize: 11, fontWeight: '500' },
});

export default DashboardScreen;
