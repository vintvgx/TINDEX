import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, SafeAreaView, LayoutAnimation, Platform, UIManager,
  StyleSheet, LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { TickerContractsModal } from '@/common/components/ticker/TickerContractsModal';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { Skeleton } from '@/common/components/ui/Skeleton';
import { AdvancedPriceChart, ChartReferenceLine, ChartWatchZone, ChartWatchDraft } from '@/common/components/ticker/AdvancedPriceChart';
import { ChartControlToggles } from '@/common/components/ticker/ChartControlToggles';
import { useCrosshairEnabled } from '@/hooks/useCrosshairEnabled';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { useChartInterval } from '@/hooks/useChartInterval';
import { useTickerORBRange } from '@/hooks/queries/orb/useTickerORBRange';
import { computeOrbRangeFromHistory } from '@/common/utils/orb/computeOrbRangeFromHistory';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useChartLiveStream } from '@/hooks/queries/ticker/useChartLiveStream';
import { useChartPriceSource } from '@/hooks/useChartPriceSource';
import { useUserORBFollows } from '@/hooks/mutations/ticker/tickerORB';
import { useLivePositionsData, LivePositionsBody } from '@/common/components/strategy/LivePositionsSection';
import type { AccountMode } from '@/common/components/strategy/LiveModeToggle';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useToast } from '@/common/components/ui/Toast';
import { useKeyLevels } from '@/hooks/queries/priceLevels/useKeyLevels';
import { useCreateKeyLevel } from '@/hooks/mutations/priceLevels/useCreateKeyLevel';
import { useCancelKeyLevel } from '@/hooks/mutations/priceLevels/useCancelKeyLevel';
import { useUpdateKeyLevel } from '@/hooks/mutations/priceLevels/useUpdateKeyLevel';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Always surface the major index ETFs right after open-position tickers,
// ahead of the rest of the followed list — they're the reference charts
// checked every session regardless of what's actively being traded, and
// the list's guaranteed floor when there are no positions/follows at all.
const PINNED_TICKERS = ['SPY', 'QQQ', 'IWM'];
// AdvancedPriceChart's own chrome OUTSIDE the `height` prop: the top row
// (mode toggle + date label, 26 + 6 margin) plus the period-picker row below
// the canvas (~12 margin + ~28 row), plus this screen's own ChartControlToggles
// row (30 + 8 margin) sitting above it. Subtracted from the measured flex
// area so the whole component fits without clipping or an inner scroll.
const CHART_CHROME_HEIGHT = 78 + 38;

/**
 * Charts tab — a TradingView-style full-screen chart, reached via its own
 * bottom tab (not a pushed/modal screen, so the docked tab bar — see
 * CustomTabBar.tsx — stays visible below it). Cycles through followed
 * tickers and tickers with an open position; an expandable bar right above
 * the tab bar shows/hides that ticker's open positions (reusing the exact
 * same live-position data/actions as position.tsx and PriceChartFullScreen
 * — LivePositionsSection.tsx — so Edit/Exit here is the real thing, not a
 * separate reimplementation).
 */
