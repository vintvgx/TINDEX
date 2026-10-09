import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Pressable, LayoutAnimation, Platform, UIManager,
  LayoutChangeEvent, useWindowDimensions, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useChartDisplayPrefs } from '@/hooks/useChartDisplayPrefs';
import { useThemeColors } from '@/lib/useColorScheme';
import { TickerContractsModal } from '@/common/components/ticker/TickerContractsModal';
import { AdvancedPriceChart, ChartReferenceLine, ChartWatchZone, ChartWatchDraft, ChartAutoZone } from '@/common/components/ticker/AdvancedPriceChart';
import { TVChart } from '@/common/components/ticker/TVChart';
import { ZoneDetailSheet } from '@/common/components/ticker/ZoneDetailSheet';
import { ChartBottomToolbar } from '@/common/components/ticker/ChartBottomToolbar';
import { PositionsPager } from '@/common/components/ticker/PositionsPager';
import { TechnicalsSheet } from '@/common/components/ticker/TechnicalsSheet';
import { ChartTechnicalsStrip } from '@/common/components/ticker/ChartTechnicals';
import { OptionsPositioningPanel } from '@/common/components/ticker/brief/TickerBrief';
import { useChartSettings } from '@/common/components/ticker/useChartSettings';
import { useChartTape } from '@/common/components/ui/ChartTapeContext';
import type { ChartTapeInfo } from '@/common/components/ui/ChartTapeContext';
import { useChartAutoZones } from '@/hooks/queries/technicals/useTickerZones';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { useLazyTickerHistory } from '@/hooks/queries/ticker/useLazyTickerHistory';
import { useChartInterval, useSetChartIntervalFor } from '@/hooks/useChartInterval';
import type { TickerStatus } from '@/common/components/ticker/TickerWheel';
import { LiveAccountStrip } from '@/common/components/ticker/LiveAccountStrip';
import { useTickerORBRange } from '@/hooks/queries/orb/useTickerORBRange';
import { computeOrbRangeFromHistory } from '@/common/utils/orb/computeOrbRangeFromHistory';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useChartLiveStream } from '@/hooks/queries/ticker/useChartLiveStream';
import { useChartPriceSource } from '@/hooks/useChartPriceSource';
import { useUserORBFollows, setTickerORBFollow, invalidateORBFollowQueries } from '@/hooks/mutations/ticker/tickerORB';
import { useQueryClient } from '@tanstack/react-query';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import type { UseLivePositionsDataResult } from '@/common/components/strategy/LivePositionsSection';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { useHiddenPositions } from '@/hooks/useHiddenPositions';
import { positionHideKey } from '@/lib/positionHideKey';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useToast } from '@/common/components/ui/Toast';
import { useKeyLevels } from '@/hooks/queries/priceLevels/useKeyLevels';
import type { WatchedPriceLevel } from '@/common/types/priceLevels';
import { useCreateKeyLevel } from '@/hooks/mutations/priceLevels/useCreateKeyLevel';
import { useCancelKeyLevel } from '@/hooks/mutations/priceLevels/useCancelKeyLevel';
import { useUpdateKeyLevel } from '@/hooks/mutations/priceLevels/useUpdateKeyLevel';
import { useMorningBrief } from '@/hooks/queries/brief/useMorningBrief';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// The major index ETFs come right after position and watched-level
// tickers, ahead of the rest of the followed list — they're the reference
// charts checked every session, and the list's guaranteed floor when there
// are no positions/follows at all.
const PINNED_TICKERS = ['SPY', 'IWM', 'QQQ'];
// Chart chrome above the canvas (contracts row, control toggles, technicals
// strip, TV period pills) is MEASURED via onLayout (see chromeH), not
// hardcoded — new toolbar rows can't silently eat the plot anymore.

/**
 * Charts — a TradingView-style full-screen chart. Presented as a full-screen
 * overlay from the Chart tab-bar button (see ChartOverlayContext), and still
 * reachable as the `charts` route for deep links (?ticker=). Cycles through
 * followed tickers and tickers with an open position; an expandable bar
 * shows/hides that ticker's open positions (reusing the exact same
 * live-position data/actions as position.tsx — so Edit/Exit here is the
 * real thing, not a separate reimplementation).
 *
 * ChartsContent is the route-independent body; the default export is the
 * thin route wrapper that feeds ?ticker= in as initialTicker.
 */
