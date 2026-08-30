import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, SectionList, StyleSheet, ActivityIndicator, Animated, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useUntrackContract } from '@/hooks/mutations/track/useUntrackContract';
import { useOptionsQuery } from '@/hooks/queries/ticker/useOptionsQuery';
import { useContractScores } from '@/hooks/queries/agent/useContractScores';
import type { TrackedOptionContract } from '@/common/types/options';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';
import type { ContractScore } from '@/common/types/agent';
import { AddContractSheet } from './AddContractSheet';
import { AlertThresholdsModal } from './AlertThresholdsModal';
import { useToast } from '@/common/components/ui/Toast';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { TickerLogo } from '@/common/components/ui/TickerLogo';

const toDateStr = (d: Date) => d.toISOString().split('T')[0];

const fmtExpiry = (d: string) => {
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
};

// ─── Animated price pulse (shown while live data loads) ───────────────────────

const PricePulse: React.FC<{ colors: ReturnType<typeof useThemeColors> }> = ({ colors }) => {
  const pulse = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);
  return (
    <Animated.View style={{
      opacity: pulse,
      width: 64, height: 18, borderRadius: 5,
      backgroundColor: colors.border,
    }} />
  );
};

// ─── Per-contract live price card ─────────────────────────────────────────────
// React Query deduplicates: all cards for the same ticker share one API request.

const SIGNAL_COLORS: Record<string, string> = {
  STRONG_BUY: '#00c853',
  BUY: '#4caf50',
  HOLD: '#ff9800',
  SELL: '#f44336',
  STRONG_SELL: '#b71c1c',
};

const SIGNAL_LABELS: Record<string, string> = {
  STRONG_BUY: 'Strong Buy',
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
  STRONG_SELL: 'Strong Sell',
};

interface ContractCardProps {
  contract: TrackedOptionContract;
  aiScore?: ContractScore;
  onPress: (contract: TrackedOptionContract, live: OptionsContract | null, currentPrice: number) => void;
  onUntrack: () => void;
  isUntracking: boolean;
  colors: ReturnType<typeof useThemeColors>;
}

