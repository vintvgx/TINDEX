import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useCandidateContract, type CandidateContract } from '@/hooks/queries/strategy/useCandidateContract';
import { useEnterCandidateTrade } from '@/hooks/mutations/strategy/useEnterCandidateTrade';
import { useSkippedCandidates } from '@/hooks/useSkippedCandidates';
import { getOrbStatus } from '@/common/utils/orb/getOrbStatus';
import { PROFILE_EMOJI } from '@/common/components/strategy/PositionCard';
import type { CandidateBreakout } from '@/hooks/queries/strategy/useCandidateBreakouts';

const WATCHING_COLOR = '#4A9EFF';

/**
 * Live-only "watching a breakout" card — shown between the price breaking
 * ORH/ORL and the 3-minute confirmation hold clearing. See
 * candidate-breakout-design.html for the full state machine; this component
 * only ever renders the Watching state — useCandidateBreakouts() already
 * stops returning a candidate the instant it resolves (confirmed, retested,
 * or skipped), so there's no "resolving…" state to render here.
 */
export function CandidateBreakoutCard({
  candidate, colors, onSkip,
}: {
  candidate: CandidateBreakout;
  colors: any;
  onSkip: () => void;
}) {
  const toast = useToast();
  const { data: contractData, isLoading: contractLoading } = useCandidateContract(
    candidate.strategyId, candidate.direction,
  );
  const enterTrade = useEnterCandidateTrade();
  const { skip: dismiss } = useSkippedCandidates();
  const [, forceTick] = useState(0);
  const [selected, setSelected] = useState<'default' | 'alt'>('default');
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (!candidate.confirmDeadline) return;
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [candidate.confirmDeadline]);

  const dirColor = candidate.direction === 'CALL' ? colors.success : colors.error;

  const status = candidate.currentPrice != null
    ? getOrbStatus(candidate.currentPrice, candidate.orbHigh, candidate.orbLow)
    : null;
  const statusLabel = status === 'above' ? '↑ ABOVE ORH' : status === 'below' ? '↓ BELOW ORL' : status === 'in-range' ? 'IN RANGE' : '…';
  const statusColor = status === 'above' ? colors.success : status === 'below' ? colors.error : colors.textSecondary;

  const msLeft = candidate.confirmDeadline
    ? new Date(candidate.confirmDeadline).getTime() - Date.now()
    : null;
  const timerLabel = msLeft == null
    ? 'watching…'
    : msLeft <= 0
      ? 'confirming…'
      : `${Math.floor(msLeft / 60000)}:${String(Math.floor((msLeft / 1000) % 60)).padStart(2, '0')} to confirm`;

  const isBusy = enterTrade.isPending;

  const handleEnter = () => {
    const contract = contractData?.[selected];
    if (!contract) return;
    Alert.alert(
      'Enter Now?',
      `Buy ${qty} ${candidate.ticker} $${contract.strike} ${candidate.direction === 'CALL' ? 'Call' : 'Put'} ` +
        `now, without waiting for the 3-minute confirmation hold to clear.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enter Now',
          onPress: () => enterTrade.mutate(
            { strategy_id: candidate.strategyId, direction: candidate.direction, contract_symbol: contract.symbol, qty },
            {
              // Query invalidation alone can lag a beat behind the monitoring-
              // state poll this card is derived from (see useCandidateBreakouts)
              // — dismiss it immediately, same mechanism as Skip, so it never
              // lingers on screen after a trade the user just placed.
              onSuccess: () => { toast.success(`${candidate.ticker} entered`); dismiss(candidate.key); },
              onError: (e) => toast.error(e.message || 'Entry failed'),
            },
          ),
        },
      ],
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: WATCHING_COLOR + '55' }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Text style={styles.emoji}>{PROFILE_EMOJI[candidate.profile] ?? '⚙️'}</Text>
          <Text style={[styles.ticker, { color: colors.text }]}>{candidate.ticker}</Text>
          <Badge label={candidate.direction} color={dirColor} />
        </View>
        <Text style={[styles.status, { color: statusColor }]}>{statusLabel}</Text>
      </View>

      <View style={styles.subRow}>
        <Text style={[styles.strategyName, { color: colors.textSecondary }]} numberOfLines={1}>
          {candidate.strategyName} · watching
        </Text>
        <Text style={[styles.timer, { color: colors.textSecondary }]}>{timerLabel}</Text>
      </View>

      <View style={styles.strikesRow}>
        <StrikeBox
          label="DEFAULT" contract={contractData?.default} loading={contractLoading}
          selected={selected === 'default'} onPress={() => setSelected('default')} colors={colors}
        />
        <StrikeBox
          label="ALT" contract={contractData?.alt} loading={contractLoading}
          selected={selected === 'alt'} onPress={() => setSelected('alt')} colors={colors}
        />
      </View>

      <View style={styles.qtyRow}>
        <Text style={[styles.qtyLabel, { color: colors.textTertiary }]}>CONTRACTS</Text>
        <View style={styles.qtyStepper}>
          <TouchableOpacity
            onPress={() => setQty(q => Math.max(1, q - 1))}
            style={[styles.qtyBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.qtyBtnText, { color: colors.text }]}>−</Text>
          </TouchableOpacity>
          <Text style={[styles.qtyValue, { color: colors.text }]}>{qty}</Text>
          <TouchableOpacity
            onPress={() => setQty(q => q + 1)}
            style={[styles.qtyBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.qtyBtnText, { color: colors.text }]}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          onPress={onSkip}
          disabled={isBusy}
          activeOpacity={0.8}
          style={[styles.btn, { flex: 1, borderColor: colors.border, backgroundColor: colors.background }]}
        >
          <Ionicons name="close-circle-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.btnText, { color: colors.textSecondary }]}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleEnter}
          disabled={isBusy || !contractData?.[selected]}
          activeOpacity={0.8}
          style={[styles.btn, { flex: 1, borderColor: colors.success + '55', backgroundColor: colors.success + '14', opacity: contractData?.[selected] ? 1 : 0.5 }]}
        >
          {isBusy ? <ActivityIndicator size="small" color={colors.success} /> : (
            <>
              <Ionicons name="flash" size={16} color={colors.success} />
              <Text style={[styles.btnText, { color: colors.success }]}>Enter Now</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StrikeBox({
  label, contract, loading, selected, onPress, colors,
}: {
  label: string;
  contract: CandidateContract | null | undefined;
  loading: boolean;
  selected: boolean;
  onPress: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!contract}
      activeOpacity={0.7}
      style={[
        styles.strikeBox,
        { backgroundColor: colors.background, borderColor: selected ? WATCHING_COLOR : colors.border },
      ]}
    >
      <Text style={[styles.strikeLabel, { color: selected ? WATCHING_COLOR : colors.textTertiary }]}>
        {contract ? `${contract.strike} · ${label}` : label}
      </Text>
      {loading && !contract ? (
        <ActivityIndicator size="small" color={colors.textTertiary} style={{ marginTop: 4 }} />
      ) : contract ? (
        <>
          <Text style={[styles.strikePrice, { color: colors.text }]}>${contract.mid.toFixed(2)}</Text>
          <Text style={[styles.strikeDelta, { color: colors.textTertiary }]}>Δ{contract.delta.toFixed(2)}</Text>
        </>
      ) : (
        <Text style={[styles.strikePrice, { color: colors.textTertiary, fontSize: 12 }]}>unavailable</Text>
      )}
    </TouchableOpacity>
  );
}

const Badge = ({ label, color }: { label: string; color: string }) => (
  <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
    <Text style={[styles.badgeText, { color }]}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emoji: { fontSize: 14 },
  ticker: { fontSize: 15, fontWeight: '800' },
  status: { fontSize: 11, fontWeight: '800' },
  subRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  strategyName: { fontSize: 11, flexShrink: 1 },
  timer: { fontSize: 11, fontWeight: '600' },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  strikesRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  strikeBox: { flex: 1, borderRadius: 10, borderWidth: 1, padding: 10 },
  strikeLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  strikePrice: { fontSize: 16, fontWeight: '800', marginTop: 3 },
  strikeDelta: { fontSize: 10, marginTop: 1 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  qtyLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 28, height: 28, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 15, fontWeight: '700' },
  qtyValue: { fontSize: 14, fontWeight: '700', minWidth: 18, textAlign: 'center' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1, borderRadius: 8, paddingVertical: 9,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
});
