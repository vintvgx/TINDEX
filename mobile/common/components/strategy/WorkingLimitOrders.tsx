import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { isWorking, useCancelLimitOrder, useWorkingLimitOrders } from '@/hooks/queries/strategy/useLimitOrders';
import type { WorkingLimitOrder } from '@/common/types/strategy';

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function stateText(o: WorkingLimitOrder): string {
  if (o.status === 'partially_filled') return `partial · ${o.filled_qty}/${o.qty} filled`;
  if (o.filled_qty > 0) return `${o.filled_qty} filled`;
  return `awaiting $${o.limit_price.toFixed(2)}`;
}

/**
 * "Working limit orders" for one position (limit-sell-ladder spec): each
 * resting sell with its fill state and a × to cancel it (the unfilled
 * contracts go straight back to available). Renders nothing when there are
 * no working orders. `compact` is the read-only-plus-cancel row for the
 * exits editor — resting sells shrink what the stop/TP engine is selling
 * from, so they're shown while editing levels.
 */
export function WorkingLimitOrders({ strategyId, compact = false }: { strategyId: string; compact?: boolean }) {
  const colors = useThemeColors();
  const toast = useToast();
  const { data } = useWorkingLimitOrders(strategyId);
  const cancel = useCancelLimitOrder();
  const live = (data?.orders ?? []).filter(isWorking);
  if (!live.length) return null;

  const onCancel = (o: WorkingLimitOrder) =>
    cancel.mutate(
      { strategyId, orderId: o.order_id },
      {
        onSuccess: (r) => toast.success(
          r.order && r.order.filled_qty > 0
            ? `Cancelled — ${r.order.filled_qty} had already filled`
            : `Cancelled ${o.qty} @ $${o.limit_price.toFixed(2)}`),
        onError: (e) => toast.error(e.message || 'Cancel failed'),
      },
    );

  return (
    <View style={[compact ? styles.compactWrap : styles.wrap, { borderColor: colors.border }]}>
      <View style={styles.headRow}>
        <View style={[styles.dot, { backgroundColor: colors.warning }]} />
        <Text style={[styles.head, { color: colors.textSecondary }]}>
          WORKING LIMIT ORDERS{compact ? ` · ${data?.qty_working ?? 0} of ${data?.qty_held ?? 0} contracts` : ''}
        </Text>
      </View>
      {live.map((o) => {
        const busy = cancel.isPending && cancel.variables?.orderId === o.order_id;
        return (
          <View key={o.order_id} style={styles.row}>
            <Text style={[styles.mono, styles.order, { color: colors.text }]}>
              {o.qty - o.filled_qty} @ ${o.limit_price.toFixed(2)}
            </Text>
            {!compact && (
              <Text style={[styles.meta, { color: colors.textTertiary }]} numberOfLines={1}>
                placed {ago(o.placed_at)} · {stateText(o)}
              </Text>
            )}
            {compact && <View style={{ flex: 1 }} />}
            <TouchableOpacity
              onPress={() => onCancel(o)}
              disabled={busy}
              hitSlop={10}
              accessibilityLabel={`Cancel limit sell ${o.qty} at ${o.limit_price}`}
            >
              {busy
                ? <ActivityIndicator size="small" color={colors.textTertiary} />
                : <Ionicons name="close-circle" size={18} color={colors.textTertiary} />}
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  wrap: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  compactWrap: { borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  head: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  order: { fontSize: 13, fontWeight: '800', minWidth: 78 },
  meta: { flex: 1, fontSize: 11 },
});