export function ChartsContent({ initialTicker, topInset }: {
  initialTicker?: string | null;
  /** Override the top safe-area padding — 0 when rendered under the global
   *  ticker tape (the tape already clears the notch). */
  topInset?: number;
}) {
  const colors = useThemeColors();
  const [contractsModalOpen, setContractsModalOpen] = useState(false);

  // ── Ticker list, by priority: open positions (live, then paper-only) →
  // tickers with an active watch level → SPY/IWM/QQQ → followed
  // (alphabetical). Each ticker appears once, at its highest tier. ──────
  const allLive = useLivePositionsData('live');
  const allPaper = useLivePositionsData('paper');
  const { data: follows } = useUserORBFollows();
  const { data: allKeyLevels } = useKeyLevels();

  const liveTickers = useMemo(
    () => new Set(allLive.filteredPositions.map(p => p.ticker.toUpperCase())),
    [allLive.filteredPositions],
  );
  const paperTickers = useMemo(
    () => new Set(allPaper.filteredPositions.map(p => p.ticker.toUpperCase())),
    [allPaper.filteredPositions],
  );
  const watchedTickers = useMemo(() => {
    const set = new Set<string>();
    for (const l of allKeyLevels ?? []) {
      if (l.status === 'watching' || l.status === 'confirmed') set.add(l.ticker.toUpperCase());
    }
    return set;
  }, [allKeyLevels]);

  const tickerList = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (ts: Iterable<string>) => {
      for (const t of ts) if (!seen.has(t)) { seen.add(t); out.push(t); }
    };
    add(Array.from(liveTickers).sort());
    add(Array.from(paperTickers).sort());
    add(Array.from(watchedTickers).sort());
    add(PINNED_TICKERS);
    add((follows ?? []).map(f => f.ticker.toUpperCase()).sort());
    return out;
  }, [liveTickers, paperTickers, watchedTickers, follows]);

  // Letter-badge state for the ticker wheel (see TickerWheel's LetterBadge).
  const tickerStatus = useMemo(() => {
    const map: Record<string, TickerStatus> = {};
    for (const t of tickerList) {
      map[t] = {
        live: liveTickers.has(t),
        paper: paperTickers.has(t),
        watching: watchedTickers.has(t),
        pinned: PINNED_TICKERS.includes(t),
      };
    }
    return map;
  }, [tickerList, liveTickers, paperTickers, watchedTickers]);

  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  // A ticker opened from search or a deep link that isn't otherwise in the
  // list (not followed, no position/watch). Kept separately from the
  // selection: the old version prepended whatever was *selected*, so a
  // ticker you unfollowed while viewing it never left the list.
  const [adHocTicker, setAdHocTicker] = useState<string | null>(null);
  const openTicker = useCallback((t: string) => {
    const up = t.toUpperCase();
    setAdHocTicker(up);
    setSelectedTicker(up);
  }, []);
  // A tapped zone-alert push lands here with ?ticker= (see
  // NotificationNavigationService) — open that ticker's chart. The overlay
  // passes its ticker in as a prop instead of route params.
  useEffect(() => {
    if (initialTicker) openTicker(initialTicker);
  }, [initialTicker, openTicker]);

  // Last-viewed ticker, persisted (useChartDisplayPrefs.lastChartTicker):
  // the overlay unmounts on close, so without this every reopen fell back
  // to the top of the list. An explicit ticker (deep link / openChart(t))
  // wins over the stored one. Saving starts only after the restore ran, so
  // the first render's default (list[0]) never overwrites it.
  const { prefs: tickerPrefs, setPref: setTickerPref, loaded: tickerPrefsLoaded } = useChartDisplayPrefs();
  const restoredTicker = useRef(false);
  useEffect(() => {
    if (!tickerPrefsLoaded || restoredTicker.current) return;
    restoredTicker.current = true;
    if (!initialTicker && tickerPrefs.lastChartTicker) openTicker(tickerPrefs.lastChartTicker);
  }, [tickerPrefsLoaded, initialTicker, tickerPrefs.lastChartTicker, openTicker]);
  useEffect(() => {
    if (!restoredTicker.current || !selectedTicker) return;
    if (selectedTicker !== tickerPrefs.lastChartTicker) setTickerPref('lastChartTicker', selectedTicker);
  }, [selectedTicker, tickerPrefs.lastChartTicker, setTickerPref]);

  // Unfollowed anywhere (this toolbar's star, or the ticker sheet's star in
  // TickerDetailSheet — both refresh userORBFollows) → drop it from the
  // ad-hoc slot too, so it actually leaves the list.
  const prevFollowed = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set((follows ?? []).map(f => f.ticker.toUpperCase()));
    for (const t of prevFollowed.current) {
      if (!now.has(t)) setAdHocTicker(a => (a === t ? null : a));
    }
    prevFollowed.current = now;
  }, [follows]);

  // A searched-for ticker stays viewable and part of the swipe-cycle even
  // though it isn't followed / held / watched.
  const effectiveTickerList = useMemo(
    () => (adHocTicker && !tickerList.includes(adHocTicker) ? [adHocTicker, ...tickerList] : tickerList),
    [adHocTicker, tickerList],
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
  const { interval: chartInterval, setInterval: setChartInterval, allowed: allowedIntervals } = useChartInterval(period);
  const { data: tickerResponse, isLoading: tickerLoading } = useTickerQuery(activeTicker);
  const stockData = tickerResponse?.success ? tickerResponse.data : undefined;
  // ── Chart engine flag, early: the history source depends on it (lazy
  // backfill is a TVChart-only path; the legacy engine keeps the period
  // fetch). useChartSettings below reuses displayPrefs.
  const { prefs: displayPrefs, loaded: displayPrefsLoaded } = useChartDisplayPrefs();
  const useTVChart = displayPrefs.chartEngine !== 'legacy';

  // Tabs stay mounted when you switch away, so the 30s history poll, 15s
  // technicals refetch and zone queries would otherwise run forever in the
  // background, heating the phone. Keep them alive 30s after blur (in case
  // he's just peeking at another tab), then halt everything until refocus.
  const tabFocused = useIsFocused();
  const [chartLive, setChartLive] = useState(true);
  useEffect(() => {
    if (tabFocused) {
      setChartLive(true);
      return;
    }
    const t = setTimeout(() => setChartLive(false), 30_000);
    return () => clearTimeout(t);
  }, [tabFocused]);

  // Legacy engine's data — only when the legacy engine is actually showing.
  // Gated on chartLive alone, it fetched full history (and re-polled every
  // 30s on 1D) behind TVChart's back and threw it away: two /history calls
  // per Charts view (polling audit 2026-10-07, §3.7).
  const { data: legacyHistoryResponse, isLoading: legacyHistoryLoading, isPlaceholderData: legacyHistoryIsStale } = useTickerHistoryQuery(
    activeTicker, period, period === '1D' ? 30_000 : undefined, chartInterval, displayPrefs.showExtendedHours,
    chartLive && !useTVChart,
  );
  const legacyHistoryData = legacyHistoryResponse?.data;
  // Lazy history for the TV chart: the period is only the initial viewport,
  // older bars backfill as the user pans left.
  const lazyHistory = useLazyTickerHistory({
    ticker: activeTicker,
    period,
    interval: chartInterval,
    // Every intraday bar size, not just the 1D range — the hook ignores it
    // for daily+ bars. Live ticks (streamPrice → TVChart) move the forming
    // candle between polls; the poll brings in real volume/corrections.
    pollMs: 30_000,
    enabled: useTVChart && chartLive,
    extendedHours: displayPrefs.showExtendedHours,
  });
  const historyData = useTVChart ? lazyHistory.data : legacyHistoryData;
  const historyLoading = useTVChart ? lazyHistory.isLoading : legacyHistoryLoading;
  const historyIsStale = useTVChart ? false : legacyHistoryIsStale;
  // Staged loading: candles paint first, then the backend technicals (gate
  // strip, zones, walls) fire. One thundering herd on every ticker switch
  // is what made the chart feel strenuous — this staggers it.
  const technicalsGo = chartLive && !!historyData;
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
  const fallbackOrb = !orbData ? computeOrbRangeFromHistory(historyData ?? undefined) : null;
  const effectiveOrb = orbData
    ? { high: orbData.orb_high, low: orbData.orb_low }
    : fallbackOrb
      ? { high: fallbackOrb.orb_high, low: fallbackOrb.orb_low }
      : null;

  // Extended-hours session boundary lines (Pre-Market/Market Close/
  // Post-Market/Overnight) — 1D only, only once each session has actually
  // concluded (see yfinance_service._session_boundary_lines). Reuses the
  // same dashed reference-line rendering AdvancedPriceChart already has for
  // entry/TP/stop levels.
  const sessionReferenceLines: ChartReferenceLine[] | null = useMemo(() => {
    // Intraday views only (1D/1W) — the lines describe today's session.
    if ((period !== '1D' && period !== '1W') || !historyData?.session_lines) return null;
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
  // "Mark a watch level" drives AdvancedPriceChart's drag-to-mark mode —
  // TVChart has no equivalent yet, so the row only shows on the legacy
  // engine. The Signal & RSI strip renders right below the ticker tape.
  // (displayPrefs/useTVChart were hoisted above the history hooks.)
  const chart = useChartSettings({
    ticker: activeTicker, period, colors,
    canMarkWatchLevel: displayPrefs.chartEngine === 'legacy',
    technicalsGo,
    // The tape's signal pill reads chart.technicals — with the strip, VWAP
    // and EMA toggles all off (their defaults) the query never ran and the
    // pill silently disappeared.
    needSignal: true,
    hideStripRow: false,
    showDefaults: true,
    showCrosshairRow: displayPrefs.chartEngine === 'legacy',
  });

  // Defaults (Chart settings → Defaults) are both the launch state and a
  // live control: applied once the stored prefs are read, and again the
  // moment either default changes in the sheet. The toolbar chips still
  // switch freely in between — that only lasts until the next change here
  // or the next launch.
  const setIntervalFor = useSetChartIntervalFor();
  useEffect(() => {
    if (!displayPrefsLoaded) return;
    setIntervalFor(chart.defaultPeriod, chart.defaultInterval);
    setPeriod(chart.defaultPeriod);
  }, [displayPrefsLoaded, chart.defaultPeriod, chart.defaultInterval, setIntervalFor]);
  const tvMode = chart.chartSettings.mode ?? (period === '1D' || period === '1W' ? 'candle' : 'line');
  // The date range is only the TV chart's *initial viewport* now that
  // history lazy-loads — frame it in seconds after fit.
  const tvVisibleSeconds = useMemo(() => {
    switch (period) {
      case '1D': return 86_400;
      case '1W': return 7 * 86_400;
      case '1M': return 30 * 86_400;
      case '3M': return 90 * 86_400;
      case 'YTD': {
        const now = new Date();
        return Math.max(86_400, (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 1000);
      }
      case '1Y': return 365 * 86_400;
      case '5Y': return 5 * 365 * 86_400;
    }
  }, [period]);
  // ZoneEngine's auto-detected support/resistance bands, same as the
  // full-screen chart — fetched only while "Auto-detected zones" is on.
  const { zones: autoZones, context: zoneContext } = useChartAutoZones(activeTicker, chart.showAutoZones && technicalsGo);
  // Today's morning-brief play for this ticker (if any) draws its if/then
  // levels — trigger, target, invalid — alongside the chart's own lines.
  const { data: morningBrief } = useMorningBrief();
  const chartReferenceLines = useMemo<ChartReferenceLine[] | null>(() => {
    const play = morningBrief?.plays.find(p => p.ticker === activeTicker);
    if (!play) return chart.referenceLines ?? null;
    return [
      ...(chart.referenceLines ?? []),
      { label: 'Brief trigger', price: play.trigger, color: '#F59E0B', dash: '6,4' },
      { label: 'Brief target', price: play.target, color: colors.success, dash: '6,4' },
      { label: 'Brief invalid', price: play.invalidation, color: colors.error, dash: '2,4' },
    ];
  }, [morningBrief, activeTicker, chart.referenceLines, colors.success, colors.error]);
  const onChartAreaLayout = useCallback((e: LayoutChangeEvent) => {
    setChartAreaHeight(e.nativeEvent.layout.height);
  }, []);

  // ── Chart engine (todo 0f4aaad3) ────────────────────────────────────
  // (zone-tap handlers live below, next to `toast` — TDZ otherwise)
  const { height: screenH } = useWindowDimensions();
  // (useTVChart is hoisted above the history hooks.)
  // TVChart doesn't own its zone sheet the way AdvancedPriceChart does —
  // a tapped auto zone lands here and opens the shared ZoneDetailSheet.
  const [tvZoneSheetZone, setTvZoneSheetZone] = useState<ChartAutoZone | null>(null);

  // ── Watch mode: draw a key price level directly on the chart ───────────
  // Same wiring as PriceChartFullScreen's — see AdvancedPriceChart's Watch
  // toggle. useKeyLevels has no per-ticker filter server-side, so it's
  // scoped down client-side here.
  const { authState: { user } } = useAuth();
  const toast = useToast();

  // ── Follow / unfollow the active ticker (toolbar star) ─────────────────
  // Same write as TickerDetailSheet's star (setTickerORBFollow: flips
  // orb_enabled and stops ORB monitoring), so both stay in sync.
  const queryClient = useQueryClient();
  const isActiveFollowed = useMemo(
    () => (follows ?? []).some(f => f.ticker.toUpperCase() === activeTicker),
    [follows, activeTicker],
  );
  const [followBusy, setFollowBusy] = useState(false);
  const handleToggleFollow = useCallback(() => {
    if (!user?.id || !activeTicker || followBusy) return;
    const t = activeTicker;
    const run = async (follow: boolean) => {
      setFollowBusy(true);
      try {
        await setTickerORBFollow(user.id, t, follow);
        if (!follow) {
          // Move on to the next ticker, unless this one stays listed for
          // another reason (position / watch level / pinned index ETF).
          const st = tickerStatus[t];
          const staysListed = !!(st?.live || st?.paper || st?.watching || st?.pinned);
          if (!staysListed) {
            const idx = effectiveTickerList.indexOf(t);
            const rest = effectiveTickerList.filter(x => x !== t);
            if (rest.length) setSelectedTicker(rest[Math.min(Math.max(idx, 0), rest.length - 1)]);
            setAdHocTicker(a => (a === t ? null : a));
            toast.info(`Unfollowed ${t}`);
          } else {
            toast.info(`Unfollowed ${t} — still listed (open position, watch level, or index ETF)`);
          }
        } else {
          toast.success(`Following ${t}`);
        }
        invalidateORBFollowQueries(queryClient);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not update follow');
      } finally {
        setFollowBusy(false);
      }
    };
    if (!isActiveFollowed) {
      run(true);
      return;
    }
    Alert.alert(
      `Unfollow ${t}?`,
      'It will be removed from your chart list and ORB monitoring stops.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unfollow', style: 'destructive', onPress: () => run(false) },
      ],
    );
  }, [user?.id, activeTicker, followBusy, isActiveFollowed, tickerStatus, effectiveTickerList, toast, queryClient]);
  // TVChart zone taps (declared here — after `toast` — to avoid a TDZ).
  const handleTVAutoZoneTap = useCallback((z: ChartAutoZone) => setTvZoneSheetZone(z), []);
  const handleTVWatchZoneTap = useCallback((z: ChartWatchZone) => {
    // Tapping an alert line shows the "TICKER Crossing $X.XX" pill with a
    // delete option (TradingView-style) instead of the old toast.
    const level = (allKeyLevels ?? []).find(l => l.id === z.id) ?? null;
    setTappedAlert(level);
  }, [allKeyLevels]);
  const [tappedAlert, setTappedAlert] = useState<WatchedPriceLevel | null>(null);
  // Optimistic alert lines, TradingView-style — the line itself is the
  // confirmation (no toasts): a created alert draws the instant ⊕ is tapped,
  // a deleted one disappears the instant delete is confirmed. Both roll
  // back (with an error toast) if the write fails.
  const [pendingAlerts, setPendingAlerts] = useState<{ id: string; ticker: string; price: number }[]>([]);
  const [deletedAlertIds, setDeletedAlertIds] = useState<Set<string>>(() => new Set());
  const chartWatchZones: ChartWatchZone[] = useMemo(() => {
    const saved = (allKeyLevels ?? [])
      .filter(l => l.ticker === activeTicker && (l.status === 'watching' || l.status === 'confirmed'))
      .filter(l => !deletedAlertIds.has(l.id));
    const zones: ChartWatchZone[] = saved.map(l => ({
      id: l.id, low: l.level_low, high: l.level_high, direction: l.direction,
      status: l.status as 'watching' | 'confirmed', zoneType: l.zone_type ?? 'trade',
    }));
    for (const p of pendingAlerts) {
      if (p.ticker !== activeTicker) continue;
      // Drop the placeholder once the real level has arrived.
      if (saved.some(l => Math.abs(l.level_high - p.price) < 0.005 && Math.abs(l.level_low - p.price) < 0.005)) continue;
      zones.push({ id: p.id, low: p.price, high: p.price, direction: 'either', status: 'watching', zoneType: 'trade' });
    }
    return zones;
  }, [allKeyLevels, activeTicker, deletedAlertIds, pendingAlerts]);
  // Housekeeping: forget placeholders/deletions once the server agrees.
  useEffect(() => {
    const levels = allKeyLevels ?? [];
    setPendingAlerts(prev => {
      const next = prev.filter(p => !levels.some(l => l.ticker === p.ticker
        && Math.abs(l.level_high - p.price) < 0.005 && Math.abs(l.level_low - p.price) < 0.005));
      return next.length === prev.length ? prev : next;
    });
    setDeletedAlertIds(prev => {
      if (!prev.size) return prev;
      const live = new Set(levels.filter(l => l.status === 'watching' || l.status === 'confirmed').map(l => l.id));
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allKeyLevels]);

  const { mutateAsync: createKeyLevel } = useCreateKeyLevel();
  // Long-press on the TV chart resolved to a price — create a crossing alert
  // there. Direction 'either' = notify when a 1m bar closes through the
  // level from either side (TradingView's "Crossing" semantics).
  const handleAddAlertAtPrice = useCallback(async (price: number) => {
    if (!user?.id) {
      toast.error('Not authenticated');
      return;
    }
    const rounded = Math.round(price * 100) / 100;
    const pendingId = `pending-${Date.now()}`;
    setPendingAlerts(prev => [...prev, { id: pendingId, ticker: activeTicker, price: rounded }]);
    try {
      await createKeyLevel({
        userId: user.id,
        ticker: activeTicker,
        direction: 'either',
        levelLow: rounded,
        levelHigh: rounded,
        source: 'self',
        zoneType: 'trade',
      });
      // No toast — the line that just appeared is the confirmation.
    } catch (e) {
      setPendingAlerts(prev => prev.filter(p => p.id !== pendingId));
      toast.error(e instanceof Error ? e.message : 'Failed to set the alert');
    }
  }, [user?.id, activeTicker, createKeyLevel, toast]);
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
  const openContracts = useCallback(() => setContractsModalOpen(true), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  // The tape itself is published by ChartLivePane (it needs the live
  // price); this only feeds it the non-price fields.
  const isFocused = useIsFocused();

  // Top inset as padding; the BOTTOM inset is handed to the last element
  // (toolbar, or the positions pager when open) as its own padding, so its
  // background runs to the screen edge — a SafeAreaView left an empty band
  // under the toolbar, and that height now goes to the chart instead.
  const safeInsets = useSafeAreaInsets();
  // Mostly reclaimed: the bottom-most element (the live account strip) sits
  // just above the home indicator instead of leaving the full ~34px inset as
  // an empty band. The strip itself gives the ticker wheel thumb room above
  // the screen edge so vertical drags don't slide off.
  const bottomInset = Math.max(safeInsets.bottom - 26, 2);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: topInset ?? safeInsets.top }}>
      {/* Technicals strip — right below the global ticker tape, toggleable
          in Chart settings. */}
      {chart.showStrip && (
        <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
          <ChartTechnicalsStrip
            check={chart.technicals.data}
            isLoading={chart.technicals.isLoading}
            colors={colors}
          />
        </View>
      )}
      {/* Chart — fills everything above the toolbar now that the identity
          header, ticker chips, and chrome rows are gone. Keyed on the
          ticker so switching fully remounts it (see the old comment). */}
      <View style={{ flex: 1, minHeight: screenH * 0.5, paddingHorizontal: 12, paddingTop: 8 }} onLayout={onChartAreaLayout}>
        {chartAreaHeight > 0 && (
          <ChartLivePane
            ticker={activeTicker}
            stockData={stockData}
            tapeActive={isFocused}
            tapeSignal={tapeSignal}
            tapeLoading={tickerLoading && !stockData}
            onSignalPress={openContracts}
            onTickerPress={openSearch}
            setTapeInfo={setTapeInfo}
            renderChart={({ streamPrice, resolvedLivePrice, displayPositive }) => (
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
                  // Includes today's morning-brief play levels for this ticker.
                  referenceLines={chartReferenceLines}
                  livePrice={streamPrice}
                  onAutoZoneTap={handleTVAutoZoneTap}
                  onWatchZoneTap={handleTVWatchZoneTap}
                  resetKey={`${activeTicker}:${period}:${chartInterval}`}
                  emas={chart.emaOverlays}
                  mode={tvMode}
                  // Always on, like TradingView: press-and-hold shows the
                  // crosshair with its price + date/time labels. ("Data points"
                  // only applies to the legacy engine.)
                  crosshair
                  visibleSeconds={tvVisibleSeconds}
                  onRequestMoreHistory={lazyHistory.loadMore}
                  historyExhausted={lazyHistory.exhausted}
                  onAddAlertAtPrice={handleAddAlertAtPrice}
                />
              ) : (
                <AdvancedPriceChart
                  key={activeTicker}
                  data={historyData ?? undefined}
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
                  // Includes today's morning-brief play levels for this ticker.
                  referenceLines={chartReferenceLines}
                  settings={chart.chartSettings}
                />
              )
            )}
          />
        )}
        {/* Tapped alert line → TradingView-style pill with delete. */}
        {tappedAlert && (
          <View style={{ position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center' }} pointerEvents="box-none">
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 14, gap: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                {tappedAlert.ticker} Crossing {tappedAlert.level_high.toFixed(2)}
              </Text>
              <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border }} />
              <Pressable
                onPress={() => {
                  const id = tappedAlert.id;
                  setTappedAlert(null);
                  // Line disappears right away — that's the confirmation.
                  setDeletedAlertIds(prev => new Set(prev).add(id));
                  cancelKeyLevel(id, {
                    onError: (e: Error) => {
                      setDeletedAlertIds(prev => { const n = new Set(prev); n.delete(id); return n; });
                      toast.error(e.message || 'Failed to delete the alert');
                    },
                  });
                }}
                hitSlop={10}
                accessibilityLabel="Delete alert"
              >
                <Ionicons name="trash-outline" size={18} color={colors.text} />
              </Pressable>
              <Pressable onPress={() => setTappedAlert(null)} hitSlop={10} accessibilityLabel="Dismiss">
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Bottom toolbar — TradingView-style: ticker wheel + period slider
          fixed left, tool buttons scroll right. Hugs the chart. */}
      <ChartBottomToolbar
        tickers={effectiveTickerList}
        activeTicker={activeTicker}
        onSelectTicker={setSelectedTicker}
        onSearchPress={() => setSearchOpen(true)}
        isFollowed={isActiveFollowed}
        onToggleFollow={handleToggleFollow}
        period={period}
        onPeriodChange={setPeriod}
        interval={chartInterval}
        allowedIntervals={allowedIntervals}
        onIntervalChange={setChartInterval}
        technicalsContent={
          <TechnicalsSheet
            check={chart.technicals.data}
            isLoading={chart.technicals.isLoading}
            error={chart.technicals.error}
          />
        }
        positioningContent={<OptionsPositioningPanel ticker={activeTicker} />}
        settingsSections={chart.sections}
        onPositionsPress={toggleExpanded}
        openPositionCount={totalPositionsForTicker}
        tickerStatus={tickerStatus}
      />

      {/* Positions docked panel — expands below the toolbar, pushing the
          chart up (chart keeps its min-height guard). One card per page,
          swipe to paginate, LIVE/PAPER badge per card. */}
      {expanded && (
        <>
          <PositionsPager
            data={positionsData}
            ticker={activeTicker}
            onLiveUpdate={handlePositionLiveUpdate}
          />
        </>
      )}

      {/* Live account summary — always the bottom-most element. */}
      <LiveAccountStrip bottomInset={bottomInset} />

      <SearchBottomSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectTicker={openTicker}
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
    </View>
  );
}


/** Live values the chart engine needs — see ChartLivePane. */
interface ChartLiveValues {
  /** Streamed only (Alpaca, else /ws/prices) — never the REST snapshot,
   *  which can be minutes old and would paint a stale forming candle. */
  streamPrice: number | null;
  /** Streamed, else the REST snapshot (legacy engine + tape). */
  resolvedLivePrice: number | null;
  displayPositive: boolean;
}

const TAPE_PUBLISH_MS = 1_000;

/**
 * Owns the live price for the active ticker and renders the chart engine
 * through `renderChart`. Kept out of ChartsContent so a price update re-
 * renders only this pane and the engine — not the whole screen (toolbar,
 * positions, settings sections). Also publishes the global ticker tape,
 * with the price throttled to once a second.
 *
 * Price source: the real-time per-ticker Alpaca stream when selected in
 * Profile (useChartPriceSource), falling back to the shared /ws/prices feed
 * (useMarketStream — stays subscribed regardless of source, so a bad
 * Alpaca connection falls back instantly) or the last REST snapshot.
 */
function ChartLivePane({
  ticker, stockData, tapeActive, tapeSignal, tapeLoading, onSignalPress, onTickerPress, setTapeInfo, renderChart,
}: {
  ticker: string;
  stockData: { current_price?: number | null; price_change?: number | null; price_change_percent?: number | null } | undefined;
  tapeActive: boolean;
  tapeSignal: ChartTapeInfo['signal'];
  tapeLoading: boolean;
  onSignalPress: () => void;
  onTickerPress: () => void;
  setTapeInfo: (info: ChartTapeInfo | null) => void;
  renderChart: (live: ChartLiveValues) => React.ReactNode;
}) {
  const { source: chartPriceSource } = useChartPriceSource();
  const useAlpacaStream = chartPriceSource === 'alpaca';
  const chartStream = useChartLiveStream(ticker, useAlpacaStream);
  const { livePrices } = useMarketStream([ticker], { enabled: true });
  const alpacaUsable = useAlpacaStream && !chartStream.error && chartStream.price != null;
  const streamPrice = alpacaUsable ? chartStream.price! : livePrices[ticker] ?? null;
  const resolvedLivePrice = streamPrice ?? stockData?.current_price ?? null;

  const dayRefPrice = (stockData?.current_price != null && stockData?.price_change != null)
    ? stockData.current_price - stockData.price_change
    : undefined;
  const liveChange = (resolvedLivePrice != null && dayRefPrice != null)
    ? resolvedLivePrice - dayRefPrice
    : stockData?.price_change ?? null;
  const liveChangePercent = dayRefPrice
    ? ((liveChange ?? 0) / dayRefPrice) * 100
    : stockData?.price_change_percent ?? null;
  const displayPositive = (liveChange ?? 0) >= 0;

  // Tape price, throttled: the tape re-renders app-wide, so it gets at most
  // one price a second (trailing edge — the latest price always lands).
  const [tapePrice, setTapePrice] = useState<{ price: number | null; change: number | null; pct: number | null }>(
    { price: resolvedLivePrice, change: liveChange, pct: liveChangePercent },
  );
  const lastTapeAt = useRef(0);
  useEffect(() => {
    const next = { price: resolvedLivePrice, change: liveChange, pct: liveChangePercent };
    const wait = TAPE_PUBLISH_MS - (Date.now() - lastTapeAt.current);
    if (wait <= 0) {
      lastTapeAt.current = Date.now();
      setTapePrice(next);
      return;
    }
    const t = setTimeout(() => { lastTapeAt.current = Date.now(); setTapePrice(next); }, wait);
    return () => clearTimeout(t);
  }, [resolvedLivePrice, liveChange, liveChangePercent]);

  // Tabs stay mounted when you switch away, so unmount cleanup alone never
  // ran — the tape kept showing this chart's ticker on every other screen.
  // Publish only while focused; clear the moment it blurs.
  useEffect(() => {
    if (!tapeActive) {
      setTapeInfo(null);
      return;
    }
    setTapeInfo({
      ticker,
      price: tapePrice.price,
      change: tapePrice.change,
      changePct: tapePrice.pct,
      signal: tapeSignal,
      loading: tapeLoading,
      onSignalPress,
      onTickerPress,
    });
    return () => setTapeInfo(null);
  }, [tapeActive, ticker, tapePrice, tapeSignal, tapeLoading, onSignalPress, onTickerPress, setTapeInfo]);

  return <>{renderChart({ streamPrice, resolvedLivePrice, displayPositive })}</>;
}

/** Route wrapper — feeds ?ticker= deep links into ChartsContent. */
export default function ChartsScreen() {
  const { ticker: tickerParam } = useLocalSearchParams<{ ticker?: string }>();
  return <ChartsContent initialTicker={tickerParam ?? null} />;
}
