import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, SafeAreaView, LayoutAnimation, Platform, UIManager,
  StyleSheet, LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { Skeleton } from '@/common/components/ui/Skeleton';
import { AdvancedPriceChart, ChartWatchZone, ChartWatchDraft } from '@/common/components/ticker/AdvancedPriceChart';
import { TickerPickerOverlay } from '@/common/components/ticker/TickerPickerOverlay';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { useTickerORBRange } from '@/hooks/queries/orb/useTickerORBRange';
import { computeOrbRangeFromHistory } from '@/common/utils/orb/computeOrbRangeFromHistory';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useUserORBFollows } from '@/hooks/mutations/ticker/tickerORB';
import { useLivePositionsData, LivePositionsBody } from '@/common/components/strategy/LivePositionsSection';
import { LiveModeToggle, type AccountMode } from '@/common/components/strategy/LiveModeToggle';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useToast } from '@/common/components/ui/Toast';
import { useKeyLevels } from '@/hooks/queries/priceLevels/useKeyLevels';
import { useCreateKeyLevel } from '@/hooks/mutations/priceLevels/useCreateKeyLevel';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FALLBACK_TICKERS = ['SPY', 'QQQ', 'IWM'];
// AdvancedPriceChart's own chrome OUTSIDE the `height` prop: the top row
// (mode toggle + date label, 26 + 6 margin) plus the period-picker row below
// the canvas (~12 margin + ~28 row). Subtracted from the measured flex area
// so the whole component fits without clipping or an inner scroll.
const CHART_CHROME_HEIGHT = 78;

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

  // ── Ticker list: open-position tickers first, then followed (alphabetical) ──
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
    const followedOnly = Array.from(new Set((follows ?? []).map(f => f.ticker.toUpperCase())))
      .filter(t => !openPositionTickers.includes(t))
      .sort();
    const list = [...openPositionTickers, ...followedOnly];
    return list.length ? list : FALLBACK_TICKERS;
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

  // Long-press the active ticker (in the position bar) to open the
  // TradingView-style scroll-to-select picker.
  const [pickerVisible, setPickerVisible] = useState(false);
  // Open-ended ticker lookup — unlike the picker above, not limited to
  // followed/open-position tickers (see the user's actual ask: a watched-
  // but-not-followed ticker, or any arbitrary symbol, needs to be reachable
  // here too).
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Price + chart data for the active ticker ────────────────────────────
  const [period, setPeriod] = useState<PricePeriod>('1D');
  const { data: tickerResponse, isLoading: tickerLoading } = useTickerQuery(activeTicker);
  const stockData = tickerResponse?.success ? tickerResponse.data : undefined;
  const { data: historyResponse, isLoading: historyLoading, isPlaceholderData: historyIsStale } = useTickerHistoryQuery(
    activeTicker, period, period === '1D' ? 30_000 : undefined,
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

  // Live price — same shared /ws/prices stream (useMarketStream) the ticker
  // tape and watchlists already use; the dedicated per-ticker Alpaca stream
  // (useChartLiveStream) is intentionally NOT wired in here, matching
  // PriceChartFullScreen's own "force-disabled" choice (see its comment on
  // useAlpacaStream) rather than diverging from that established decision.
  const { livePrices } = useMarketStream([activeTicker], { enabled: true });
  const resolvedLivePrice = livePrices[activeTicker] ?? stockData?.current_price;

  const dayRefPrice = (stockData?.current_price != null && stockData?.price_change != null)
    ? stockData.current_price - stockData.price_change
    : undefined;
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Identity header — swipe left/right to cycle tickers; tap the ticker
          title to look up any symbol (not limited to tickerList's followed +
          open-position set — a ticker you only just watched a level on, or
          any arbitrary symbol, needs to be reachable here too). Long-press
          the ticker name in the position bar below opens the scroll-to-select
          picker instead. */}
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

      {/* Chart — fills whatever's left above the position bar. Keyed on the
          ticker so switching (swipe or picker) fully remounts it: a stale
          zoom/pan window from the PREVIOUS ticker's data would otherwise
          persist and show an arbitrary, no-longer-meaningful slice once the
          new ticker's data loads — a full reset guarantees the chart always
          renders its accurate default (auto-fit) view once data lands, not
          whatever window happened to be set for a different symbol. */}
      <View style={{ flex: 1, paddingHorizontal: 12 }} onLayout={onChartAreaLayout}>
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
            resetKey={activeTicker}
          />
        )}
      </View>

      {/* Position bar — right above the docked tab bar. Long-press the
          ticker name to open the scroll-to-select picker (TradingView-
          style); tapping anywhere else expands/collapses the position list. */}
      <TouchableOpacity onPress={toggleExpanded} activeOpacity={0.8} style={[s.positionBar, { borderTopColor: colors.separator }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[s.tickerDot, { backgroundColor: totalPositionsForTicker > 0 ? colors.success : colors.tabBarInactive, width: 7, height: 7, borderRadius: 3.5 }]} />
          <TouchableOpacity
            onPress={toggleExpanded}
            onLongPress={() => setPickerVisible(true)}
            delayLongPress={350}
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          >
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{activeTicker}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            {totalPositionsForTicker > 0
              ? `${totalPositionsForTicker} Position${totalPositionsForTicker === 1 ? '' : 's'} Open`
              : 'No Positions'}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textTertiary} />
      </TouchableOpacity>

      <TickerPickerOverlay
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        tickers={effectiveTickerList}
        activeTicker={activeTicker}
        openPositionTickers={openPositionTickers}
        onSelect={setSelectedTicker}
      />

      <SearchBottomSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectTicker={setSelectedTicker}
      />

      {expanded && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, maxHeight: 320 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 }}>
            <LiveModeToggle mode={positionsMode} onChange={setPositionsMode} counts={positionsCounts} colors={colors} />
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
