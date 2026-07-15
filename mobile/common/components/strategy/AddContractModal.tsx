import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useAddToPosition } from '@/hooks/mutations/strategy/useAddToPosition';

interface Props {
  visible: boolean;
  colors: any;
  /** Engine id — saved-strategy UUID or immediate-engine synthetic id. */
  strategyId: string;
  ticker: string;
  contract?: string;
  /** Contracts currently held, for the "avg down from N held" hint. */
  qtyHeld: number;
  entryPremium?: number;
  /** Current option mid-price, for a rough cost estimate — the actual fill
   *  (and therefore the new blended entry) is resolved server-side at the
   *  broker's ask, so this is an estimate, not the final cost. */
  midPrice?: number;
  paperMode: boolean;
  onClose: () => void;
}

/**
 * Buy more of an already-open contract to average down/up. Mirrors
 * ExitTradeModal's shape (qty stepper + LIVE confirm) since it's the same
 * "act on an open position" surface, just the buy side instead of the sell
 * side.
 */
export function AddContractModal({
  visible, colors, strategyId, ticker, contract, qtyHeld, entryPremium, midPrice, paperMode, onClose,
}: Props) {
  const toast = useToast();
  const { mutate: add, isPending } = useAddToPosition();
  const [qty, setQty] = useState(1);

  useEffect(() => { if (visible) setQty(1); }, [visible]);

  const estCost = midPrice != null ? midPrice * qty * 100 : null;

  const doAdd = () => {
    add(
      { strategyId, qty },
      {
        onSuccess: (r) => {
          toast.success(r.message || 'Added to position');
          onClose();
        },
        onError: (e) => toast.error(e.message || 'Add failed'),
      },
    );
  };

  const confirm = () => {
    if (!paperMode) {
      Alert.alert(
        'Add to LIVE Position',
        `Buy ${qty} more contract(s) of ${contract || ticker} with REAL money now?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Buy', style: 'destructive', onPress: doAdd },
        ],
      );
    } else {
      doAdd();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={isPending ? undefined : onClose}>
        <Pressable style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>Add to {ticker}</Text>
              {contract ? (
                <Text style={[styles.sub, { color: colors.tabBarInactive }]} numberOfLines={1}>
                  {contract} · {paperMode ? 'Paper' : 'LIVE'} · {qtyHeld} held
                  {entryPremium != null ? ` @ $${entryPremium.toFixed(2)} avg` : ''}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.tabBarInactive} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: colors.tabBarInactive }]}>
            CONTRACTS TO ADD
          </Text>

          <View style={styles.qtyRow}>
            <TouchableOpacity
              onPress={() => setQty(q => Math.max(1, q - 1))}
              disabled={qty <= 1}
              style={[styles.qtyBtn, { borderColor: colors.border, opacity: qty <= 1 ? 0.4 : 1 }]}
            >
              <Ionicons name="remove" size={22} color={colors.text} />
            </TouchableOpacity>

            <View style={{ alignItems: 'center', minWidth: 64 }}>
              <Text style={[styles.qtyValue, { color: colors.text }]}>{qty}</Text>
              {estCost != null && (
                <Text style={[styles.estText, { color: colors.tabBarInactive }]}>≈ ${estCost.toFixed(0)}</Text>
              )}
            </View>

            <TouchableOpacity
              onPress={() => setQty(q => Math.min(50, q + 1))}
              style={[styles.qtyBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.hint, { color: colors.tabBarInactive }]}>
            Entry price, stop loss and take-profit levels will update to the new
            blended average across all {qtyHeld + qty} contracts.
          </Text>

          {/* Add */}
          <TouchableOpacity
            onPress={confirm}
            disabled={isPending}
            activeOpacity={0.85}
            style={[styles.addBtn, { backgroundColor: isPending ? colors.border : colors.accent }]}
          >
            {isPending ? (
              <ActivityIndicator color={colors.accentForeground ?? '#fff'} />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={18} color={colors.accentForeground ?? '#fff'} />
                <Text style={[styles.addText, { color: colors.accentForeground ?? '#fff' }]}>
                  {paperMode ? '' : 'LIVE '}Buy {qty} More
                </Text>
              </>
            )}
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  card:     { width: '100%', maxWidth: 380, borderRadius: 18, borderWidth: 1, padding: 18 },
  header:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  title:    { fontSize: 18, fontWeight: '700' },
  sub:      { fontSize: 12, marginTop: 2 },
  label:    { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 10 },
  qtyRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  qtyBtn:   { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { fontSize: 30, fontWeight: '800' },
  estText:  { fontSize: 11, marginTop: 2 },
  hint:     { fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: 16 },
  addBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12, marginTop: 18 },
  addText:  { fontSize: 15, fontWeight: '700' },
});