const ContractCard: React.FC<ContractCardProps> = ({ contract, aiScore, onPress, onUntrack, isUntracking, colors }) => {
  const { toTicker } = useBaseNavigation();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const today = toDateStr(new Date());
  const farDate = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return toDateStr(d); })();

  const { data: liveData, isLoading: liveLoading } = useOptionsQuery(contract.ticker, {
    limit: 200,
    expiration_date_gte: today,
    expiration_date_lte: farDate,
  });

  let liveContract: OptionsContract | null = null;
  let currentPrice = 0;
  if (liveData?.success) {
    const arr = contract.option_type === 'CALL' ? liveData.data.calls : liveData.data.puts;
    liveContract = arr.find(c =>
      c.strike === contract.strike && c.expiration === contract.expiration_date
    ) ?? null;
    currentPrice = liveData.data.current_price;
  }

  const livePrice = liveContract
    ? (liveContract.last_price ?? (liveContract.bid + liveContract.ask) / 2)
    : null;

  const snap = contract.tracking_snapshot as Record<string, any> | null;
  const displayPrice = livePrice ?? snap?.mark ?? snap?.last_price ?? null;
  const isLive = livePrice !== null;

  // Price recorded in the snapshot at the moment the contract was added to tracking
  const trackedPrice: number | null = snap?.mark ?? snap?.last_price ?? null;
  // Live change vs. the initial tracked price (only meaningful when we have fresh data)
  const trackedChange = livePrice != null && trackedPrice != null ? livePrice - trackedPrice : null;
  const trackedChangePct = trackedChange != null && trackedPrice != null && trackedPrice > 0
    ? (trackedChange / trackedPrice) * 100
    : null;

  const entry = contract.entry_price;
  const livePnl = entry != null && livePrice != null ? livePrice - entry : null;
  const livePnlPct = entry != null && entry > 0 && livePnl != null ? (livePnl / entry) * 100 : null;
  // A closed contract (exited/expired/cancelled) has no more live price to
  // diff against — fall back to the backend's own final pnl/pnl_percentage
  // (set at exit) rather than showing nothing, which is what happened here
  // before: the card only ever computed P&L from a still-live quote.
  const isClosed = contract.status === 'exited' || contract.status === 'expired' || contract.status === 'cancelled';
  const pnl = livePnl ?? (isClosed ? contract.pnl ?? null : null);
  const pnlPct = livePnlPct ?? (isClosed ? contract.pnl_percentage ?? null : null);

  const isCall = contract.option_type === 'CALL';
  const typeColor = isCall ? colors.success : colors.error;
  const isExpired = new Date(`${contract.expiration_date}T23:59:00`) < new Date();

  const strikeLabel = contract.strike % 1 === 0
    ? `$${contract.strike.toFixed(0)}`
    : `$${contract.strike.toFixed(2)}`;

  const sourceLabelMap: Record<string, string> = {
    orb_breakout: 'ORB signal',
    manual: 'Manual',
    followed_stock: 'Followed',
  };

  return (
    <TouchableOpacity
      onPress={() => onPress(contract, liveContract, currentPrice)}
      activeOpacity={0.75}
      style={[cc.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {/* Main row */}
      <View style={cc.mainRow}>
        {/* Left */}
        <View style={cc.leftCol}>
          <View style={cc.typeRow}>
            <View style={[cc.badge, { backgroundColor: typeColor + '20', borderColor: typeColor + '40' }]}>
              <Text style={[cc.badgeText, { color: typeColor }]}>{contract.option_type}</Text>
            </View>
            <TouchableOpacity
              onPress={() => toTicker(contract.ticker)}
              hitSlop={6}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
            >
              <TickerLogo
                uri={`https://financialmodelingprep.com/image-stock/${contract.ticker.toUpperCase()}.png`}
                ticker={contract.ticker}
                size={16}
              />
              <Text style={[cc.ticker, { color: colors.text }]}>{contract.ticker}</Text>
            </TouchableOpacity>
            <Text style={[cc.strike, { color: colors.textSecondary }]}>{strikeLabel}</Text>
          </View>
          <View style={cc.metaRow}>
            <Ionicons name="calendar-outline" size={11} color={colors.textTertiary} />
            <Text style={[cc.meta, { color: isExpired ? colors.error : colors.textTertiary }]}>
              {fmtExpiry(contract.expiration_date)}{isExpired ? ' · Expired' : ''}
            </Text>
            <Text style={[cc.dot, { color: colors.separator }]}>·</Text>
            <Text style={[cc.meta, { color: colors.textTertiary }]}>
              {sourceLabelMap[contract.tracked_from_source] ?? contract.tracked_from_source}
            </Text>
          </View>
        </View>

        {/* Right: price + P&L are the two numbers that actually matter for
            a decision — both get their own visual weight. Everything else
            (tracked-from, underlying, held duration) is one step down, a
            single muted caption cluster instead of stacked same-weight lines. */}
        <View style={cc.rightCol}>
          {/* Current price */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {isLive && <View style={[cc.liveDot, { backgroundColor: colors.success }]} />}
            {liveLoading && displayPrice == null ? (
              <PricePulse colors={colors} />
            ) : (
              <Text style={[cc.price, { color: displayPrice != null ? colors.text : colors.textTertiary }]}>
                {displayPrice != null ? `$${displayPrice.toFixed(2)}` : '—'}
              </Text>
            )}
          </View>

          {/* Trade P&L — a tinted badge (live if entry_price is set and
              a quote is live, else the backend's final pnl/pnl_percentage
              once the contract is closed) so it reads as THE number to
              scan for, not just another text line. */}
          {pnl != null && pnlPct != null && (
            <View style={[cc.pnlBadge, { backgroundColor: (pnl >= 0 ? colors.success : colors.error) + '18' }]}>
              <Text style={[cc.pnlBadgeText, { color: pnl >= 0 ? colors.success : colors.error }]}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPct.toFixed(1)}%)
              </Text>
            </View>
          )}

          {/* Change from tracked price */}
          {trackedChange != null && trackedChangePct != null ? (
            <Text style={[cc.trackedChange, { color: trackedChange >= 0 ? colors.success : colors.error }]}>
              {trackedChange >= 0 ? '+' : ''}${Math.abs(trackedChange).toFixed(2)} ({trackedChange >= 0 ? '+' : ''}{trackedChangePct.toFixed(1)}%)
            </Text>
          ) : null}

          {/* Secondary caption cluster — tracked-from, underlying, held duration */}
          {trackedPrice != null && (
            <Text style={[cc.trackedFrom, { color: colors.textTertiary }]}>
              from ${trackedPrice.toFixed(2)}
            </Text>
          )}
          {liveData?.success && currentPrice > 0 && (
            <Text style={[cc.underlying, { color: colors.textTertiary }]}>
              {contract.ticker} ${currentPrice.toFixed(2)}
            </Text>
          )}
          {contract.held_duration_days != null && (
            <Text style={[cc.underlying, { color: colors.textTertiary }]}>
              Held {contract.held_duration_days}d
            </Text>
          )}
        </View>
      </View>

      {/* AI score row (shown when score is available) — tap to expand the
          reasoning past 1 line, previously always truncated with no way to
          read the rest. */}
      {aiScore ? (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={(e) => { e.stopPropagation(); setReasonExpanded(v => !v); }}
          style={[cc.aiRow, { borderTopColor: colors.separator, backgroundColor: colors.background + 'CC' }]}
        >
          <Ionicons name="sparkles" size={11} color={SIGNAL_COLORS[aiScore.signal] ?? colors.accent} />
          <View style={[cc.scoreBadge, { backgroundColor: (SIGNAL_COLORS[aiScore.signal] ?? colors.accent) + '20' }]}>
            <Text style={[cc.scoreNum, { color: SIGNAL_COLORS[aiScore.signal] ?? colors.accent }]}>
              {aiScore.score}/100
            </Text>
          </View>
          <Text style={[cc.signalText, { color: SIGNAL_COLORS[aiScore.signal] ?? colors.accent }]}>
            {SIGNAL_LABELS[aiScore.signal] ?? aiScore.signal}
          </Text>
          <Text style={[cc.reasoningText, { color: colors.textTertiary }]} numberOfLines={reasonExpanded ? undefined : 1}>
            · {aiScore.reasoning}
          </Text>
          <Ionicons name={reasonExpanded ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : null}

      {/* Why this was tracked (contract.tracking_reason — distinct from the
          AI score's own reasoning above) — previously fetched but never
          shown anywhere on the card. Same tap-to-expand toggle. */}
      {contract.tracking_reason ? (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={(e) => { e.stopPropagation(); setReasonExpanded(v => !v); }}
          style={[cc.reasonRow, { borderTopColor: colors.separator }]}
        >
          <Ionicons name="bookmark-outline" size={11} color={colors.textTertiary} />
          <Text style={[cc.reasoningText, { color: colors.textSecondary, flex: 1 }]} numberOfLines={reasonExpanded ? undefined : 1}>
            {contract.tracking_reason}
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Footer row */}
      <View style={[cc.footer, { borderTopColor: colors.separator }]}>
        <View style={[cc.statusPill, { backgroundColor: colors.background }]}>
          <Text style={[cc.statusText, { color: colors.textTertiary }]}>{contract.status}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {contract.status === 'entered' && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); setAlertsOpen(true); }}
              hitSlop={8}
              style={[cc.trashBtn, { borderColor: colors.accent + '40' }]}
            >
              <Ionicons name="notifications-outline" size={13} color={colors.accent} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              Alert.alert(
                'Remove from watchlist?',
                `${contract.ticker} ${contract.option_type} ${strikeLabel} — this can't be undone.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: onUntrack },
                ],
              );
            }}
            disabled={isUntracking}
            hitSlop={8}
            style={[cc.trashBtn, { borderColor: colors.error + '40' }]}
          >
            {isUntracking
              ? <ActivityIndicator size="small" color={colors.error} />
              : <Ionicons name="trash-outline" size={13} color={colors.error} />}
          </TouchableOpacity>
        </View>
      </View>

      {contract.status === 'entered' && (
        <AlertThresholdsModal
          visible={alertsOpen}
          onClose={() => setAlertsOpen(false)}
          contract={contract}
        />
      )}
    </TouchableOpacity>
  );
};

const cc = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, marginHorizontal: 16, marginBottom: 10, overflow: 'hidden' },
  mainRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 14 },
  leftCol: { flex: 1, paddingRight: 12 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  ticker: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  strike: { fontSize: 14, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  meta: { fontSize: 12, fontWeight: '500' },
  dot: { fontSize: 10 },
  rightCol: { alignItems: 'flex-end' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  price: { fontSize: 18, fontWeight: '700' },
  trackedChange: { fontSize: 12, fontWeight: '700', marginTop: 3 },
  trackedFrom: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  pnlBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
  pnlBadgeText: { fontSize: 12, fontWeight: '800' },
  underlying: { fontSize: 11, marginTop: 2 },
  aiRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  scoreBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  scoreNum: { fontSize: 11, fontWeight: '800' },
  signalText: { fontSize: 11, fontWeight: '700' },
  reasoningText: { fontSize: 11, flex: 1 },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  trashBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
});

// ─── Main list component ───────────────────────────────────────────────────────

interface Props {
  onContractPress: (contract: TrackedOptionContract, live: OptionsContract | null, currentPrice: number) => void;
  activeTicker?: string;
}

export const TrackedContractsList: React.FC<Props> = ({ onContractPress, activeTicker }) => {
  const colors = useThemeColors();
  const { data: contracts, isLoading, refetch } = useTrackedContracts();
  const { mutate: untrack, isPending: isUntracking, variables: untrackedId } = useUntrackContract();
  const { data: contractScores = [] } = useContractScores();
  const [addOpen, setAddOpen] = useState(false);
  const toast = useToast();

  const handleUntrack = useCallback((id: string) => {
    untrack(id, {
      onSuccess: () => toast.info('Contract removed from watchlist'),
      onError: (err: Error) => toast.error(err.message),
    });
  }, [untrack, toast]);

  // Active (still being watched/held) vs. closed (nothing left to do with
  // it) — a flat list mixed both together with no way to tell at a glance
  // which contracts still need attention.
  const active = (contracts ?? []).filter(c => c.status === 'tracking' || c.status === 'entered');
  const closed = (contracts ?? []).filter(c => c.status === 'exited' || c.status === 'expired' || c.status === 'cancelled');
  const sections = [
    ...(active.length ? [{ title: `ACTIVE (${active.length})`, data: active }] : []),
    ...(closed.length ? [{ title: `CLOSED (${closed.length})`, data: closed }] : []),
  ];

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 10 }}>Loading watchlist…</Text>
      </View>
    );
  }

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 200 }}
        renderSectionHeader={({ section }) => (
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
            {section.title}
          </Text>
        )}
        ListHeaderComponent={
          contracts && contracts.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 }}>
              <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '600' }}>
                {contracts.length} CONTRACT{contracts.length !== 1 ? 'S' : ''} TRACKED
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => refetch()}
                  hitSlop={8}
                  style={[ls.headerBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setAddOpen(true)}
                  style={[ls.headerBtn, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}
                >
                  <Ionicons name="add" size={14} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={ls.empty}>
            <View style={[ls.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="bookmark-outline" size={32} color={colors.textSecondary} />
            </View>
            <Text style={[ls.emptyTitle, { color: colors.text }]}>No tracked contracts</Text>
            <Text style={[ls.emptySubtitle, { color: colors.textSecondary }]}>
              Track contracts from the Chain view or add one manually with a ticker, date, and strike.
            </Text>
            <TouchableOpacity
              onPress={() => setAddOpen(true)}
              activeOpacity={0.8}
              style={[ls.addCta, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '700' }}>Add Contract Manually</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <ContractCard
            contract={item}
            aiScore={contractScores.find(s => s.tracked_contract_id === item.id)}
            onPress={onContractPress}
            onUntrack={() => handleUntrack(item.id)}
            isUntracking={isUntracking && untrackedId === item.id}
            colors={colors}
          />
        )}
      />

      <AddContractSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        initialTicker={activeTicker}
      />
    </>
  );
};

const ls = StyleSheet.create({
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  addCta: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1 },
});
