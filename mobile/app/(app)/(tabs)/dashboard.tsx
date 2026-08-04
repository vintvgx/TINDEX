import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, SafeAreaView,
  ActivityIndicator, RefreshControl, StyleSheet,
  LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useThemeColors } from '@/lib/useColorScheme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { Skeleton } from '@/common/components/ui/Skeleton';
import { useStrategySessionState } from '@/hooks/queries/strategy/useStrategySessionState';
import { usePendingConfirmations } from '@/hooks/queries/strategy/usePendingConfirmations';
import { PendingConfirmationCard } from '@/common/components/strategy/PendingConfirmationCard';
import { useCandidateBreakouts } from '@/hooks/queries/strategy/useCandidateBreakouts';
import { CandidateBreakoutCard } from '@/common/components/strategy/CandidateBreakoutCard';
import { useLivePositionsData, LivePositionsBody } from '@/common/components/strategy/LivePositionsSection';
import { useFloatingTabBarHeight } from '@/common/components/ui/CustomTabBar';
import { useORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { useOrbServiceAlert } from '@/hooks/useOrbServiceAlert';
import {
  ORBNotificationModal,
  type ORBBreakoutNotificationData,
} from '@/common/components/FEED/modals/ORBNotificationModal';
import { useQueryClient } from '@tanstack/react-query';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WATCHED_TICKERS = ['SPY', 'IWM', 'QQQ'];

const SENTIMENT_COLOR: Record<string, string> = {
  green:  '#30D158',
  gray:   '#8E8E93',
  yellow: '#FFD60A',
  orange: '#FF9F0A',
  red:    '#FF453A',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
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

// Position cards previously lived here as Dashboard-only components
// (StrategyPositionCard/ImmediatePositionCard) that silently drifted out of
// sync with the Live Positions tab's own cards — different fields, no SL/TP
// dropdown, bunched-up buttons. Removed in favor of the shared
// LivePositionsSection.tsx components (useLivePositionsData +
// LivePositionsBody), the same ones position.tsx/accounts_overview.tsx/
// PriceChartFullScreen already use — one card design, everywhere, always in
// sync (2026-07-30 redesign).

// ─── Main Screen ─────────────────────────────────────────────────────────────

const DashboardScreen = () => {
  const colors = useThemeColors();
  const params = useLocalSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Data ──────────────────────────────────────────────────────────────────
  // Live/Paper positions — same shared fetch+filter+hidden-trades logic as
  // position.tsx/accounts_overview.tsx/PriceChartFullScreen (see
  // LivePositionsSection.tsx), so this screen can never drift out of sync
  // with what those show for the same trade.
  const livePositions  = useLivePositionsData('live');
  const paperPositions = useLivePositionsData('paper');
  const totalActive = livePositions.filteredPositions.length + paperPositions.filteredPositions.length;
  const isLoading = livePositions.isLoading || paperPositions.isLoading;

  // Tickers with an active LIVE option position — shown as their own Market
  // tiles ahead of the default watchlist (VIX always stays first). Only
  // live (not paper) per the request. Deduped, and the market stream needs
  // to actually subscribe to these too (it only knew about WATCHED_TICKERS
  // otherwise) so a ticker like TSLA that isn't already on the default
  // watchlist still gets a live price.
  const activeLiveTickers = useMemo(() => {
    const set = new Set(livePositions.filteredPositions.map(p => p.ticker.toUpperCase()));
    return Array.from(set);
  }, [livePositions.filteredPositions]);
  const extraActiveTickers = useMemo(
    () => activeLiveTickers.filter(t => !WATCHED_TICKERS.includes(t)),
    [activeLiveTickers],
  );
  const marketStreamTickers = useMemo(
    () => Array.from(new Set([...WATCHED_TICKERS, ...activeLiveTickers])),
    [activeLiveTickers],
  );

  const { livePrices, vix, spy, sentiment, connected } = useMarketStream(marketStreamTickers);
  const { data: orbData, isLoading: orbLoading } = useORBMonitoringState(false, false);
  const { data: sessionStates } = useStrategySessionState();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['strategy-positions'] });
    queryClient.invalidateQueries({ queryKey: ['immediate-positions'] });
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

  // ── ORB service-down alert (toast every hour + persistent banner) ─────────
  const { serviceDown } = useOrbServiceAlert();

  // ── Trades awaiting confirm_entry approval — non-blocking cards (see
  // PendingConfirmationCard); TickerTape shows an "Awaiting Trade
  // Confirmation" banner from anywhere in the app while any of these exist.
  const { data: pendingConfirmations } = usePendingConfirmations();

  // ── Candidate breakouts — live-only, pre-confirmation preview cards. See
  // useCandidateBreakouts's own docstring for the full state machine; a
  // candidate here and a real pendingConfirmations row above are mutually
  // exclusive for the same strategy (the hook excludes anything that's
  // already graduated to a real pending row).
  const { candidates: candidateBreakouts, handleSkip: handleSkipCandidate } = useCandidateBreakouts();
  const pendingSectionCount = (pendingConfirmations?.length ?? 0) + candidateBreakouts.length;

  // ── Collapse toggles — Positions/Pending share the same chevron +
  // LayoutAnimation pattern LivePositionPanel already uses elsewhere in the
  // app; both default open since these are the time-sensitive items on this
  // screen, not something to hide by default.
  const [positionsExpanded, setPositionsExpanded] = useState(true);
  const [pendingExpanded, setPendingExpanded] = useState(true);
  const togglePositions = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPositionsExpanded(v => !v);
  };
  const togglePending = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPendingExpanded(v => !v);
  };

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
  const tabBarHeight = useFloatingTabBarHeight();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refresh}
                          tintColor={colors.accent} colors={[colors.accent]} />
        }
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight }]}
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
            value={vix}
            formatValue={(n) => n.toFixed(2)}
            sub={sentiment?.label}
            accentColor={sentimentHex}
            colors={colors}
          />
          {extraActiveTickers.map(ticker => (
            <MarketTile
              key={ticker}
              label={ticker}
              value={livePrices[ticker] ?? null}
              formatValue={(n) => `$${n.toFixed(2)}`}
              sub={orbSub(ticker, livePrices[ticker] ?? null)}
              accentColor={orbColor(ticker, livePrices[ticker] ?? null)}
              colors={colors}
            />
          ))}
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

        {/* ── Pending & Awaiting Confirmation — candidate breakouts (live-only,
            pre-confirmation preview) above real pending-confirmation cards.
            Renders nothing at all, not even a header, when both are empty —
            this section only exists while something is actually being
            tracked, never as a permanent empty-state fixture. ── */}
        {pendingSectionCount > 0 && (
          <>
            <TouchableOpacity onPress={togglePending} activeOpacity={0.7} style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>
                  PENDING &amp; AWAITING CONFIRMATION
                </Text>
                <Ionicons
                  name={pendingExpanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={colors.textTertiary}
                />
              </View>
              <View style={[styles.activeBadge, { backgroundColor: '#F59E0B22' }]}>
                <View style={[styles.activeDot, { backgroundColor: '#F59E0B' }]} />
                <Text style={[styles.activeBadgeText, { color: '#F59E0B' }]}>
                  {pendingSectionCount}
                </Text>
              </View>
            </TouchableOpacity>

            {pendingExpanded && (
              <>
                {candidateBreakouts.map(c => (
                  <CandidateBreakoutCard
                    key={c.key}
                    candidate={c}
                    colors={colors}
                    onSkip={() => handleSkipCandidate(c)}
                  />
                ))}
                {(pendingConfirmations ?? []).map(p => (
                  <PendingConfirmationCard key={p.id} pending={p} colors={colors} />
                ))}
              </>
            )}
          </>
        )}

        {/* ── Positions — same shared cards as Live Positions/Accounts/
            PriceChartFullScreen (see LivePositionsSection.tsx): Edit/Add/Exit
            + the SL/TP dropdown, identical everywhere, always in sync. Each
            mode section renders its own hidden-trades banner internally. ── */}
        <TouchableOpacity onPress={togglePositions} activeOpacity={0.7} style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>POSITIONS</Text>
            <Ionicons
              name={positionsExpanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textTertiary}
            />
          </View>
          {totalActive > 0 && (
            <View style={[styles.activeBadge, { backgroundColor: colors.success + '22' }]}>
              <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.activeBadgeText, { color: colors.success }]}>
                {totalActive} ACTIVE
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {positionsExpanded && (
          isLoading && totalActive === 0 ? (
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
              {livePositions.filteredPositions.length > 0 && (
                <>
                  <View style={styles.modeSubHeader}>
                    <View style={[styles.modeSubDot, { backgroundColor: '#30D158' }]} />
                    <Text style={[styles.modeSubLabel, { color: '#30D158' }]}>LIVE</Text>
                    <Text style={[styles.modeSubCount, { color: colors.textTertiary }]}>
                      {livePositions.filteredPositions.length} active
                    </Text>
                  </View>
                  <LivePositionsBody data={livePositions} mode="live" colors={colors} />
                </>
              )}

              {/* ── PAPER positions ───────────────────────────── */}
              {paperPositions.filteredPositions.length > 0 && (
                <>
                  <View style={[styles.modeSubHeader, livePositions.filteredPositions.length > 0 && { marginTop: 8 }]}>
                    <View style={[styles.modeSubDot, { backgroundColor: '#FF9F0A' }]} />
                    <Text style={[styles.modeSubLabel, { color: '#FF9F0A' }]}>PAPER</Text>
                    <Text style={[styles.modeSubCount, { color: colors.textTertiary }]}>
                      {paperPositions.filteredPositions.length} active
                    </Text>
                  </View>
                  <LivePositionsBody data={paperPositions} mode="paper" colors={colors} />
                </>
              )}
            </>
          )
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

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
