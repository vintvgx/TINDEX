import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  colors: any;
  contractSymbol: string;
  /** Last REST-polled ask, returned by the backend alongside "stream_unavailable" —
   *  NOT a live tick, since that's exactly what failed to arrive within 8s. */
  lastPrice: number;
  qty: number;
  direction: 'CALL' | 'PUT';
  paperMode: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;
  onSkip: () => void;
}

/**
 * Shown when the backend's 8s websocket-tick wait times out for a 0DTE
 * contract (submit_manual_trade returns status: 'stream_unavailable').
 * Rather than silently blocking the trade, this lets the user decide:
 * enter anyway off the last REST-polled quote (indicative feed, so it can
 * be a beat or two stale — see docs/OPTIONS_STREAMING_ARCHITECTURE.md), or
 * skip the trade outright. Confirming resubmits with bypass_stream_check,
 * which skips the wait server-side and enters off the same already-fetched
 * quote instead of blocking a second time.
 */
export function BlindEntryModal({
  visible, colors, contractSymbol, lastPrice, qty, direction, paperMode,
  isSubmitting, onConfirm, onSkip,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <Pressable style={styles.backdrop} onPress={onSkip}>
        <Pressable style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.iconWrap, { backgroundColor: '#F59E0B22', borderColor: '#F59E0B55' }]}>
            <Ionicons name="pulse-outline" size={22} color="#F59E0B" />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Real-Time Stream Unavailable</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            No live tick arrived for {contractSymbol} within 8 seconds. This is the last
            polled price — it may be a few seconds stale.
          </Text>

          <View style={[styles.priceBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.priceLabel, { color: colors.tabBarInactive }]}>LAST POLLED PRICE</Text>
            <Text style={[styles.priceValue, { color: colors.text }]}>${lastPrice.toFixed(2)}</Text>
            <Text style={[styles.priceSub, { color: colors.tabBarInactive }]}>
              {paperMode ? '' : 'LIVE · '}Buy {qty} {direction} · {contractSymbol}
            </Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onSkip}
              disabled={isSubmitting}
              activeOpacity={0.8}
              style={[styles.btn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: isSubmitting ? 0.5 : 1 }]}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Skip Trade</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              disabled={isSubmitting}
              activeOpacity={0.85}
              style={[styles.btn, { backgroundColor: '#F59E0B', opacity: isSubmitting ? 0.6 : 1 }]}
            >
              <Text style={[styles.btnText, { color: '#fff' }]}>
                {isSubmitting ? 'Entering…' : 'Enter Anyway'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  card:     { width: '100%', maxWidth: 380, borderRadius: 18, borderWidth: 1, padding: 20, alignItems: 'center' },
  iconWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title:    { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  body:     { fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 16 },
  priceBox: { width: '100%', borderRadius: 12, borderWidth: 1, padding: 14, alignItems: 'center', marginBottom: 18 },
  priceLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 4 },
  priceValue: { fontSize: 28, fontWeight: '800' },
  priceSub:   { fontSize: 12, marginTop: 4 },
  actions:  { flexDirection: 'row', gap: 10, width: '100%' },
  btn:      { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText:  { fontSize: 14, fontWeight: '700' },
});
