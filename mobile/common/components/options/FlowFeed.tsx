import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTickerFlowAlerts } from '@/hooks/queries/flow/useTickerFlowAlerts';
import { useFlowAlerts } from '@/hooks/queries/flow/useFlowAlerts';
import { useEnterZeroDTEPosition } from '@/hooks/mutations/zero_dte/useEnterZeroDTEPosition';
import { FlowCard } from './FlowCard';
import { FlowSummaryBar } from './FlowSummaryBar';
import { FlowInfoModal } from './FlowInfoModal';
import { FlowEnterModal } from './FlowEnterModal';
import { useToast } from '@/common/components/ui/Toast';
import type { FlowAlert } from '@/common/types/flow';
import { computeFlowSummary } from '@/common/types/flow';

type ContractFilter = 'all' | 'call' | 'put';
type ActivityFilter = 'all' | 'sweep' | 'floor';
type SortOrder = 'premium' | 'time' | 'score';
type ExpiryFilter = 'all' | '0dte' | 'week';

interface FlowFeedProps {
  ticker?: string | null;
  useMockData?: boolean;
}

// ── Mock data ────────────────────────────────────────────────────────────────

const now = Date.now();
const ago = (ms: number) => new Date(now - ms).toISOString();

const MOCK_FLOW_ALERTS: FlowAlert[] = [
  {
    ticker: 'AAPL', underlying_type: 'stock', contract_type: 'call',
    strike: '195.00', expiry: '2025-06-20',
    price: '3.50', size: 1250, premium: '437500',
    bid: '3.40', ask: '3.55',
    implied_volatility: '0.3214', delta: '0.6521',
    volume: 4800, open_interest: 18420,
    side: 'ask', is_sweep: true, is_floor: false, is_multileg: false,
    tags: ['ask_side', 'bullish', 'sweep', 'oi_increase'],
    unusual_score: '87.3', timestamp: ago(4 * 60 * 1000),
    all_opening: true, sector: 'Technology',
  },
  {
    ticker: 'SPY', underlying_type: 'etf', contract_type: 'put',
    strike: '510.00', expiry: '2025-06-27',
    price: '2.10', size: 5000, premium: '1050000',
    bid: '2.10', ask: '2.20',
    implied_volatility: '0.1843', delta: '-0.4120',
    volume: 15200, open_interest: 62000,
    side: 'bid', is_sweep: false, is_floor: true, is_multileg: false,
    tags: ['bid_side', 'bearish', 'floor', 'large_block'],
    unusual_score: '92.1', timestamp: ago(8 * 60 * 1000),
    all_opening: false, sector: 'ETF',
  },
  {
    ticker: 'NVDA', underlying_type: 'stock', contract_type: 'call',
    strike: '900.00', expiry: '2025-07-18',
    price: '15.20', size: 200, premium: '304000',
    bid: '15.10', ask: '15.30',
    implied_volatility: '0.5812', delta: '0.5234',
    volume: 820, open_interest: 3210,
    side: 'ask', is_sweep: true, is_floor: false, is_multileg: false,
    tags: ['ask_side', 'bullish', 'sweep'],
    unusual_score: '74.5', timestamp: ago(12 * 60 * 1000),
    all_opening: true, sector: 'Technology',
  },
  {
    ticker: 'TSLA', underlying_type: 'stock', contract_type: 'put',
    strike: '230.00', expiry: '2025-06-13',
    price: '4.80', size: 800, premium: '384000',
    bid: '4.70', ask: '4.90',
    implied_volatility: '0.6230', delta: '-0.5510',
    volume: 6300, open_interest: 22100,
    side: 'ask', is_sweep: true, is_floor: false, is_multileg: false,
    tags: ['ask_side', 'bearish', 'sweep', 'high_iv'],
    unusual_score: '81.0', timestamp: ago(18 * 60 * 1000),
    all_opening: true, sector: 'Automotive',
  },
  {
    ticker: 'QQQ', underlying_type: 'etf', contract_type: 'call',
    strike: '460.00', expiry: '2025-07-05',
    price: '5.40', size: 2000, premium: '1080000',
    bid: '5.30', ask: '5.50',
    implied_volatility: '0.2011', delta: '0.4820',
    volume: 9800, open_interest: 41000,
    side: 'ask', is_sweep: false, is_floor: true, is_multileg: false,
    tags: ['ask_side', 'bullish', 'floor'],
    unusual_score: '88.7', timestamp: ago(22 * 60 * 1000),
    all_opening: true, sector: 'ETF',
  },
  {
    ticker: 'AMD', underlying_type: 'stock', contract_type: 'call',
    strike: '170.00', expiry: '2025-06-20',
    price: '2.85', size: 600, premium: '171000',
    bid: '2.80', ask: '2.90',
    implied_volatility: '0.4450', delta: '0.4010',
    volume: 3100, open_interest: 11500,
    side: 'ask', is_sweep: true, is_floor: false, is_multileg: false,
    tags: ['ask_side', 'bullish', 'sweep'],
    unusual_score: '69.2', timestamp: ago(31 * 60 * 1000),
    all_opening: true, sector: 'Technology',
  },
  {
    ticker: 'META', underlying_type: 'stock', contract_type: 'put',
    strike: '480.00', expiry: '2025-06-27',
    price: '6.20', size: 400, premium: '248000',
    bid: '6.10', ask: '6.30',
    implied_volatility: '0.3108', delta: '-0.3820',
    volume: 2200, open_interest: 8700,
    side: 'bid', is_sweep: false, is_floor: false, is_multileg: true,
    tags: ['bid_side', 'bearish', 'multileg'],
    unusual_score: '61.4', timestamp: ago(45 * 60 * 1000),
    all_opening: false, sector: 'Technology',
  },
  {
    ticker: 'IWM', underlying_type: 'etf', contract_type: 'put',
    strike: '195.00', expiry: '2025-07-18',
    price: '3.10', size: 3500, premium: '1085000',
    bid: '3.05', ask: '3.15',
    implied_volatility: '0.2744', delta: '-0.4660',
    volume: 18000, open_interest: 55000,
    side: 'bid', is_sweep: false, is_floor: true, is_multileg: false,
    tags: ['bid_side', 'bearish', 'floor', 'large_block', 'earnings_next_week'],
    unusual_score: '95.0', timestamp: ago(55 * 60 * 1000),
    all_opening: true, sector: 'ETF',
  },
  {
    ticker: 'MSFT', underlying_type: 'stock', contract_type: 'call',
    strike: '420.00', expiry: '2025-07-18',
    price: '8.10', size: 350, premium: '283500',
    bid: '8.00', ask: '8.20',
    implied_volatility: '0.2560', delta: '0.5920',
    volume: 1400, open_interest: 6200,
    side: 'ask', is_sweep: true, is_floor: false, is_multileg: false,
    tags: ['ask_side', 'bullish', 'sweep', 'oi_increase'],
    unusual_score: '77.8', timestamp: ago(70 * 60 * 1000),
    all_opening: true, sector: 'Technology',
  },
  {
    ticker: 'SPY', underlying_type: 'etf', contract_type: 'call',
    strike: '525.00', expiry: '2025-06-20',
    price: '1.45', size: 4000, premium: '580000',
    bid: '1.42', ask: '1.48',
    implied_volatility: '0.1620', delta: '0.3210',
    volume: 22000, open_interest: 85000,
    side: 'ask', is_sweep: true, is_floor: false, is_multileg: false,
    tags: ['ask_side', 'bullish', 'sweep'],
    unusual_score: '83.5', timestamp: ago(90 * 60 * 1000),
    all_opening: false, sector: 'ETF',
  },
];

