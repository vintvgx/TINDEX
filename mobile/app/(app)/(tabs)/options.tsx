import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOptionsQuery } from '@/hooks/queries/ticker/useOptionsQuery';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useUntrackContract } from '@/hooks/mutations/track/useUntrackContract';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';
import type { TrackedOptionContract } from '@/common/types/options';
import { useThemeColors } from '@/lib/useColorScheme';
import { OptionsContractDetailModal } from '@/common/components/ticker/OptionsContractDetailModal';
import { TrackedContractsList } from '@/common/components/options/TrackedContractsList';
import { useOptionsTicker } from '@/lib/optionsTickerContext';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useServicesStatus } from '@/hooks/queries/services/useServicesStatus';
import { useScoreContract } from '@/hooks/mutations/agent/useScoreContract';
import { useToast } from '@/common/components/ui/Toast';
import { FlowFeed } from '@/common/components/options/FlowFeed';

// ─── Types ───────────────────────────────────────────────────────────────────

type OptionSide = 'CALL' | 'PUT';
type DatePreset = '1W' | '2W' | '1M' | '3M';
type ScreenView = 'chain' | 'watchlist' | 'flow';

type TableRow =
  | { type: 'contract'; data: OptionsContract; isITM: boolean }
  | { type: 'separator'; price: number };

// ─── Constants ───────────────────────────────────────────────────────────────

const COL_WIDTHS = { strike: 70, bid: 56, ask: 56, last: 56, oi: 64 };

const ET_OPEN_SECS = (9 * 60 + 30) * 60;
const ET_CLOSE_SECS = 16 * 60 * 60;

const MOCK_STRIKES = [
  182.5, 185, 187.5, 190, 192.5, 195, 197.5,
  200, 202.5, 205, 207.5, 210, 212.5, 215, 217.5,
];
const MOCK_PRICE = 200.0;