export default function ChartsScreen() {
  const colors = useThemeColors();
  const [contractsModalOpen, setContractsModalOpen] = useState(false);

  // ── Ticker list: open-position tickers, then SPY/QQQ/IWM, then followed (alphabetical) ──
  const allLive = useLivePositionsData('live');
  const allPaper = useLivePositionsData('paper');
  const { data: follows } = useUserORBFollows();

  const openPositionTickers = useMemo(() => {
    const tickers = new Set<string>();
    for (const p of allLive.filteredPositions) tickers.add(p.ticker.toUpperCase());
    for (const p of allPaper.filteredPositions) tickers.add(p.ticker.toUpperCase());
    return Array.from(tickers);
  }, [allLive.filteredPositions, allPaper.filteredPositions]);

  const tickerList = useMemo(() => {
    const pinned = PINNED_TICKERS.filter(t => !openPositionTickers.includes(t));
    const followed = new Set((follows ?? []).map(f => f.ticker.toUpperCase()));
    for (const t of openPositionTickers) followed.delete(t);
    for (const t of pinned) followed.delete(t);
    const rest = Array.from(followed).sort();
    return [...openPositionTickers, ...pinned, ...rest];
  }, [follows, openPositionTickers]);

  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  // A ticker reached via search (see handleSearchSelect below) might not be
  // followed or have an open position yet — prepend it so it's immediately
  // viewable and stays part of the swipe-cycle, instead of the selection
  // silently falling back to tickerList[0] because it isn't in the list.
  const effectiveTickerList = useMemo(
    () => (selectedTicker && !tickerList.includes(selectedTicker) ? [selectedTicker, ...tickerList] : tickerList),
    [selectedTicker, tickerList],
  );
  const activeTicker = selectedTicker && effectiveTickerList.includes(selectedTicker)
    ? selectedTicker
    : effectiveTickerList[0];

  // Swipe left/right on the identity header to cycle tickers — wraps
  // around at either end of effectiveTickerList.
  const goToTicker = useCallback((direction: 1 | -1) => {
    const idx = effectiveTickerList.indexOf(activeTicker);
    if (idx === -1) return;
    const nextIdx = (idx + direction + effectiveTickerList.length) % effectiveTickerList.length;
    setSelectedTicker(effectiveTickerList[nextIdx]);
  }, [effectiveTickerList, activeTicker]);

  const headerSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20]) // only claim clearly-horizontal drags
        .failOffsetY([-15, 15])   // let a mostly-vertical touch fall through
        .onEnd((e) => {
          'worklet';
          if (e.translationX <= -50) runOnJS(goToTicker)(1);
          else if (e.translationX >= 50) runOnJS(goToTicker)(-1);
        }),
    [goToTicker],
  );

  // Open-ended ticker lookup — unlike the quick-switch strip below (scoped
  // to followed/open-position tickers), not limited to that list — a
  // watched-but-not-followed ticker, or any arbitrary symbol, needs to be
  // reachable here too.
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Price + chart data for the active ticker ────────────────────────────
  const [period, setPeriod] = useState<PricePeriod>('1D');
  // Shares its persisted value with AdvancedPriceChart's own interval picker
  // via the same React-Query cache key (useChartInterval) — no prop
  // threading needed for the two to stay in sync.
  const { interval: chartInterval } = useChartInterval(period);
  const { data: tickerResponse, isLoading: tickerLoading } = useTickerQuery(activeTicker);
  const stockData = tickerResponse?.success ? tickerResponse.data : undefined;
  const { data: historyResponse, isLoading: historyLoading, isPlaceholderData: historyIsStale } = useTickerHistoryQuery(
    activeTicker, period, period === '1D' ? 30_000 : undefined, chartInterval,
  );
  const historyData = historyResponse?.data;
  // useTickerHistoryQuery's placeholderData:keepPreviousData is meant for a
  // smooth PERIOD switch within the same ticker (shows the prior period's
  // bars while the new one loads) — but the same masking kicks in on a
  // TICKER switch too, since that also changes the query key. Without this,
  // switching tickers would briefly render the PREVIOUS ticker's candles
  // under the new ticker's header (isPlaceholderData true, isLoading false)
  // — wrong-symbol data, not just a stale zoom. Folding isPlaceholderData
  // into the loading flag passed to the chart keeps the (now Skeleton-
  // animated) loading state up until the new ticker's real data lands.

  // Same ORB-band source PriceChartFullScreen uses: a real orb_ranges row if
  // one exists, else computed client-side from this chart's own 1D bars —
  // so the band shows for any ticker, not just ones an active strategy covers.
  const { data: orbData } = useTickerORBRange(activeTicker);
  const fallbackOrb = !orbData ? computeOrbRangeFromHistory(historyData) : null;
  const effectiveOrb = orbData
    ? { high: orbData.orb_high, low: orbData.orb_low }
    : fallbackOrb
      ? { high: fallbackOrb.orb_high, low: fallbackOrb.orb_low }
      : null;

  // Live price — the real-time per-ticker Alpaca stream when selected in
  // Profile (see useChartPriceSource; same wiring as PriceChartFullScreen),
  // falling back to the shared /ws/prices yfinance poll (useMarketStream —
  // stays subscribed regardless of source, same rationale as
  // PriceChartFullScreen: a bad Alpaca connection falls back instantly
  // instead of needing a fresh subscribe) or the last REST snapshot.
  const { source: chartPriceSource } = useChartPriceSource();
  const useAlpacaStream = chartPriceSource === 'alpaca';
  const chartStream = useChartLiveStream(activeTicker, useAlpacaStream);
  const { livePrices } = useMarketStream([activeTicker], { enabled: true });
  const alpacaUsable = useAlpacaStream && !chartStream.error && chartStream.price != null;
  const resolvedLivePrice = alpacaUsable ? chartStream.price! : livePrices[activeTicker] ?? stockData?.current_price;

  const dayRefPrice = (stockData?.current_price != null && stockData?.price_change != null)
    ? stockData.current_price - stockData.price_change
    : undefined;

  // Extended-hours session boundary lines (Pre-Market/Market Close/
  // Post-Market/Overnight) — 1D only, only once each session has actually
  // concluded (see yfinance_service._session_boundary_lines). Reuses the
  // same dashed reference-line rendering AdvancedPriceChart already has for
  // entry/TP/stop levels.
  const sessionReferenceLines: ChartReferenceLine[] | null = useMemo(() => {
    if (period !== '1D' || !historyData?.session_lines) return null;
    const sl = historyData.session_lines;
    const lines: ChartReferenceLine[] = [];
    if (sl.pre_market_close != null) {
      lines.push({ label: 'Pre-Market', price: sl.pre_market_close, color: colors.textSecondary, dash: '2,3' });
    }
    if (sl.market_close != null) {
      lines.push({ label: 'Market Close', price: sl.market_close, color: colors.text, dash: '2,3' });
    }
    if (sl.post_market_close != null) {
      lines.push({ label: 'Post-Market', price: sl.post_market_close, color: colors.textSecondary, dash: '2,3' });
    }
    if (sl.overnight_price != null) {
      lines.push({ label: 'Overnight', price: sl.overnight_price, color: colors.accent, dash: '2,3' });
    }
    return lines.length ? lines : null;
  }, [period, historyData?.session_lines, colors.textSecondary, colors.text, colors.accent]);
  const liveChange = (resolvedLivePrice != null && dayRefPrice != null)
    ? resolvedLivePrice - dayRefPrice
    : stockData?.price_change;
  const liveChangePercent = dayRefPrice
    ? ((liveChange ?? 0) / dayRefPrice) * 100
    : stockData?.price_change_percent;
  const displayPositive = (liveChange ?? 0) >= 0;
  const priceColor = displayPositive ? colors.success : colors.error;

  // ── Positions panel — collapsed by default, expands on tap ──────────────
  const [positionsMode, setPositionsMode] = useState<AccountMode>('live');
  const [expanded, setExpanded] = useState(false);
  const positionsData = useLivePositionsData(positionsMode, activeTicker);
  const positionsCounts = useMemo(() => ({
    live: allLive.filteredPositions.filter(p => p.ticker.toUpperCase() === activeTicker).length,
    paper: allPaper.filteredPositions.filter(p => p.ticker.toUpperCase() === activeTicker).length,
  }), [allLive.filteredPositions, allPaper.filteredPositions, activeTicker]);
  const totalPositionsForTicker = positionsCounts.live + positionsCounts.paper;

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  }, []);

  // ── Chart sizing — measured, not guessed, now that the tab bar is docked
  // and reserves its own space: this flex area IS exactly what's left. ────
  const [chartAreaHeight, setChartAreaHeight] = useState(0);
  const { enabled: crosshairEnabled, setEnabled: setCrosshairEnabled } = useCrosshairEnabled();
  const onChartAreaLayout = useCallback((e: LayoutChangeEvent) => {
    setChartAreaHeight(e.nativeEvent.layout.height);
  }, []);

  // ── Watch mode: draw a key price level directly on the chart ───────────
  // Same wiring as PriceChartFullScreen's — see AdvancedPriceChart's Watch
  // toggle. useKeyLevels has no per-ticker filter server-side, so it's
  // scoped down client-side here.
  const { authState: { user } } = useAuth();
  const toast = useToast();
  const { data: allKeyLevels } = useKeyLevels();
  const chartWatchZones: ChartWatchZone[] = (allKeyLevels ?? [])
    .filter(l => l.ticker === activeTicker && (l.status === 'watching' || l.status === 'confirmed'))
    .map(l => ({
      id: l.id, low: l.level_low, high: l.level_high, direction: l.direction,
      status: l.status as 'watching' | 'confirmed',
    }));

  // Every ticker with a live watch zone/price target — drives the orange dot
  // in TickerStrip (see the comment there for why it's a lower-precedence
  // signal than the green open-position dot).
  const watchTickers = useMemo(() => {
    const set = new Set<string>();
    for (const l of allKeyLevels ?? []) {
      if (l.status === 'watching' || l.status === 'confirmed') set.add(l.ticker.toUpperCase());
    }
    return set;
  }, [allKeyLevels]);

  const { mutateAsync: createKeyLevel } = useCreateKeyLevel();
  const handleWatchConfirm = async (draft: ChartWatchDraft): Promise<boolean> => {
    if (!user?.id) {
      toast.error('Not authenticated');
      return false;
    }
    try {
      await createKeyLevel({
        userId: user.id,
        ticker: activeTicker,
        direction: draft.direction,
        levelLow: draft.low,
        levelHigh: draft.high,
        source: 'self',
      });
      toast.success(
        draft.high - draft.low < 0.005
          ? `Watching ${activeTicker} $${draft.high.toFixed(2)}`
          : `Watching ${activeTicker} $${draft.low.toFixed(2)}–$${draft.high.toFixed(2)}`,
      );
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save the watch level');
      return false;
    }
  };

  // Delete a watch zone straight from the chart — AdvancedPriceChart already
  // confirmed with the user via its own Alert; this just does the actual
  // cancel (same soft-delete useCancelKeyLevel/KeyLevelsList.tsx uses).
  const { mutate: cancelKeyLevel } = useCancelKeyLevel();
  const handleDeleteWatchZone = (zoneId: string) => {
    cancelKeyLevel(zoneId, {
      onSuccess: () => toast.info('Watch zone removed'),
      onError: (e: Error) => toast.error(e.message || 'Failed to remove the watch level'),
    });
  };

  const { mutateAsync: updateKeyLevel } = useUpdateKeyLevel();
  const handleUpdateWatchZone = async (zoneId: string, draft: ChartWatchDraft): Promise<boolean> => {
    if (!user?.id) {
      toast.error('Not authenticated');
      return false;
    }
    try {
      await updateKeyLevel({
        levelId: zoneId,
        userId: user.id,
        direction: draft.direction,
        levelLow: draft.low,
        levelHigh: draft.high,
      });
      toast.success('Watch zone updated');
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update the watch level');
      return false;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Identity header — swipe left/right still cycles tickers as a bonus
          gesture, but the TickerStrip right below this is the primary,
          visible way to switch now. Tapping the ticker title opens open-
          ended search (not limited to tickerList's followed + open-position
          set — a ticker you only just watched a level on, or any arbitrary
          symbol, needs to be reachable here too; the strip's own trailing
          search chip does the same thing). */}
      <GestureDetector gesture={headerSwipeGesture}>
        <View style={s.headerRow}>
          {tickerLoading && !stockData ? (
            <Skeleton width={34} height={34} borderRadius={9} />
          ) : (
            <TickerLogo uri={stockData?.logo_url} ticker={activeTicker} size={34} borderRadius={9} />
          )}
          <View style={{ flex: 1, gap: 5 }}>
            <TouchableOpacity
              onPress={() => setSearchOpen(true)}
              hitSlop={8}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
            >
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>{activeTicker}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
            </TouchableOpacity>
            {tickerLoading && !stockData ? (
              <Skeleton width="60%" height={12} />
            ) : !!stockData?.company_name && (
              <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
                {stockData.company_name}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 5 }}>
            {resolvedLivePrice != null ? (
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>
                ${resolvedLivePrice.toFixed(2)}
              </Text>
            ) : (
              <Skeleton width={70} height={20} />
            )}
            {liveChange != null && liveChangePercent != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons
                  name="triangle"
                  size={9}
                  color={priceColor}
                  style={{ transform: [{ rotate: displayPositive ? '0deg' : '180deg' }] }}
                />
                <Text style={{ color: priceColor, fontSize: 12, fontWeight: '700' }}>
                  {displayPositive ? '+' : ''}{liveChange.toFixed(2)} ({liveChangePercent.toFixed(2)}%)
                </Text>
              </View>
            ) : (
              <Skeleton width={54} height={12} />
            )}
          </View>
        </View>
      </GestureDetector>

      <View style={{ marginBottom: 8 }}>
        <TickerStrip
          tickers={effectiveTickerList}
          activeTicker={activeTicker}
          openPositionTickers={openPositionTickers}
          watchTickers={watchTickers}
          onSelect={setSelectedTicker}
          onSearchPress={() => setSearchOpen(true)}
          colors={colors}
        />
      </View>

      {/* Chart — fills whatever's left above the position bar. Keyed on the
          ticker so switching (swipe or picker) fully remounts it: a stale
          zoom/pan window from the PREVIOUS ticker's data would otherwise
          persist and show an arbitrary, no-longer-meaningful slice once the
          new ticker's data loads — a full reset guarantees the chart always
          renders its accurate default (auto-fit) view once data lands, not
          whatever window happened to be set for a different symbol. */}
      <View style={{ flex: 1, paddingHorizontal: 12 }} onLayout={onChartAreaLayout}>
        <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setContractsModalOpen(true)}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              height: 30, paddingHorizontal: 12, borderRadius: 15,
              borderWidth: 1, borderColor: colors.separator,
            }}
          >
            <Ionicons name="layers-outline" size={14} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>Contracts</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <ChartControlToggles
              colors={colors}
              toggles={[{
                key: 'crosshair',
                icon: 'locate-outline',
                active: crosshairEnabled,
                onPress: () => setCrosshairEnabled(!crosshairEnabled),
                label: 'Data Points',
                description: 'Tap-and-hold on the chart to inspect an exact price/time. Turn off to test whether it’s a source of lag while panning.',
              }]}
            />
          </View>
        </View>
        {chartAreaHeight > 0 && (
          <AdvancedPriceChart
            key={activeTicker}
            data={historyData}
            isLoading={historyLoading || historyIsStale}
            period={period}
            onPeriodChange={setPeriod}
            positive={displayPositive}
            height={Math.max(220, chartAreaHeight - CHART_CHROME_HEIGHT)}
            orbRange={effectiveOrb}
            showOrbRange
            livePrice={resolvedLivePrice ?? null}
            watchZones={chartWatchZones}
            onWatchConfirm={handleWatchConfirm}
            onDeleteWatchZone={handleDeleteWatchZone}
            onUpdateWatchZone={handleUpdateWatchZone}
            resetKey={activeTicker}
            sessionReferenceLines={sessionReferenceLines}
          />
        )}
      </View>

      {/* Position bar — right above the docked tab bar. Tapping it
          expands/collapses the position list; ticker switching now lives
          entirely in the strip above (see TickerStrip). */}
      <TouchableOpacity onPress={toggleExpanded} activeOpacity={0.8} style={[s.positionBar, { borderTopColor: colors.separator }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[s.tickerDot, { backgroundColor: totalPositionsForTicker > 0 ? colors.success : colors.tabBarInactive, width: 7, height: 7, borderRadius: 3.5 }]} />
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{activeTicker}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            {totalPositionsForTicker > 0
              ? `${totalPositionsForTicker} Position${totalPositionsForTicker === 1 ? '' : 's'} Open`
              : 'No Positions'}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textTertiary} />
      </TouchableOpacity>

      <SearchBottomSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectTicker={setSelectedTicker}
      />

      <TickerContractsModal
        ticker={activeTicker}
        visible={contractsModalOpen}
        onClose={() => setContractsModalOpen(false)}
        hasOptions={stockData?.has_options}
      />

      {expanded && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, maxHeight: 320 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 }}>
            <CompactModeToggle mode={positionsMode} onChange={setPositionsMode} colors={colors} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <LivePositionsBody
              data={positionsData}
              mode={positionsMode}
              colors={colors}
              emptyTitle={`No Open ${positionsMode === 'live' ? 'Live' : 'Paper'} Positions`}
              emptySubtitle={`Open ${activeTicker} positions will appear here.`}
              hideChartButton
            />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

