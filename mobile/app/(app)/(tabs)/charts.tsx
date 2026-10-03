import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, SafeAreaView, LayoutAnimation, Platform, UIManager,
  LayoutChangeEvent, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { TickerContractsModal } from '@/common/components/ticker/TickerContractsModal';
import { AdvancedPriceChart, ChartReferenceLine, ChartWatchZone, ChartWatchDraft, ChartAutoZone } from '@/common/components/ticker/AdvancedPriceChart';
import { TVChart } from '@/common/components/ticker/TVChart';
import { ZoneDetailSheet } from '@/common/components/ticker/ZoneDetailSheet';
import { ChartBottomToolbar } from '@/common/components/ticker/ChartBottomToolbar';
import { PositionsPager } from '@/common/components/ticker/PositionsPager';
import { TechnicalsSheet } from '@/common/components/ticker/TechnicalsSheet';
import { OptionsPositioningPanel } from '@/common/components/ticker/brief/TickerBrief';
import { useChartSettings } from '@/common/components/ticker/useChartSettings';
import { useChartTape } from '@/common/components/ui/ChartTapeContext';
import { useChartAutoZones } from '@/hooks/queries/technicals/useTickerZones';
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
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import type { UseLivePositionsDataResult } from '@/common/components/strategy/LivePositionsSection';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { useHiddenPositions } from '@/hooks/useHiddenPositions';
import { positionHideKey } from '@/lib/positionHideKey';
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
// Chart chrome above the canvas (contracts row, control toggles, technicals
// strip, TV period pills) is MEASURED via onLayout (see chromeH), not
// hardcoded — new toolbar rows can't silently eat the plot anymore.

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
  // A tapped zone-alert push lands here with ?ticker= (see
  // NotificationNavigationService) — open that ticker's chart.
  const { ticker: tickerParam } = useLocalSearchParams<{ ticker?: string }>();
  useEffect(() => {
    if (tickerParam) setSelectedTicker(tickerParam.toUpperCase());
  }, [tickerParam]);

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

  // Open-ended ticker lookup — the wheel's tap target (not limited to the
  // followed + open-position set — a watched-but-not-followed ticker, or
  // any arbitrary symbol, needs to be reachable too).
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

  // ── Positions panel — collapsed by default, expands on tap. No more
  // Paper/Live toggle: both are always shown together for this ticker, live
  // trades first (they're the more urgent ones), followed by paper — each
  // already sorted by trade horizon within its own group. Built directly
  // from allLive/allPaper (already fetched, ticker-unfiltered, at the top
  // of this component) rather than a second pair of useLivePositionsData
  // calls, so this is just a re-filter of already-cached data, not a new
  // fetch. ──────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const positionsCounts = useMemo(() => ({
    live: allLive.filteredPositions.filter(p => p.ticker.toUpperCase() === activeTicker).length,
    paper: allPaper.filteredPositions.filter(p => p.ticker.toUpperCase() === activeTicker).length,
  }), [allLive.filteredPositions, allPaper.filteredPositions, activeTicker]);
  const totalPositionsForTicker = positionsCounts.live + positionsCounts.paper;

  const { isHidden } = useHiddenPositions();
  const [showHidden, setShowHidden] = useState(false);
  const [liveByStrategy, setLiveByStrategy] = useState<Record<string, LivePriceData>>({});
  const handlePositionLiveUpdate = useCallback((strategyId: string, data: LivePriceData | null) => {
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

  const positionsData: UseLivePositionsDataResult = useMemo(() => {
    const forTicker = (list: typeof allLive.filteredPositions) =>
      list.filter(p => p.ticker.toUpperCase() === activeTicker);
    const combined = [...forTicker(allLive.filteredPositions), ...forTicker(allPaper.filteredPositions)];
    const hidden = combined.filter(p => isHidden(positionHideKey(p)));
    const visible = combined.filter(p => !isHidden(positionHideKey(p)));
    return {
      isLoading: allLive.isLoading || allPaper.isLoading,
      filteredPositions: combined,
      displayedPositions: showHidden ? hidden : visible,
      hiddenCount: hidden.length,
      showHidden,
      setShowHidden,
      liveByStrategy,
      handleLiveUpdate: handlePositionLiveUpdate,
    };
  }, [
    allLive.filteredPositions, allPaper.filteredPositions, allLive.isLoading, allPaper.isLoading,
    activeTicker, isHidden, showHidden, liveByStrategy, handlePositionLiveUpdate,
  ]);

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  }, []);

  // ── Chart sizing — measured, not guessed, now that the tab bar is docked
  // and reserves its own space: this flex area IS exactly what's left. ────
  const [chartAreaHeight, setChartAreaHeight] = useState(0);
  // Every chart display option (style, technicals, session lines, watch
  // levels, data points) lives in the chart settings modal — see useChartSettings.
  const chart = useChartSettings({ ticker: activeTicker, period, colors, canMarkWatchLevel: true });
  // ZoneEngine's auto-detected support/resistance bands, same as the
  // full-screen chart — fetched only while "Auto-detected zones" is on.
  const { zones: autoZones, context: zoneContext } = useChartAutoZones(activeTicker, chart.showAutoZones);
  const onChartAreaLayout = useCallback((e: LayoutChangeEvent) => {
    setChartAreaHeight(e.nativeEvent.layout.height);
  }, []);

  // ── Chart engine (todo 0f4aaad3) ────────────────────────────────────
  // (zone-tap handlers live below, next to `toast` — TDZ otherwise)
  const { height: screenH } = useWindowDimensions();
  // TV/Legacy lives in the chart settings sheet now (persisted globally via
  // useChartDisplayPrefs) — defaults to the new TradingView chart.
  const useTVChart = chart.chartEngine !== 'legacy';
  // TVChart doesn't own its zone sheet the way AdvancedPriceChart does —
  // a tapped auto zone lands here and opens the shared ZoneDetailSheet.
  const [tvZoneSheetZone, setTvZoneSheetZone] = useState<ChartAutoZone | null>(null);

  // ── Watch mode: draw a key price level directly on the chart ───────────
  // Same wiring as PriceChartFullScreen's — see AdvancedPriceChart's Watch
  // toggle. useKeyLevels has no per-ticker filter server-side, so it's
  // scoped down client-side here.
  const { authState: { user } } = useAuth();
  const toast = useToast();
  // TVChart zone taps (declared here — after `toast` — to avoid a TDZ).
  const handleTVAutoZoneTap = useCallback((z: ChartAutoZone) => setTvZoneSheetZone(z), []);
  const handleTVWatchZoneTap = useCallback((z: ChartWatchZone) => {
    toast.info(`${activeTicker} $${z.low.toFixed(2)}–$${z.high.toFixed(2)}`);
  }, [activeTicker, toast]);
  const { data: allKeyLevels } = useKeyLevels();
  const chartWatchZones: ChartWatchZone[] = (allKeyLevels ?? [])
    .filter(l => l.ticker === activeTicker && (l.status === 'watching' || l.status === 'confirmed'))
    .map(l => ({
      id: l.id, low: l.level_low, high: l.level_high, direction: l.direction,
      status: l.status as 'watching' | 'confirmed', zoneType: l.zone_type ?? 'trade',
    }));

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
        zoneType: draft.zoneType,
      });
      toast.success(
        draft.high - draft.low < 0.005
          ? `${draft.zoneType === 'investment' ? 'Investment zone' : 'Watching'} ${activeTicker} $${draft.high.toFixed(2)}`
          : `${draft.zoneType === 'investment' ? 'Investment zone' : 'Watching'} ${activeTicker} $${draft.low.toFixed(2)}–$${draft.high.toFixed(2)}`,
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
        zoneType: draft.zoneType,
      });
      toast.success('Watch zone updated');
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update the watch level');
      return false;
    }
  };

  // ── Ticker tape headline — the old identity header (ticker, price,
  // day change) is gone; that info now lives in the global TickerTape via
  // ChartTapeContext while this tab is mounted. ──────────────────────────
  const { setInfo: setTapeInfo } = useChartTape();
  const tapeSignal = chart.technicals.data?.signal ?? null;
  useEffect(() => {
    setTapeInfo({
      ticker: activeTicker,
      price: resolvedLivePrice ?? null,
      change: liveChange ?? null,
      changePct: liveChangePercent ?? null,
      signal: tapeSignal,
      loading: tickerLoading && !stockData,
    });
    return () => setTapeInfo(null);
  }, [activeTicker, resolvedLivePrice, liveChange, liveChangePercent, tapeSignal, tickerLoading, stockData, setTapeInfo]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Chart — fills everything above the toolbar now that the identity
          header, ticker chips, and chrome rows are gone. Keyed on the
          ticker so switching fully remounts it (see the old comment). */}
      <View style={{ flex: 1, minHeight: screenH * 0.5, paddingHorizontal: 12, paddingTop: 8 }} onLayout={onChartAreaLayout}>
        {chartAreaHeight > 0 && (
          useTVChart ? (
            <TVChart
              key={activeTicker}
              style={{ flex: 1 }}
              data={historyData}
              isLoading={historyLoading || historyIsStale}
              autoZones={autoZones}
              watchZones={chartWatchZones}
              orbRange={effectiveOrb}
              showOrbRange={chart.showOrb && (period === '1D' || period === '1W')}
              sessionReferenceLines={sessionReferenceLines}
              showSessionLines={chart.chartSettings.showSessionLines}
              referenceLines={chart.referenceLines}
              livePrice={resolvedLivePrice ?? null}
              onAutoZoneTap={handleTVAutoZoneTap}
              onWatchZoneTap={handleTVWatchZoneTap}
              resetKey={`${activeTicker}:${period}`}
              emas={chart.emaOverlays}
            />
          ) : (
            <AdvancedPriceChart
              key={activeTicker}
              data={historyData}
              isLoading={historyLoading || historyIsStale}
              period={period}
              onPeriodChange={setPeriod}
              positive={displayPositive}
              height={Math.max(220, chartAreaHeight)}
              orbRange={effectiveOrb}
              showOrbRange={chart.showOrb}
              livePrice={resolvedLivePrice ?? null}
              watchZones={chartWatchZones}
              autoZones={autoZones}
              zoneContext={zoneContext}
              onWatchConfirm={handleWatchConfirm}
              onDeleteWatchZone={handleDeleteWatchZone}
              onUpdateWatchZone={handleUpdateWatchZone}
              resetKey={activeTicker}
              sessionReferenceLines={sessionReferenceLines}
              referenceLines={chart.referenceLines}
              settings={chart.chartSettings}
            />
          )
        )}
      </View>

      {/* Bottom toolbar — TradingView-style: ticker wheel + period slider
          fixed left, tool buttons scroll right. Hugs the chart. */}
      <ChartBottomToolbar
        tickers={effectiveTickerList}
        activeTicker={activeTicker}
        onSelectTicker={setSelectedTicker}
        onSearchPress={() => setSearchOpen(true)}
        period={period}
        onPeriodChange={setPeriod}
        technicalsContent={
          <TechnicalsSheet
            check={chart.technicals.data}
            isLoading={chart.technicals.isLoading}
            error={chart.technicals.error}
          />
        }
        positioningContent={<OptionsPositioningPanel ticker={activeTicker} />}
        settingsSections={chart.sections}
        onContractsPress={() => setContractsModalOpen(true)}
        onPositionsPress={toggleExpanded}
        openPositionCount={totalPositionsForTicker}
      />

      {/* Positions docked panel — expands below the toolbar, pushing the
          chart up (chart keeps its min-height guard). One card per page,
          swipe to paginate, LIVE/PAPER badge per card. */}
      {expanded && (
        <PositionsPager
          data={positionsData}
          ticker={activeTicker}
          onLiveUpdate={handlePositionLiveUpdate}
        />
      )}

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

      {/* Auto zone tapped in the TV chart — the legacy chart opens its
          own sheet internally; TVChart reports up here instead. */}
      <ZoneDetailSheet
        zone={tvZoneSheetZone}
        context={zoneContext}
        onClose={() => setTvZoneSheetZone(null)}
      />
    </SafeAreaView>
  );
}