const DATE_PRESETS: { label: string; id: DatePreset; days: number }[] = [
  { label: '1W', id: '1W', days: 7 },
  { label: '2W', id: '2W', days: 14 },
  { label: '1M', id: '1M', days: 30 },
  { label: '3M', id: '3M', days: 90 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toDateStr = (d: Date) => d.toISOString().split('T')[0];

const getDateRange = (preset: DatePreset): { gte: string; lte: string } => {
  const today = new Date();
  const lte = new Date(today);
  lte.setDate(today.getDate() + DATE_PRESETS.find(p => p.id === preset)!.days);
  return { gte: toDateStr(today), lte: toDateStr(lte) };
};

const formatExpiry = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${day}`;
};

const formatVol = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const formatCountdown = (secs: number): string => {
  const s = Math.max(Math.floor(secs), 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`;
};

const getMarketStatus = (): { isOpen: boolean; secondsUntilOpen: number } => {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const v = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0');
    const [year, month, day, hour, min, sec] =
      [v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')];

    const dow = new Date(year, month, day).getDay();
    const isWeekday = dow >= 1 && dow <= 5;
    const currentSecs = hour * 3600 + min * 60 + sec;
    const isOpen = isWeekday && currentSecs >= ET_OPEN_SECS && currentSecs < ET_CLOSE_SECS;

    if (isOpen) return { isOpen: true, secondsUntilOpen: 0 };

    const secsToMidnight = 24 * 3600 - currentSecs;
    let secsUntilOpen: number;

    if (isWeekday && currentSecs < ET_OPEN_SECS) {
      secsUntilOpen = ET_OPEN_SECS - currentSecs;
    } else {
      const daysAhead = dow === 5 ? 3 : dow === 6 ? 2 : dow === 0 ? 1 : 1;
      secsUntilOpen = secsToMidnight + (daysAhead - 1) * 86400 + ET_OPEN_SECS;
    }

    return { isOpen: false, secondsUntilOpen: Math.max(secsUntilOpen, 0) };
  } catch {
    return { isOpen: false, secondsUntilOpen: 0 };
  }
};

const makeMockData = (ticker: string) => {
  const now = new Date();
  const daysToFri = ((5 - now.getDay()) + 7) % 7 || 7;
  const fri1 = new Date(now); fri1.setDate(now.getDate() + daysToFri); fri1.setHours(0,0,0,0);
  const fri2 = new Date(fri1); fri2.setDate(fri1.getDate() + 7);

  const mkRow = (strike: number, type: 'CALL' | 'PUT', expiration: string): OptionsContract => {
    const dist = Math.abs(strike - MOCK_PRICE);
    const isITM = type === 'CALL' ? strike < MOCK_PRICE : strike > MOCK_PRICE;
    const intrinsic = isITM ? Math.abs(strike - MOCK_PRICE) : 0;
    const extrinsic = Math.max(4.5 - dist * 0.22, 0.05);
    const mark = parseFloat((intrinsic + extrinsic).toFixed(2));
    const spread = parseFloat(Math.max(mark * 0.035, 0.02).toFixed(2));
    const bid = parseFloat(Math.max(mark - spread / 2, 0.01).toFixed(2));
    const ask = parseFloat((bid + spread).toFixed(2));
    const oi = Math.max(Math.floor((12 - dist / 4) * 750), 150);
    return {
      ask, bid,
      delta: parseFloat(Math.min(Math.max(
        type === 'CALL' ? 0.5 - (strike - MOCK_PRICE) / MOCK_PRICE * 2.2
                        : -(0.5 + (strike - MOCK_PRICE) / MOCK_PRICE * 2.2),
        -0.99), 0.99).toFixed(3)),
      expiration,
      gamma: parseFloat(Math.max(0.04 - dist * 0.0018, 0.001).toFixed(4)),
      implied_volatility: parseFloat((0.21 + dist * 0.0035).toFixed(4)),
      last_price: mark,
      open_interest: oi,
      option_type: type,
      rho: type === 'CALL' ? 0.01 : -0.01,
      strike,
      symbol: `${ticker}${expiration.replace(/-/g,'').slice(2)}${type[0]}${String(Math.floor(strike * 1000)).padStart(8,'0')}`,
      theta: parseFloat((-0.018 - dist * 0.0008).toFixed(4)),
      ticker,
      timestamp: now.toISOString(),
      vega: parseFloat(Math.max(0.14 - dist * 0.003, 0.01).toFixed(4)),
      volume: Math.max(Math.floor(oi * 0.18), 20),
    };
  };

  const expirations = [toDateStr(fri1), toDateStr(fri2)];
  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  expirations.forEach(exp => {
    MOCK_STRIKES.forEach(s => {
      calls.push(mkRow(s, 'CALL', exp));
      puts.push(mkRow(s, 'PUT', exp));
    });
  });

  return { calls, puts, current_price: MOCK_PRICE, expirations_fetched: expirations };
};

// ─── Row builders ─────────────────────────────────────────────────────────────

const buildRows = (contracts: OptionsContract[], price: number, side: OptionSide): TableRow[] => {
  if (!price || contracts.length === 0) return [];
  if (side === 'CALL') {
    const sorted = [...contracts].sort((a, b) => b.strike - a.strike);
    return [
      ...sorted.filter(c => c.strike >= price).map(c => ({ type: 'contract' as const, data: c, isITM: false })),
      { type: 'separator' as const, price },
      ...sorted.filter(c => c.strike < price).map(c => ({ type: 'contract' as const, data: c, isITM: true })),
    ];
  }
  const sorted = [...contracts].sort((a, b) => a.strike - b.strike);
  return [
    ...sorted.filter(c => c.strike <= price).map(c => ({ type: 'contract' as const, data: c, isITM: false })),
    { type: 'separator' as const, price },
    ...sorted.filter(c => c.strike > price).map(c => ({ type: 'contract' as const, data: c, isITM: true })),
  ];
};

// ─── Chain loading skeleton ───────────────────────────────────────────────────

const BOX_H = 12;
const BOX_R = 4;

const ChainSkeleton: React.FC<{ colors: ReturnType<typeof useThemeColors> }> = ({ colors }) => {
  const pulse = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  const bg = colors.border;

  return (
    <Animated.View style={{ opacity: pulse }}>
      {Array.from({ length: 16 }).map((_, i) => {
        const isITM = i >= 6 && i <= 9;
        return (
          <View key={i} style={[skeletonStyles.row, {
            backgroundColor: isITM ? colors.surface : 'transparent',
            borderBottomColor: colors.separator,
          }]}>
            <View style={{ width: 8 }} />
            <View style={{ width: COL_WIDTHS.strike, height: BOX_H, borderRadius: BOX_R, backgroundColor: bg }} />
            <View style={{ width: COL_WIDTHS.bid,    height: BOX_H, borderRadius: BOX_R, backgroundColor: bg }} />
            <View style={{ width: COL_WIDTHS.ask,    height: BOX_H, borderRadius: BOX_R, backgroundColor: bg }} />
            <View style={{ width: COL_WIDTHS.last,   height: BOX_H, borderRadius: BOX_R, backgroundColor: bg }} />
            <View style={{ width: COL_WIDTHS.oi,     height: BOX_H, borderRadius: BOX_R, backgroundColor: bg }} />
            <View style={{ flex: 1,                  height: BOX_H, borderRadius: BOX_R, backgroundColor: bg }} />
          </View>
        );
      })}
    </Animated.View>
  );
};

const skeletonStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 4,
  },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