// ── Component ────────────────────────────────────────────────────────────────

const isToday = (expiry: string): boolean => {
  const today = new Date().toISOString().split('T')[0];
  return expiry === today;
};

const isThisWeek = (expiry: string): boolean => {
  const now = new Date();
  const exp = new Date(expiry + 'T00:00:00');
  const dayOfWeek = now.getDay(); // 0 = Sun
  const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 6;
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + daysUntilFriday);
  endOfWeek.setHours(23, 59, 59, 999);
  return exp >= now && exp <= endOfWeek;
};

export const FlowFeed: React.FC<FlowFeedProps> = ({ ticker, useMockData = false }) => {
  const colors = useThemeColors();

  const [contractFilter, setContractFilter] = useState<ContractFilter>('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('premium');
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');
  const [infoVisible, setInfoVisible] = useState(false);
  const [enterAlert, setEnterAlert] = useState<FlowAlert | null>(null);

  const enterMutation = useEnterZeroDTEPosition();
  const toast = useToast();

  const tickerQuery = useTickerFlowAlerts(useMockData ? null : (ticker || null));
  const globalQuery = useFlowAlerts();

  const activeQuery = (!useMockData && ticker) ? tickerQuery : globalQuery;
  const { data, isLoading: queryLoading, isRefetching, refetch, error } = activeQuery;

  const isLoading = queryLoading && !useMockData;
  const isAvailable = useMockData ? true : (data?.available ?? true);

  const rawAlerts: FlowAlert[] = useMockData
    ? (ticker
        ? MOCK_FLOW_ALERTS.filter(a => a.ticker === ticker.toUpperCase())
        : MOCK_FLOW_ALERTS)
    : (data?.data ?? []);

  const filtered = useMemo(() => {
    let list = [...rawAlerts];

    if (contractFilter !== 'all') {
      list = list.filter(a => a.contract_type === contractFilter);
    }
    if (activityFilter === 'sweep') {
      list = list.filter(a => a.is_sweep);
    } else if (activityFilter === 'floor') {
      list = list.filter(a => a.is_floor);
    }
    if (expiryFilter === '0dte') {
      list = list.filter(a => isToday(a.expiry));
    } else if (expiryFilter === 'week') {
      list = list.filter(a => isThisWeek(a.expiry));
    }

    list.sort((a, b) => {
      if (sortOrder === 'premium') return parseFloat(b.premium) - parseFloat(a.premium);
      if (sortOrder === 'score') return parseFloat(b.unusual_score) - parseFloat(a.unusual_score);
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return list;
  }, [rawAlerts, contractFilter, activityFilter, expiryFilter, sortOrder]);

  const summary = useMemo(() => computeFlowSummary(rawAlerts), [rawAlerts]);

  const handleEnterSubmit = (payload: Parameters<typeof enterMutation.mutate>[0]) => {
    enterMutation.mutate(payload, {
      onSuccess: () => {
        setEnterAlert(null);
        const mode = payload.mode === 'live' ? 'Live' : 'Paper';
        toast.success(`${mode} ${payload.contract_type.toUpperCase()} entered for ${payload.ticker}`);
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  const modals = (
    <>
      <FlowInfoModal visible={infoVisible} onClose={() => setInfoVisible(false)} />
      <FlowEnterModal
        alert={enterAlert}
        visible={!!enterAlert}
        onClose={() => setEnterAlert(null)}
        onSubmit={handleEnterSubmit}
        isLoading={enterMutation.isPending}
      />
    </>
  );

  if (!isAvailable && !isLoading) {
    return (
      <>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 60 }}>
          <View style={{
            width: 64, height: 64, borderRadius: 20,
            backgroundColor: colors.surface,
            borderWidth: 1, borderColor: colors.border,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <Ionicons name="key-outline" size={28} color={colors.textSecondary} />
          </View>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
            API Key Required
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            Add your Unusual Whales API key as{'\n'}
            <Text style={{ color: colors.accent, fontWeight: '600' }}>UNUSUAL_WHALES_API_KEY</Text>
            {'\n'}in your Railway environment variables.
          </Text>
          <TouchableOpacity
            onPress={() => setInfoVisible(true)}
            style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>Flow Guide</Text>
          </TouchableOpacity>
        </View>
        {modals}
      </>
    );
  }

  if (error && !isLoading && rawAlerts.length === 0) {
    return (
      <>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 60 }}>
          <Ionicons name="alert-circle-outline" size={44} color={colors.error} />
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 12 }}>
            Could not load flow data
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
            {(error as Error).message}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accent + '18', borderWidth: 1, borderColor: colors.accent + '44' }}
          >
            <Text style={{ color: colors.accent, fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
        {modals}
      </>
    );
  }

  const renderHeader = () => (
    <>
      {/* Summary bar */}
      {rawAlerts.length > 0 && <FlowSummaryBar summary={summary} />}

      {/* Filter rows */}
      <View style={{ paddingHorizontal: 16, marginBottom: 10, gap: 8 }}>

        {/* Row 1: Call/Put + Sweep/Floor + info button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {(['all', 'call', 'put'] as ContractFilter[]).map(f => {
            const active = contractFilter === f;
            const color = f === 'call' ? colors.success : f === 'put' ? colors.error : colors.textSecondary;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setContractFilter(f)}
                activeOpacity={0.75}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: active ? color : colors.border,
                  backgroundColor: active ? color + '18' : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: active ? color : colors.textSecondary }}>
                  {f === 'all' ? 'All' : f === 'call' ? 'Calls' : 'Puts'}
                </Text>
              </TouchableOpacity>
            );
          })}

          <View style={{ width: 1, height: 18, backgroundColor: colors.separator, marginHorizontal: 2 }} />

          {(['all', 'sweep', 'floor'] as ActivityFilter[]).map(f => {
            const active = activityFilter === f;
            const color = f === 'sweep' ? '#FF9F0A' : f === 'floor' ? '#5856D6' : colors.textSecondary;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setActivityFilter(f)}
                activeOpacity={0.75}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: active ? color : colors.border,
                  backgroundColor: active ? color + '18' : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: active ? color : colors.textSecondary }}>
                  {f === 'all' ? 'All Types' : f === 'sweep' ? 'Sweep' : 'Floor'}
                </Text>
              </TouchableOpacity>
            );
          })}

          {/* Info button — pushed to the right */}
          <TouchableOpacity
            onPress={() => setInfoVisible(true)}
            activeOpacity={0.75}
            style={{
              marginLeft: 'auto',
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1, borderColor: colors.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Row 2: Expiry filter */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '500', marginRight: 2 }}>Expiry:</Text>
          {([
            { id: 'all',  label: 'All' },
            { id: '0dte', label: '0DTE' },
            { id: 'week', label: 'This Week' },
          ] as { id: ExpiryFilter; label: string }[]).map(e => {
            const active = expiryFilter === e.id;
            const color = e.id === '0dte' ? colors.error : e.id === 'week' ? '#FF9F0A' : colors.textSecondary;
            return (
              <TouchableOpacity
                key={e.id}
                onPress={() => setExpiryFilter(e.id)}
                activeOpacity={0.75}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active ? color : colors.border,
                  backgroundColor: active ? color + '18' : 'transparent',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '600', color: active ? color : colors.textSecondary }}>
                  {e.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Row 3: Sort + count */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '500', marginRight: 2 }}>Sort:</Text>
          {([
            { id: 'premium', label: 'Premium' },
            { id: 'time',    label: 'Latest' },
            { id: 'score',   label: 'Score' },
          ] as { id: SortOrder; label: string }[]).map(s => {
            const active = sortOrder === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                onPress={() => setSortOrder(s.id)}
                activeOpacity={0.75}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.border,
                  backgroundColor: active ? colors.accent + '18' : 'transparent',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '600', color: active ? colors.accent : colors.textSecondary }}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}

          <Text style={{ color: colors.textTertiary, fontSize: 11, marginLeft: 'auto' }}>
            {filtered.length} alert{filtered.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    </>
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>Loading flow data…</Text>
      </View>
    );
  }

  if (!isLoading && filtered.length === 0) {
    return (
      <>
        <View style={{ flex: 1 }}>
          {renderHeader()}
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No flow alerts</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 4 }}>
              {ticker ? `No recent flow for ${ticker}` : 'Try adjusting filters'}
            </Text>
          </View>
        </View>
        {modals}
      </>
    );
  }

  return (
    <>
      <FlatList
        data={filtered}
        keyExtractor={(item, i) => `${item.ticker}-${item.timestamp}-${i}`}
        renderItem={({ item }) => (
          <FlowCard alert={item} onPress={() => setEnterAlert(item)} />
        )}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 200 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !useMockData}
            onRefresh={refetch}
            tintColor={colors.accent}
          />
        }
      />
      {modals}
    </>
  );
};
