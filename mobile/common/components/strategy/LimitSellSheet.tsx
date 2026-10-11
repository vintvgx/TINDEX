import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { usePlaceLimitOrders } from '@/hooks/queries/strategy/useLimitOrders';

interface Rung { qty: number; price: number }

interface Props {
  visible: boolean;
  strategyId: string;
  ticker: string;
  contract?: string;
  paperMode: boolean;
  /** Contracts held, and how many aren't already in working limit sells. */
  qtyHeld: number;
  qtyAvailable: number;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  onClose: () => void;
  onPlaced?: (count: number) => void;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** A round-number target above the ask: next $0.50 step ($1.32 → $1.50). */
const targetAbove = (ask: number) => r2(Math.floor(ask * 2 + 1) / 2);

/**
 * Limit sell ladder — the passive way out (limit-sell-ladder spec): build
 * one or more resting DAY limit sells ({qty, price} rungs) and place them
 * together. They wait for their price: no 10-second fallback, no market
 * fill. The aggressive "get me out now" path stays in ExitTradeModal.
 */
export function LimitSellSheet({
  visible, strategyId, ticker, contract, paperMode, qtyHeld, qtyAvailable, bid, ask, mid, onClose, onPlaced,
}: Props) {
  const colors = useThemeColors();
  const toast = useToast();
  const place = usePlaceLimitOrders();

  const [rungs, setRungs] = useState<Rung[]>([]);
  const [qty, setQty] = useState(1);
  const [priceText, setPriceText] = useState('');

  const drafted = rungs.reduce((n, r) => n + r.qty, 0);
  const free = Math.max(0, qtyAvailable - drafted);
  const price = parseFloat(priceText);
  const priceOk = Number.isFinite(price) && price > 0;
  const fillsNow = priceOk && bid != null && price <= bid;

  // Fresh sheet each open: one contract at the mid.
  useEffect(() => {
    if (!visible) return;
    setRungs([]);
    setQty(1);
    const seed = mid ?? ask ?? bid;
    setPriceText(seed != null ? seed.toFixed(2) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => { setQty((q) => Math.max(1, Math.min(q, free || 1))); }, [free]);

  const chips = useMemo(() => {
    const out: { label: string; value: number }[] = [];
    if (bid != null) out.push({ label: 'Bid', value: bid });
    if (mid != null) out.push({ label: 'Mid', value: r2(mid) });
    if (ask != null) {
      out.push({ label: 'Ask', value: ask });
      out.push({ label: `$${targetAbove(ask).toFixed(2)}`, value: targetAbove(ask) });
    }
    return out;
  }, [bid, mid, ask]);

  const stepPrice = (d: number) => {
    const base = priceOk ? price : (mid ?? 0);
    setPriceText(Math.max(0.01, r2(base + d)).toFixed(2));
    Haptics.selectionAsync().catch(() => {});
  };

  const addRung = () => {
    if (!priceOk || qty < 1 || qty > free) return;
    setRungs((rs) => [...rs, { qty, price: r2(price) }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  // Confirm places the drafted rungs — or, with nothing drafted yet, the
  // single order currently in the builder.
  const toPlace: Rung[] = rungs.length ? rungs : priceOk && qty >= 1 && qty <= free ? [{ qty, price: r2(price) }] : [];
  const placeQty = toPlace.reduce((n, r) => n + r.qty, 0);
  const proceeds = toPlace.reduce((n, r) => n + r.qty * r.price * 100, 0);

  const submit = () => {
    place.mutate(
      { strategyId, orders: toPlace.map((r) => ({ qty: r.qty, limit_price: r.price })) },
      {
        onSuccess: (res) => {
          const n = res.orders.length;
          toast.success(`${n} limit sell${n === 1 ? '' : 's'} placed${res.errors.length ? ` · ${res.errors.length} rejected` : ''}`);
          onPlaced?.(n);
          onClose();
        },
        onError: (e) => toast.error(e.message || 'Could not place limit sells'),
      },
    );
  };

  const confirm = () => {
    if (!toPlace.length) return;
    if (paperMode) return submit();
    Alert.alert(
      'Place LIVE limit sells',
      toPlace.map((r) => `Sell ${r.qty} @ $${r.price.toFixed(2)}`).join('\n') +
        `\n\nReal money. Resting DAY orders — they wait for your price.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Place', style: 'destructive', onPress: submit }],
    );
  };

  const fmt = (n?: number | null) => (n != null ? `$${n.toFixed(2)}` : '—');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.grabber, { backgroundColor: colors.textTertiary + '55' }]} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text }]}>Sell · {ticker}</Text>
                <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {contract ?? ''} · {paperMode ? 'Paper' : 'LIVE'} · {qtyHeld} held
                  {qtyHeld - qtyAvailable > 0 ? ` · ${qtyHeld - qtyAvailable} working` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            {/* live quote */}
            <View style={[styles.quoteRow, { borderColor: colors.border }]}>
              {[['BID', bid], ['MID', mid], ['ASK', ask]].map(([label, v]) => (
                <View key={label as string} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={[styles.quoteLabel, { color: colors.textTertiary }]}>{label as string}</Text>
                  <Text style={[styles.mono, styles.quoteValue, { color: colors.text }]}>{fmt(v as number | null)}</Text>
                </View>
              ))}
            </View>

            {/* drafted ladder */}
            {rungs.length > 0 && (
              <View style={{ marginTop: 14 }}>
                <Text style={[styles.label, { color: colors.textTertiary }]}>LADDER</Text>
                {rungs.map((r, i) => (
                  <View key={i} style={[styles.rung, { borderColor: colors.border }]}>
                    <Text style={[styles.mono, { flex: 1, color: colors.text, fontWeight: '700' }]}>
                      {r.qty} @ ${r.price.toFixed(2)}
                    </Text>
                    <Text style={[styles.mono, { color: colors.textSecondary, fontSize: 12 }]}>
                      ${(r.qty * r.price * 100).toFixed(0)}
                    </Text>
                    <TouchableOpacity onPress={() => setRungs((rs) => rs.filter((_, j) => j !== i))} hitSlop={10} style={{ marginLeft: 12 }}>
                      <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* builder */}
            <Text style={[styles.label, { color: colors.textTertiary, marginTop: 16 }]}>
              CONTRACTS ({free} available)
            </Text>
            <View style={styles.stepRow}>
              <StepBtn icon="remove" disabled={qty <= 1} onPress={() => setQty((q) => Math.max(1, q - 1))} colors={colors} />
              <Text style={[styles.mono, styles.stepValue, { color: colors.text }]}>{free ? qty : 0}</Text>
              <StepBtn icon="add" disabled={qty >= free} onPress={() => setQty((q) => Math.min(free, q + 1))} colors={colors} />
            </View>

            <Text style={[styles.label, { color: colors.textTertiary, marginTop: 14 }]}>LIMIT PRICE</Text>
            <View style={styles.stepRow}>
              <StepBtn icon="remove" onPress={() => stepPrice(-0.01)} colors={colors} />
              <View style={[styles.priceBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Text style={[styles.mono, { color: colors.textSecondary, fontSize: 18 }]}>$</Text>
                <TextInput
                  value={priceText}
                  onChangeText={(t) => setPriceText(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  style={[styles.mono, styles.priceInput, { color: colors.text }]}
                />
              </View>
              <StepBtn icon="add" onPress={() => stepPrice(0.01)} colors={colors} />
            </View>
            <View style={styles.chips}>
              {chips.map((c) => {
                const on = priceOk && r2(price) === c.value;
                return (
                  <TouchableOpacity
                    key={c.label}
                    onPress={() => setPriceText(c.value.toFixed(2))}
                    style={[styles.chip, { borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accent + '1A' : 'transparent' }]}
                  >
                    <Text style={[styles.chipText, { color: on ? colors.accent : colors.textSecondary }]}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {fillsNow && (
              <View style={styles.warnRow}>
                <Ionicons name="flash-outline" size={13} color={colors.warning} />
                <Text style={[styles.warnText, { color: colors.warning }]}>
                  At or below the bid — this will fill immediately.
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={addRung}
              disabled={!priceOk || free < 1}
              style={[styles.addBtn, { borderColor: colors.accent, opacity: !priceOk || free < 1 ? 0.4 : 1 }]}
            >
              <Ionicons name="add" size={16} color={colors.accent} />
              <Text style={[styles.addText, { color: colors.accent }]}>Add order</Text>
            </TouchableOpacity>

            {/* confirm */}
            <TouchableOpacity
              onPress={confirm}
              disabled={!toPlace.length || place.isPending}
              activeOpacity={0.85}
              style={[styles.cta, { backgroundColor: !toPlace.length ? colors.border : colors.error }]}
            >
              {place.isPending ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.ctaText}>
                    {paperMode ? '' : 'LIVE · '}Place {toPlace.length} limit order{toPlace.length === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.ctaSub}>
                    {placeQty} contract{placeQty === 1 ? '' : 's'} · resting until filled or cancelled
                    {toPlace.length ? ` · $${proceeds.toFixed(0)} if all fill` : ''}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={[styles.fine, { color: colors.textTertiary }]}>
              Resting DAY limit orders — they wait for your price. No 10-second fallback, no surprise
              market fills. Cancel any time. A stop-loss still sells the whole position, cancelling these first.
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StepBtn({ icon, onPress, disabled, colors }: {
  icon: 'add' | 'remove'; onPress: () => void; disabled?: boolean; colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.stepBtn, { borderColor: colors.border, opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 18, paddingBottom: 34 },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 12, marginTop: -6 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
  quoteRow: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, paddingVertical: 10 },
  quoteLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  quoteValue: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  rung: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  stepBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 26, fontWeight: '800', minWidth: 48, textAlign: 'center' },
  priceBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, minWidth: 120 },
  priceInput: { fontSize: 22, fontWeight: '800', paddingVertical: 8, marginLeft: 4, minWidth: 80 },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: '700' },
  warnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  warnText: { fontSize: 12, fontWeight: '600' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', marginTop: 14, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  addText: { fontSize: 13, fontWeight: '700' },
  cta: { alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, marginTop: 18, minHeight: 56 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  ctaSub: { color: '#ffffffcc', fontSize: 11, marginTop: 2 },
  fine: { fontSize: 11, lineHeight: 15, marginTop: 10, textAlign: 'center' },
});