const OptionsScreen = () => {
  const colors = useThemeColors();
  const { authState: { user } } = useAuth();
  const { optionsTicker: activeTicker, setOptionsTicker } = useOptionsTicker();

  // View toggle
  const [view, setView] = useState<ScreenView>('watchlist');

  // Chain state
  const [side, setSide] = useState<OptionSide>('CALL');
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [useMockData, setUseMockData] = useState(false);
  const [useFlowMockData, setUseFlowMockData] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('1M');
  const [marketStatus, setMarketStatus] = useState(() => getMarketStatus());
  const prevTickerRef = useRef('');

  // Detail modal
  const [detailContract, setDetailContract] = useState<OptionsContract | null>(null);
  const [detailCurrentPrice, setDetailCurrentPrice] = useState(0);
  const [detailTrackedId, setDetailTrackedId] = useState<string | null>(null);
  const [detailTrackedPrice, setDetailTrackedPrice] = useState<number | null>(null);
  const [detailLiveContractPrice, setDetailLiveContractPrice] = useState<number | null>(null);

  // Service status (shared React Query cache — no extra network call if ORB screen is mounted)
  const { data: servicesStatus } = useServicesStatus();
  const isContractsRunning = servicesStatus?.contracts?.running ?? false;

  // Tracking hooks
  const trackContract = useTrackContract();
  const untrackContract = useUntrackContract();
  const scoreContract = useScoreContract();
  const { data: trackedContracts } = useTrackedContracts();
  const toast = useToast();

  // Live countdown
  useEffect(() => {
    const id = setInterval(() => setMarketStatus(getMarketStatus()), 1000);
    return () => clearInterval(id);
  }, []);

  // Reset expiry when ticker changes
  useEffect(() => {
    if (activeTicker !== prevTickerRef.current) {
      prevTickerRef.current = activeTicker;
      setSelectedExpiry(null);
    }
  }, [activeTicker]);

  const dateRange = useMemo(() => getDateRange(datePreset), [datePreset]);

  const { data: optionsData, isLoading, error } = useOptionsQuery(
    useMockData ? '' : activeTicker,
    activeTicker && !useMockData
      ? { limit: 100, expiration_date_gte: dateRange.gte, expiration_date_lte: dateRange.lte }
      : undefined,
    useMockData ? undefined : 5000,   // near real-time: refresh the chain every 5s
  );

  const mockData = useMemo(
    () => (activeTicker ? makeMockData(activeTicker) : null),
    [activeTicker],
  );

  const activeData = useMockData ? mockData : (optionsData?.success ? optionsData.data : null);

  const currentPrice = activeData?.current_price ?? 0;
  const expirations = useMemo(() => activeData?.expirations_fetched ?? [], [activeData]);

  useEffect(() => {
    if (expirations.length > 0 && !selectedExpiry) setSelectedExpiry(expirations[0]);
  }, [expirations, selectedExpiry]);

  const rawContracts = useMemo(() => {
    if (!activeData) return [];
    return side === 'CALL' ? activeData.calls : activeData.puts;
  }, [activeData, side]);

  const filtered = useMemo(
    () => selectedExpiry ? rawContracts.filter(c => c.expiration === selectedExpiry) : rawContracts,
    [rawContracts, selectedExpiry],
  );

  const rows = useMemo(() => buildRows(filtered, currentPrice, side), [filtered, currentPrice, side]);

  // ── Tracking helpers ────────────────────────────────────────────────────────

  const isContractTracked = useCallback(
    (symbol: string) => trackedContracts?.some(t => t.contract_symbol === symbol) ?? false,
    [trackedContracts],
  );

  const getTrackedId = useCallback(
    (symbol: string) => trackedContracts?.find(t => t.contract_symbol === symbol)?.id ?? null,
    [trackedContracts],
  );

  const asOpportunity = useCallback((c: OptionsContract) => ({
    ask: c.ask,
    bid: c.bid,
    contractSymbol: c.symbol,
    delta: c.delta,
    dte: 0,
    expirationDate: c.expiration,
    extrinsicValue: 0,
    gamma: c.gamma,
    impliedVolatility: c.implied_volatility ?? 0,
    intrinsicValue: 0,
    lastPrice: c.last_price ?? null,
    mark: (c.bid + c.ask) / 2,
    moneyness: 0,
    openInterest: c.open_interest,
    optionType: c.option_type,
    reasons: '',
    signal: 'CONSIDER' as const,
    spreadPct: c.ask > 0 ? ((c.ask - c.bid) / c.ask) * 100 : 0,
    strike: c.strike,
    theta: c.theta,
    total_score: 0,
    vega: c.vega,
    volume: c.volume,
  }), []);

  // Convert a tracked contract's snapshot into an OptionsOpportunity for the detail modal
  const trackedToOpportunity = useCallback((tc: TrackedOptionContract) => {
    const snap = (tc.tracking_snapshot ?? {}) as Record<string, any>;
    const bid = snap.bid ?? 0;
    const ask = snap.ask ?? 0;
    return {
      ask,
      bid,
      contractSymbol: tc.contract_symbol,
      delta: snap.delta ?? null,
      dte: snap.dte ?? 0,
      expirationDate: tc.expiration_date,
      extrinsicValue: snap.extrinsicValue ?? 0,
      gamma: snap.gamma ?? null,
      impliedVolatility: snap.impliedVolatility ?? snap.implied_volatility ?? 0,
      intrinsicValue: snap.intrinsicValue ?? 0,
      lastPrice: snap.lastPrice ?? snap.last_price ?? null,
      mark: snap.mark ?? (bid > 0 || ask > 0 ? (bid + ask) / 2 : 0),
      moneyness: snap.moneyness ?? 0,
      openInterest: snap.openInterest ?? snap.open_interest ?? 0,
      optionType: tc.option_type,
      reasons: snap.reasons ?? '',
      signal: (snap.signal ?? 'CONSIDER') as 'BUY' | 'CONSIDER' | 'AVOID',
      spreadPct: snap.spreadPct ?? (ask > 0 ? ((ask - bid) / ask) * 100 : 0),
      strike: tc.strike,
      theta: snap.theta ?? null,
      total_score: snap.total_score ?? 0,
      vega: snap.vega ?? null,
      volume: snap.volume ?? 0,
    };
  }, []);

  // Open detail from chain row
  const openChainDetail = useCallback((c: OptionsContract) => {
    setDetailContract(c);
    setDetailCurrentPrice(currentPrice);
    setDetailTrackedId(getTrackedId(c.symbol));
  }, [currentPrice, getTrackedId]);

  // Open detail from watchlist card
  const openWatchlistDetail = useCallback(
    (tracked: TrackedOptionContract, live: OptionsContract | null, price: number) => {
      setDetailContract(live ?? ({
        ask: (tracked.tracking_snapshot as any)?.ask ?? 0,
        bid: (tracked.tracking_snapshot as any)?.bid ?? 0,
        delta: (tracked.tracking_snapshot as any)?.delta ?? null,
        expiration: tracked.expiration_date,
        gamma: (tracked.tracking_snapshot as any)?.gamma ?? null,
        implied_volatility: (tracked.tracking_snapshot as any)?.impliedVolatility ?? null,
        last_price: (tracked.tracking_snapshot as any)?.mark ?? null,
        open_interest: (tracked.tracking_snapshot as any)?.openInterest ?? 0,
        option_type: tracked.option_type,
        rho: null,
        strike: tracked.strike,
        symbol: tracked.contract_symbol,
        theta: (tracked.tracking_snapshot as any)?.theta ?? null,
        ticker: tracked.ticker,
        timestamp: tracked.created_at,
        vega: (tracked.tracking_snapshot as any)?.vega ?? null,
        volume: (tracked.tracking_snapshot as any)?.volume ?? 0,
      } as OptionsContract));
      setDetailCurrentPrice(price);
      setDetailTrackedId(tracked.id);
      const snap = tracked.tracking_snapshot as any;
      setDetailTrackedPrice(snap?.mark ?? snap?.last_price ?? null);
      setDetailLiveContractPrice(
        live ? (live.last_price ?? (live.bid + live.ask) / 2) : null,
      );
    },
    [],
  );

  const handleTrack = useCallback((c: OptionsContract) => {
    if (!user?.id || detailTrackedId) return;
    trackContract.mutate({
      userId: user.id,
      ticker: activeTicker || c.ticker,
      contractSymbol: c.symbol,
      optionType: c.option_type,
      strike: c.strike,
      expirationDate: c.expiration,
      trackingSnapshot: asOpportunity(c),
      trackedFromSource: 'manual',
    }, {
      onSuccess: tracked => {
        setDetailTrackedId(tracked.id);
        // Fire-and-forget AI scoring — tracking never fails because of it
        scoreContract.mutate({
          trackedContractId: tracked.id,
          ticker: activeTicker || c.ticker,
          contract: {
            symbol: c.symbol,
            optionType: c.option_type,
            strike: c.strike,
            expiration: c.expiration,
            delta: c.delta,
            gamma: c.gamma,
            theta: c.theta,
            vega: c.vega,
            impliedVolatility: c.implied_volatility ?? undefined,
            openInterest: c.open_interest,
            volume: c.volume,
            bid: c.bid,
            ask: c.ask,
            lastPrice: c.last_price,
            currentStockPrice: currentPrice > 0 ? currentPrice : undefined,
          },
        }, {
          onError: () => toast.warning('AI scoring unavailable — score will update once service is back.'),
        });
      },
    });
  }, [user, activeTicker, trackContract, scoreContract, asOpportunity, detailTrackedId, currentPrice, toast]);

  const handleUntrack = useCallback((id: string) => {
    untrackContract.mutate(id, {
      onSuccess: () => {
        setDetailContract(null);
        setDetailTrackedId(null);
        setDetailTrackedPrice(null);
        setDetailLiveContractPrice(null);
      },
    });
  }, [untrackContract]);

  const closeDetail = useCallback(() => {
    setDetailContract(null);
    setDetailTrackedId(null);
    setDetailTrackedPrice(null);
    setDetailLiveContractPrice(null);
  }, []);

  // ── Chain render helpers ─────────────────────────────────────────────────────

  const handleSideSwitch = useCallback((s: OptionSide) => {
    setSide(s);
    setSelectedExpiry(null);
  }, []);

  const handleEnableMock = useCallback(() => {
    setUseMockData(true);
    if (!activeTicker) setOptionsTicker('AAPL');
  }, [activeTicker, setOptionsTicker]);

  const handleMockToggle = useCallback(() => {
    setUseMockData(m => {
      if (!m && !activeTicker) setOptionsTicker('AAPL');
      return !m;
    });
  }, [activeTicker, setOptionsTicker]);

  const renderRow = useCallback(
    ({ item }: { item: TableRow }) => {
      if (item.type === 'separator') {
        return (
          <View style={[styles.separatorRow, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
            <View style={[styles.separatorPill, { backgroundColor: colors.accent + '22' }]}>
              <Text style={[styles.separatorPillText, { color: colors.accent }]}>ITM</Text>
            </View>
            <Text style={[styles.separatorPrice, { color: colors.text }]}>${item.price.toFixed(2)}</Text>
            <View style={[styles.separatorPill, { backgroundColor: colors.accent + '22' }]}>
              <Text style={[styles.separatorPillText, { color: colors.accent }]}>ITM</Text>
            </View>
          </View>
        );
      }
      const c = item.data;
      const tracked = isContractTracked(c.symbol);
      return (
        <TouchableOpacity
          onPress={() => openChainDetail(c)}
          activeOpacity={0.7}
          style={[
            styles.contractRow,
            {
              backgroundColor: item.isITM ? colors.surface : 'transparent',
              borderBottomColor: colors.separator,
            },
          ]}
        >
          {tracked && (
            <View style={[styles.trackedDot, { backgroundColor: colors.accent }]} />
          )}
          <Text numberOfLines={1} style={[styles.cell, { width: COL_WIDTHS.strike, color: colors.text, fontWeight: '600' }]}>
            ${c.strike.toFixed(1)}
          </Text>
          <Text numberOfLines={1} style={[styles.cell, { width: COL_WIDTHS.bid, color: colors.success }]}>
            {c.bid > 0 ? c.bid.toFixed(2) : '-'}
          </Text>
          <Text numberOfLines={1} style={[styles.cell, { width: COL_WIDTHS.ask, color: colors.error }]}>
            {c.ask > 0 ? c.ask.toFixed(2) : '-'}
          </Text>
          <Text numberOfLines={1} style={[styles.cell, { width: COL_WIDTHS.last, color: colors.textSecondary }]}>
            {c.last_price != null ? c.last_price.toFixed(2) : '-'}
          </Text>
          <Text numberOfLines={1} style={[styles.cell, { width: COL_WIDTHS.oi, color: colors.textTertiary }]}>
            {formatVol(c.open_interest)}
          </Text>
          <Text numberOfLines={1} style={[styles.cell, { flex: 1, color: colors.textTertiary }]}>
            {formatVol(c.volume)}
          </Text>
        </TouchableOpacity>
      );
    },
    [colors, isContractTracked, openChainDetail],
  );

  const showError = !useMockData && activeTicker && (error || (optionsData && !optionsData.success));
  const showOutsideHours = showError && !marketStatus.isOpen;
  const showGenericError = showError && marketStatus.isOpen;

  // Watchlist badge count
  const watchlistCount = trackedContracts?.length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>

      {/* ── Header ── */}
      <View style={{
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.separator,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
      }}>
        <View>
          <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 }}>
            Contracts
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500', marginTop: 2 }}>
            {activeTicker && currentPrice > 0 && view === 'chain'
              ? `${activeTicker} · $${currentPrice.toFixed(2)}`
              : view === 'watchlist'
              ? `${watchlistCount} contract${watchlistCount !== 1 ? 's' : ''} tracked`
              : view === 'flow'
              ? activeTicker ? `${activeTicker} option flow` : 'Global option flow'
              : 'Enter a ticker in the search bar'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {/* Contracts monitor status pill (watchlist view only) */}
          {view === 'watchlist' && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              paddingHorizontal: 10, paddingVertical: 6,
              backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1,
              borderColor: isContractsRunning ? colors.success + '55' : colors.border,
            }}>
              <View style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: isContractsRunning ? colors.success : colors.textTertiary,
              }} />
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500' }}>
                {isContractsRunning ? 'Monitor On' : 'Monitor Off'}
              </Text>
            </View>
          )}
          {/* Mock toggle (chain only) */}
          {view === 'chain' && (
            <TouchableOpacity
              onPress={handleMockToggle}
              activeOpacity={0.75}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                backgroundColor: useMockData ? colors.accent + '22' : colors.iconButton,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: useMockData ? colors.accent + '66' : colors.iconButtonBorder,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Ionicons
                name="flask-outline"
                size={14}
                color={useMockData ? colors.accent : colors.textSecondary}
              />
              <Text style={{ color: useMockData ? colors.accent : colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
                Mock
              </Text>
            </TouchableOpacity>
          )}

          {/* Mock toggle (flow only) */}
          {view === 'flow' && (
            <TouchableOpacity
              onPress={() => setUseFlowMockData(m => !m)}
              activeOpacity={0.75}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                backgroundColor: useFlowMockData ? colors.accent + '22' : colors.iconButton,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: useFlowMockData ? colors.accent + '66' : colors.iconButtonBorder,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Ionicons
                name="flask-outline"
                size={14}
                color={useFlowMockData ? colors.accent : colors.textSecondary}
              />
              <Text style={{ color: useFlowMockData ? colors.accent : colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
                Mock
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── View toggle: Chain / Watchlist / Flow ── */}
      <View style={[viewToggle.container, { borderBottomColor: colors.separator }]}>
        {([
          { id: 'watchlist', icon: 'bookmark-outline', label: 'Watchlist' },
          { id: 'chain',     icon: 'layers-outline',   label: 'Chain' },
          { id: 'flow',      icon: 'pulse-outline',     label: 'Flow' },
        ] as { id: ScreenView; icon: string; label: string }[]).map(v => {
          const active = view === v.id;
          return (
            <TouchableOpacity
              key={v.id}
              onPress={() => setView(v.id)}
              activeOpacity={0.8}
              style={viewToggle.tab}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons
                  name={v.icon as any}
                  size={14}
                  color={active ? colors.accent : colors.textSecondary}
                />
                <Text style={{
                  fontSize: 14, fontWeight: active ? '700' : '500',
                  color: active ? colors.text : colors.textSecondary,
                }}>
                  {v.label}
                </Text>
                {v.id === 'watchlist' && watchlistCount > 0 && (
                  <View style={[viewToggle.badge, { backgroundColor: colors.accent }]}>
                    <Text style={viewToggle.badgeText}>{watchlistCount > 99 ? '99+' : watchlistCount}</Text>
                  </View>
                )}
              </View>
              {active && <View style={[viewToggle.underline, { backgroundColor: colors.accent }]} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Flow view ── */}
      {view === 'flow' ? (
        <View style={{ flex: 1 }}>
          {useFlowMockData && (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.warningBg,
              paddingHorizontal: 16,
              paddingVertical: 8,
              gap: 6,
            }}>
              <Ionicons name="flask" size={13} color={colors.warning} />
              <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '600', flex: 1 }}>
                Mock flow data — for demonstration only
              </Text>
              <TouchableOpacity onPress={() => setUseFlowMockData(false)} hitSlop={8}>
                <Ionicons name="close" size={14} color={colors.warning} />
              </TouchableOpacity>
            </View>
          )}
          <FlowFeed ticker={activeTicker || null} useMockData={useFlowMockData} />
        </View>
      ) : view === 'watchlist' ? (
        <TrackedContractsList
          onContractPress={openWatchlistDetail}
          activeTicker={activeTicker || undefined}
        />
      ) : (
        <>
          {/* ── Mock data banner ── */}
          {useMockData && (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.warningBg,
              paddingHorizontal: 16,
              paddingVertical: 8,
              gap: 6,
            }}>
              <Ionicons name="flask" size={13} color={colors.warning} />
              <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '600', flex: 1 }}>
                Mock data — for demonstration only
              </Text>
              <TouchableOpacity onPress={() => setUseMockData(false)} hitSlop={8}>
                <Ionicons name="close" size={14} color={colors.warning} />
              </TouchableOpacity>
            </View>
          )}

          {/* ── Controls row ── */}
          {activeTicker ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 10 }}>
              {/* Calls / Puts + expiry row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {/* Pill toggle */}
                <View style={{
                  flexDirection: 'row',
                  backgroundColor: colors.surface,
                  borderRadius: 100,
                  padding: 3,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}>
                  {(['CALL', 'PUT'] as const).map(s => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => handleSideSwitch(s)}
                      activeOpacity={0.8}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 6,
                        borderRadius: 100,
                        backgroundColor: side === s ? colors.surfaceTertiary : 'transparent',
                      }}
                    >
                      <Text style={{
                        fontSize: 13,
                        fontWeight: '600',
                        color: side === s
                          ? (s === 'CALL' ? colors.success : colors.error)
                          : colors.textSecondary,
                      }}>
                        {s === 'CALL' ? 'Calls' : 'Puts'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Expiry chips */}
                {expirations.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6 }}
                    style={{ flex: 1 }}
                  >
                    {expirations.map(exp => {
                      const active = selectedExpiry === exp;
                      return (
                        <TouchableOpacity
                          key={exp}
                          onPress={() => setSelectedExpiry(active ? null : exp)}
                          activeOpacity={0.75}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 20,
                            borderWidth: 1,
                            borderColor: active ? colors.accent : colors.border,
                            backgroundColor: active ? colors.accent + '1A' : 'transparent',
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '600', color: active ? colors.accent : colors.textSecondary }}>
                            {formatExpiry(exp)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              {/* Date range presets */}
              {!useMockData && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '500', marginRight: 4 }}>Range:</Text>
                  {DATE_PRESETS.map(p => {
                    const active = datePreset === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => { setDatePreset(p.id); setSelectedExpiry(null); }}
                        activeOpacity={0.75}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 5,
                          borderRadius: 20,
                          borderWidth: 1,
                          borderColor: active ? colors.accent : colors.border,
                          backgroundColor: active ? colors.accent + '1A' : 'transparent',
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '600', color: active ? colors.accent : colors.textSecondary }}>
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {/* ── Column headers ── */}
          {activeTicker && !showError ? (
            <View style={[styles.colHeaderRow, { backgroundColor: colors.surface, borderBottomColor: colors.separator }]}>
              <View style={{ width: 8 }} />
              <Text style={[styles.colHead, { width: COL_WIDTHS.strike, color: colors.textTertiary }]}>Strike</Text>
              <Text style={[styles.colHead, { width: COL_WIDTHS.bid, color: colors.success }]}>Bid</Text>
              <Text style={[styles.colHead, { width: COL_WIDTHS.ask, color: colors.error }]}>Ask</Text>
              <Text style={[styles.colHead, { width: COL_WIDTHS.last, color: colors.textTertiary }]}>Last</Text>
              <Text style={[styles.colHead, { width: COL_WIDTHS.oi, color: colors.textTertiary }]}>OI</Text>
              <Text style={[styles.colHead, { flex: 1, color: colors.textTertiary }]}>Volume</Text>
            </View>
          ) : null}

          {/* ── Content area ── */}

          {!activeTicker ? (
            <View style={styles.centered}>
              <View style={[styles.iconCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="layers-outline" size={32} color={colors.textSecondary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Options Chain</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Type a ticker in the search bar{'\n'}below to view the options chain
              </Text>
            </View>

          ) : !useMockData && isLoading ? (
            <ChainSkeleton colors={colors} />

          ) : showOutsideHours ? (
            <View style={styles.centered}>
              <View style={[styles.iconCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="time-outline" size={32} color={colors.textSecondary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Outside of Market Hours</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Options data is only available{'\n'}during market hours.
              </Text>

              <View style={[styles.countdownCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500', marginBottom: 6 }}>
                  Market opens in
                </Text>
                <Text style={[styles.countdown, { color: colors.text }]}>
                  {formatCountdown(marketStatus.secondsUntilOpen)}
                </Text>
              </View>

              <TouchableOpacity
                onPress={handleEnableMock}
                activeOpacity={0.8}
                style={[styles.mockCta, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}
              >
                <Ionicons name="flask-outline" size={15} color={colors.accent} />
                <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '600' }}>
                  View Mock Data
                </Text>
              </TouchableOpacity>
            </View>

          ) : showGenericError ? (
            <View style={styles.centered}>
              <Ionicons name="alert-circle-outline" size={44} color={colors.error} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Could not load options</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Check the ticker and try again
              </Text>
            </View>

          ) : rows.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No contracts found</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 4 }}>
                Try selecting a different expiration or date range
              </Text>
            </View>

          ) : (
            <FlatList
              data={rows}
              renderItem={renderRow}
              keyExtractor={(item, i) => item.type === 'separator' ? `sep-${i}` : item.data.symbol}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 200 }}
              initialNumToRender={30}
              maxToRenderPerBatch={20}
              windowSize={10}
            />
          )}
        </>
      )}

      {/* ── Detail modal ── */}
      {detailContract && (
        <OptionsContractDetailModal
          visible
          onClose={closeDetail}
          contract={
            // For watchlist-opened contracts, try the snapshot opportunity
            detailTrackedId && !trackedContracts?.find(t => t.id === detailTrackedId)
              ? asOpportunity(detailContract)
              : (() => {
                  const tracked = trackedContracts?.find(t => t.id === detailTrackedId);
                  return tracked && !activeData
                    ? trackedToOpportunity(tracked)
                    : asOpportunity(detailContract);
                })()
          }
          ticker={detailContract.ticker || activeTicker}
          currentPrice={detailCurrentPrice}
          isTracked={detailTrackedId !== null}
          onTrackContract={() => handleTrack(detailContract)}
          onUntrackContract={() => detailTrackedId && handleUntrack(detailTrackedId)}
          isTracking={trackContract.isPending}
          isUntracking={untrackContract.isPending}
          trackedPrice={detailTrackedId ? detailTrackedPrice : null}
          liveContractPrice={detailTrackedId ? detailLiveContractPrice : null}
        />
      )}
    </SafeAreaView>
  );
};

export default OptionsScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────

const viewToggle = StyleSheet.create({
  container: {
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative',
  },
  underline: {
    position: 'absolute', bottom: 0, left: '20%', right: '20%', height: 2, borderRadius: 2,
  },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconCard: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptySubtitle: { fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  countdownCard: {
    marginTop: 20, paddingHorizontal: 28, paddingVertical: 16,
    borderRadius: 16, borderWidth: 1, alignItems: 'center',
  },
  countdown: { fontSize: 32, fontWeight: '700', letterSpacing: 2 },
  mockCta: {
    marginTop: 14, paddingHorizontal: 20, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  colHeaderRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colHead: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  contractRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center',
  },
  trackedDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 3 },
  cell: { fontSize: 13, textAlign: 'left' },
  separatorRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  separatorPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 100 },
  separatorPillText: { fontSize: 11, fontWeight: '700' },
  separatorPrice: { fontSize: 13, fontWeight: '700' },
});
