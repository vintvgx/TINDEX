import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, SafeAreaView,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useStrategyPositions, type PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';
import { useStrategySessionState } from '@/hooks/queries/strategy/useStrategySessionState';
import { useORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { useOrbServiceAlert } from '@/hooks/useOrbServiceAlert';
import { ExitTradeModal } from '@/common/components/strategy/ExitTradeModal';
import {
  ORBNotificationModal,
  type ORBBreakoutNotificationData,
} from '@/common/components/FEED/modals/ORBNotificationModal';
import { useQueryClient } from '@tanstack/react-query';
import type { ImmediatePosition } from '@/common/types/strategy';
import { formatContractSymbolShort, getTradeHorizon, TRADE_HORIZON_RANK } from '@/lib/formatContract';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { TickerLogo } from '@/common/components/ui/TickerLogo';

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
  label, value, sub, accentColor, colors,
}: { label: string; value: string; sub?: string; accentColor: string; colors: any }) {
  return (
    <View style={[styles.tile, { backgroundColor: accentColor + '12', borderColor: accentColor + '30' }]}>
      <Text style={[styles.tileLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.tileValue, { color: accentColor }]}>{value}</Text>
      {sub != null && (
        <Text style={[styles.tileSub, { color: accentColor + 'CC' }]}>{sub}</Text>
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

function StrategyPositionCard({
  pos, colors, onExit,
}: { pos: PositionEntry; colors: any; onExit: (t: ExitTarget) => void }) {
  const { toTicker } = useBaseNavigation();
  const pnl     = pos.unrealized_pnl ?? 0;
  const pnlPct  = pos.unrealized_pnl_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const dirColor = pos.direction === 'CALL' ? colors.success : colors.error;
  const isLive   = pos.paper_mode === false;

  const stages = [
    { label: 'Stop', value: pos.hard_stop,      active: !pos.tp1_hit && !pos.be_stop_active, color: colors.error },
    { label: 'BE',   value: pos.entry_premium,   active: !!pos.be_stop_active,                color: '#FF9F0A' },
    { label: 'TP1',  value: pos.tp1,             active: !!pos.tp1_hit && !pos.tp2_hit,       color: '#4A9EFF' },
    { label: 'TP2',  value: pos.tp2,             active: !!pos.tp2_hit,                       color: colors.success },
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
          {pos.current_price != null && pos.qty_remaining != null && (
            <Text style={[styles.posMktVal, { color: colors.textTertiary }]}>
              Mkt ${(pos.current_price * pos.qty_remaining * 100).toFixed(2)}
            </Text>
          )}
        </View>
      </View>

      {/* Entry / Current / Qty */}
      <View style={styles.posLevels}>
        {[
          { label: 'Entry',   value: fmtPrice(pos.entry_premium) },
          { label: 'Current', value: fmtPrice(pos.current_price), accent: true },
          { label: 'Qty',     value: `${pos.qty_remaining ?? '?'}/${pos.qty_total ?? '?'}` },
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

      {/* Exit button */}
      <TouchableOpacity
        onPress={() => onExit({
          strategyId:   pos.strategy_id,
          ticker:       pos.ticker,
          contract:     pos.contract,
          qtyRemaining: pos.qty_remaining ?? 0,
          paperMode:    pos.paper_mode !== false,
        })}
        style={[styles.exitBtn, { borderColor: colors.error + '88' }]}
      >
        <Ionicons name="close-circle-outline" size={16} color={colors.error} />
        <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit Position</Text>
      </TouchableOpacity>
    </View>
  );
}

function ImmediatePositionCard({
  pos, colors, onExit,
}: { pos: ImmediatePosition; colors: any; onExit: (t: ExitTarget) => void }) {
  const { toTicker } = useBaseNavigation();
  const pnl     = pos.pnl ?? 0;
  const pnlPct  = pos.pnl_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const dirColor = pos.direction === 'CALL' ? colors.success : colors.error;
  const isLive   = pos.paper_mode === false;

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
            <Text style={[styles.posTicker, { color: colors.text }]}>
              {PROFILE_EMOJI[pos.profile] ?? '📊'}
            </Text>
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
          {pos.mid_price != null && pos.qty_remaining != null && (
            <Text style={[styles.posMktVal, { color: colors.textTertiary }]}>
              Mkt ${(pos.mid_price * pos.qty_remaining * 100).toFixed(2)}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.posLevels}>
        {[
          { label: 'Entry',   value: fmtPrice(pos.entry_premium) },
          { label: 'Current', value: fmtPrice(pos.mid_price), accent: true },
          { label: 'Qty',     value: String(pos.qty_remaining ?? '?') },
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
          { label: 'Stop',  active: !pos.tp1_hit,                      color: colors.error },
          { label: 'TP1',   active: pos.tp1_hit && !pos.tp2_hit,        color: '#4A9EFF' },
          { label: 'TP2',   active: pos.tp2_hit,                        color: colors.success },
        ].map((s, i) => (
          <View key={i} style={{ alignItems: 'center', flex: 1 }}>
            <View style={[styles.stageDot, { backgroundColor: s.active ? s.color : colors.border }]} />
            <Text style={[styles.stageLabel, { color: s.active ? s.color : colors.textTertiary }]}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        onPress={() => onExit({
          strategyId:   pos.strategy_id,
          ticker:       pos.ticker,
          contract:     pos.contract,
          qtyRemaining: pos.qty_remaining ?? 0,
          paperMode:    pos.paper_mode !== false,
        })}
        style={[styles.exitBtn, { borderColor: colors.error + '88' }]}
      >
        <Ionicons name="close-circle-outline" size={16} color={colors.error} />
        <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit Position</Text>
      </TouchableOpacity>
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
  const { data: orbData } = useORBMonitoringState(false, false);
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

  // Combined + sorted so a swing trade never ranks above a 0DTE/weekly one —
  // sort is stable, so saved-strategy vs immediate order is otherwise
  // unchanged within the same horizon tier.
  type CombinedPos = { kind: 'strat'; pos: PositionEntry } | { kind: 'imm'; pos: ImmediatePosition };
  const byHorizon = (items: CombinedPos[]) =>
    [...items].sort((a, b) =>
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

        {/* ── Market ──────────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>MARKET</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tilesRow}>
          <MarketTile
            label="VIX"
            value={vix != null ? vix.toFixed(2) : '—'}
            sub={sentiment?.label ?? '—'}
            accentColor={sentimentHex}
            colors={colors}
          />
          <MarketTile
            label="SPY"
            value={spyPrice != null ? `$${spyPrice.toFixed(2)}` : '—'}
            sub={orbSub('SPY', spyPrice)}
            accentColor={orbColor('SPY', spyPrice)}
            colors={colors}
          />
          <MarketTile
            label="IWM"
            value={iwmPrice != null ? `$${iwmPrice.toFixed(2)}` : '—'}
            sub={orbSub('IWM', iwmPrice)}
            accentColor={orbColor('IWM', iwmPrice)}
            colors={colors}
          />
          <MarketTile
            label="QQQ"
            value={qqqPrice != null ? `$${qqqPrice.toFixed(2)}` : '—'}
            sub={orbSub('QQQ', qqqPrice)}
            accentColor={orbColor('QQQ', qqqPrice)}
            colors={colors}
          />
        </ScrollView>

        {/* ── Positions ───────────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>POSITIONS</Text>
          {totalActive > 0 && (
            <View style={[styles.activeBadge, { backgroundColor: colors.success + '22' }]}>
              <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.activeBadgeText, { color: colors.success }]}>
                {totalActive} ACTIVE
              </Text>
            </View>
          )}
        </View>

        {isLoading && totalActive === 0 ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
        ) : totalActive === 0 ? (
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
            {totalLive > 0 && (
              <>
                <View style={styles.modeSubHeader}>
                  <View style={[styles.modeSubDot, { backgroundColor: '#30D158' }]} />
                  <Text style={[styles.modeSubLabel, { color: '#30D158' }]}>LIVE</Text>
                  <Text style={[styles.modeSubCount, { color: colors.textTertiary }]}>
                    {totalLive} active
                  </Text>
                </View>
                {liveCombined.map(item => item.kind === 'strat' ? (
                  <StrategyPositionCard key={item.pos.strategy_id} pos={item.pos} colors={colors} onExit={setExitTarget} />
                ) : (
                  <ImmediatePositionCard key={item.pos.strategy_id} pos={item.pos} colors={colors} onExit={setExitTarget} />
                ))}
              </>
            )}

            {/* ── PAPER positions ───────────────────────────── */}
            {totalPaper > 0 && (
              <>
                <View style={[styles.modeSubHeader, totalLive > 0 && { marginTop: 8 }]}>
                  <View style={[styles.modeSubDot, { backgroundColor: '#FF9F0A' }]} />
                  <Text style={[styles.modeSubLabel, { color: '#FF9F0A' }]}>PAPER</Text>
                  <Text style={[styles.modeSubCount, { color: colors.textTertiary }]}>
                    {totalPaper} active
                  </Text>
                </View>
                {paperCombined.map(item => item.kind === 'strat' ? (
                  <StrategyPositionCard key={item.pos.strategy_id} pos={item.pos} colors={colors} onExit={setExitTarget} />
                ) : (
                  <ImmediatePositionCard key={item.pos.strategy_id} pos={item.pos} colors={colors} onExit={setExitTarget} />
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

  exitBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 10, marginTop: 2 },
  exitBtnText:   { fontSize: 13, fontWeight: '600' },

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