/**
 * Quick ticker switcher — a persistent, horizontally-scrollable strip of
 * chips (logo + symbol) for every followed/open-position ticker, current one
 * highlighted, tap any to jump straight there. Replaces relying on the
 * header's tap-to-search (still there, but that's for an ARBITRARY symbol —
 * see the search chip at the end of this strip) and the old long-press-on-
 * the-position-bar picker (removed — this strip covers exactly the same
 * list, always visible instead of hidden behind a gesture nobody discovers).
 * A small green dot marks tickers with an open position, same signal the
 * old picker's own list used. A ticker with a live watch zone/price target
 * but no open position gets an orange dot instead — green always wins when
 * both apply, since an active trade is the more urgent signal. Auto-scrolls
 * to keep the active chip in view when it changes (swipe-header gesture,
 * position bar, or a chip tap).
 */
function TickerStrip({
  tickers, activeTicker, openPositionTickers, watchTickers, onSelect, onSearchPress, colors,
}: {
  tickers: string[];
  activeTicker: string;
  openPositionTickers: string[];
  watchTickers: Set<string>;
  onSelect: (t: string) => void;
  onSearchPress: () => void;
  colors: any;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const x = offsetsRef.current[activeTicker];
    if (x != null) {
      scrollRef.current?.scrollTo({ x: Math.max(0, x - 32), animated: true });
    }
  }, [activeTicker]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16 }}>
      {/* Fixed, NOT part of the scrolling content — stays put (and first)
          regardless of how far the chip strip is scrolled, per the ask that
          this be reachable without having to scroll back to find it. */}
      <TouchableOpacity
        onPress={onSearchPress}
        hitSlop={6}
        activeOpacity={0.75}
        style={{
          width: 28, height: 28, borderRadius: 14,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: colors.surfaceSecondary,
        }}
      >
        <Ionicons name="search" size={14} color={colors.textSecondary} />
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingRight: 16 }}
      >
        {tickers.map(t => {
          const active = t === activeTicker;
          const hasPosition = openPositionTickers.includes(t);
          const hasWatch = !hasPosition && watchTickers.has(t);
          return (
            <TouchableOpacity
              key={t}
              onPress={() => onSelect(t)}
              onLayout={(e) => { offsetsRef.current[t] = e.nativeEvent.layout.x; }}
              activeOpacity={0.75}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9,
                backgroundColor: active ? colors.text + '14' : 'transparent',
              }}
            >
              <TickerLogo ticker={t} size={16} />
              <Text style={{ fontSize: 12.5, fontWeight: active ? '800' : '600', color: active ? colors.text : colors.textSecondary }}>
                {t}
              </Text>
              {hasPosition && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.success }} />}
              {hasWatch && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#FF9F0A' }} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Live/Paper switch, sized for this screen specifically — the shared
 * LiveModeToggle (position.tsx/strategy.tsx/tradelog.tsx) is a full-height
 * bordered row with a dot + count badge per segment, which read as too much
 * chrome squeezed above the position list here. This drops the border, the
 * dot, and the count badge (the total's already shown in the collapsed
 * position bar above), keeping just two small text segments in a flat
 * tinted track — Robinhood-influenced: minimal, no border, color does the
 * talking.
 */
function CompactModeToggle({ mode, onChange, colors }: { mode: AccountMode; onChange: (m: AccountMode) => void; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: 8, padding: 2 }}>
      {(['live', 'paper'] as const).map(m => {
        const active = mode === m;
        const tint = m === 'live' ? '#30D158' : '#FF9F0A';
        return (
          <TouchableOpacity
            key={m}
            onPress={() => onChange(m)}
            activeOpacity={0.75}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 6,
              backgroundColor: active ? tint + '1F' : 'transparent',
            }}
          >
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: active ? tint : colors.textTertiary }}>
              {m === 'live' ? 'Live' : 'Paper'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  tickerDot: { width: 6, height: 6, borderRadius: 3 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 10,
    gap: 10,
  },
  positionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
