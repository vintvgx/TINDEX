import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { useApprovePendingEntry } from '@/hooks/mutations/strategy/useApprovePendingEntry';
import { useSkipPendingEntry } from '@/hooks/mutations/strategy/useSkipPendingEntry';
import { PendingConfirmationModal } from '@/common/components/strategy/PendingConfirmationModal';
import type { PendingConfirmation } from '@/common/types/strategy';

/**
 * Non-blocking Dashboard card for one trade awaiting confirm_entry approval —
 * replaces the old full-screen forced modal (PendingConfirmationProvider used
 * to auto-show it the instant a confirmation existed, and a second one
 * arriving while the first was still open stacked a SECOND blocking modal on
 * top — the exact "two pop-ups blocking the UI" complaint this redesign
 * fixes). Same three-button shape as LivePositionPanel's Edit/Add/Exit row:
 * Edit opens the full picker (contract/qty/SL/TP — still PendingConfirmationModal,
 * now dismissible rather than forced), Skip and Enter act directly from the
 * card using the signal's own defaults, no modal required.
 */
export function PendingConfirmationCard({ pending, colors }: { pending: PendingConfirmation; colors: any }) {
  const toast = useToast();
  const { pendingPriceData, connected } = useStrategyLivePrice(pending.strategy_id, true);
  const { mutate: approve, isPending: approving } = useApprovePendingEntry();
  const { mutate: skip, isPending: skipping } = useSkipPendingEntry();
  const [editOpen, setEditOpen] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isBusy = approving || skipping;
  const dirColor = pending.direction === 'CALL' ? colors.success : colors.error;
  const livePremium = pendingPriceData?.mid_price ?? pending.entry_estimate;
  const msLeft = new Date(pending.expires_at).getTime() - Date.now();
  const expiryLabel = msLeft <= 0 ? 'expiring…' : `${Math.floor(msLeft / 60000)}:${String(Math.floor((msLeft / 1000) % 60)).padStart(2, '0')}`;

  const handleEnter = () => {
    approve(
      { strategy_id: pending.strategy_id, pending_id: pending.id },
      {
        onSuccess: () => toast.success(`${pending.ticker} entered`),
        onError:   (e) => toast.error(e.message || 'Entry failed'),
      },
    );
  };

  const handleSkip = () => {
    skip(
      { strategy_id: pending.strategy_id, pending_id: pending.id },
      {
        onSuccess: () => toast.info('Trade skipped'),
        onError:   (e) => toast.error(e.message || 'Skip failed'),
      },
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: '#F59E0B55' }]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.ticker, { color: colors.text }]}>{pending.ticker}</Text>
            <Badge label={pending.direction} color={dirColor} />
            <Badge label={pending.profile.replace(/_/g, ' ')} color={colors.accent} />
            {/* This strategy's OWN account mode — the conflict box below (if
                shown) describes a DIFFERENT position's mode, not this one;
                without this badge that was the only Paper/Live text on the
                card at all, easy to misread as describing this strategy. */}
            <Badge label={pending.paper_mode ? 'PAPER' : 'LIVE'} color={pending.paper_mode ? '#FF9F0A' : colors.error} />
          </View>
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {pending.contract_symbol} · ${pending.strike} strike · {pending.qty} qty
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={styles.liveRow}>
            <View style={[styles.liveDot, { backgroundColor: connected ? colors.success : colors.textTertiary }]} />
            <Text style={[styles.livePremium, { color: colors.text }]}>${livePremium.toFixed(2)}</Text>
          </View>
          <Text style={[styles.expiry, { color: '#F59E0B' }]}>Expires {expiryLabel}</Text>
        </View>
      </View>

      {pending.conflict_context && (
        <View style={[styles.conflictBox, { backgroundColor: '#F59E0B14', borderColor: '#F59E0B40' }]}>
          <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
            ⚠ Already have a matching open position
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15 }}>
            {(pending.conflict_context.strategy_name || pending.conflict_context.profile.replace(/_/g, ' '))}
            {' '}already holds {pending.conflict_context.direction} {pending.conflict_context.ticker}
            {' '}({pending.conflict_context.paper_mode ? 'Paper' : 'Live'})
          </Text>
        </View>
      )}

      {/* Same 3-button shape as LivePositionPanel's Edit/Add/Exit row */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          onPress={() => setEditOpen(true)}
          disabled={isBusy}
          activeOpacity={0.8}
          style={[styles.btn, { flex: 1, borderColor: colors.border, backgroundColor: colors.background }]}
        >
          <Ionicons name="create-outline" size={16} color={colors.text} />
          <Text style={[styles.btnText, { color: colors.text }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSkip}
          disabled={isBusy}
          activeOpacity={0.8}
          style={[styles.btn, { flex: 1, borderColor: colors.error + '55', backgroundColor: colors.error + '14' }]}
        >
          {skipping ? <ActivityIndicator size="small" color={colors.error} /> : (
            <>
              <Ionicons name="close-circle-outline" size={16} color={colors.error} />
              <Text style={[styles.btnText, { color: colors.error }]}>Skip</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleEnter}
          disabled={isBusy}
          activeOpacity={0.8}
          style={[styles.btn, { flex: 1, borderColor: colors.success + '55', backgroundColor: colors.success + '14' }]}
        >
          {approving ? <ActivityIndicator size="small" color={colors.success} /> : (
            <>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={[styles.btnText, { color: colors.success }]}>Enter</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <PendingConfirmationModal
        visible={editOpen}
        pending={pending}
        onResolved={() => setEditOpen(false)}
      />
    </View>
  );
}

const Badge = ({ label, color }: { label: string; color: string }) => (
  <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
    <Text style={[styles.badgeText, { color }]}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  ticker: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 12, marginTop: 4 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  livePremium: { fontSize: 16, fontWeight: '800' },
  expiry: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  conflictBox: { borderRadius: 10, borderWidth: 1, padding: 8, marginTop: 10 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1, borderRadius: 8, paddingVertical: 9,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
});
