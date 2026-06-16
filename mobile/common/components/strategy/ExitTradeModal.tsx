import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useSellPosition } from '@/hooks/mutations/strategy/useSellPosition';

interface Props {
  visible: boolean;
  colors: any;
  /** Engine id — saved-strategy UUID or immediate-engine synthetic id. */
  strategyId: string;
  ticker: string;
  contract?: string;
  /** Contracts currently held; the stepper is capped at this. */
  qtyRemaining: number;
  paperMode: boolean;
  onClose: () => void;
}

/**
 * Manually exit an open position: choose how many contracts to sell (or Sell All)
 * and submit a market SELL. LIVE positions confirm first.
 */
export function ExitTradeModal({
  visible, colors, strategyId, ticker, contract, qtyRemaining, paperMode, onClose,
}: Props) {
  const toast = useToast();
  const { mutate: sell, isPending } = useSellPosition();
  const max = Math.max(1, qtyRemaining || 1);
  const [qty, setQty] = useState(max);

  // Reset the chosen qty whenever the sheet (re)opens or the held qty changes.
  useEffect(() => { if (visible) setQty(max); }, [visible, max]);

  const sellAll = qty >= max;

  const doSell = () => {
    sell(
      { strategyId, qty: sellAll ? undefined : qty },
      {
        onSuccess: (r) => { toast.success(r.message || 'Position exited'); onClose(); },
        onError:   (e) => toast.error(e.message || 'Sell failed'),
      },
    );
  };

  const confirm = () => {
    if (!paperMode) {
      Alert.alert(
        'Sell LIVE Position',
        `Sell ${sellAll ? 'ALL' : qty} contract(s) of ${contract || ticker} with REAL money now?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sell', style: 'destructive', onPress: doSell },
        ],
      );
    } else {
      doSell();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={isPending ? undefined : onClose}>
        <Pressable style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>Exit {ticker}</Text>
              {contract ? (
                <Text style={[styles.sub, { color: colors.tabBarInactive }]} numberOfLines={1}>
                  {contract} · {paperMode ? 'Paper' : 'LIVE'}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.tabBarInactive} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: colors.tabBarInactive }]}>
            CONTRACTS TO SELL ({max} held)
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
              {sellAll && <Text style={[styles.allTag, { color: colors.accent }]}>ALL</Text>}
            </View>

            <TouchableOpacity
              onPress={() => setQty(q => Math.min(max, q + 1))}
              disabled={qty >= max}
              style={[styles.qtyBtn, { borderColor: colors.border, opacity: qty >= max ? 0.4 : 1 }]}
            >
              <Ionicons name="add" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => setQty(max)}
            style={[styles.maxBtn, { borderColor: colors.border, backgroundColor: sellAll ? colors.accent + '1A' : 'transparent' }]}
          >
            <Text style={[styles.maxBtnText, { color: sellAll ? colors.accent : colors.tabBarInactive }]}>
              Sell All ({max})
            </Text>
          </TouchableOpacity>

          {/* Sell */}
          <TouchableOpacity
            onPress={confirm}
            disabled={isPending}
            activeOpacity={0.85}
            style={[styles.sellBtn, { backgroundColor: isPending ? colors.border : colors.error }]}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="exit-outline" size={18} color="#fff" />
                <Text style={styles.sellText}>
                  {paperMode ? '' : 'LIVE '}Sell {sellAll ? 'All' : qty} {sellAll ? '' : 'Contract' + (qty > 1 ? 's' : '')}
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
  allTag:   { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: -2 },
  maxBtn:   { alignSelf: 'center', marginTop: 14, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  maxBtnText: { fontSize: 13, fontWeight: '600' },
  sellBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12, marginTop: 18 },
  sellText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
