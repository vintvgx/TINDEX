import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Pressable, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useSellPosition } from '@/hooks/mutations/strategy/useSellPosition';
import { useSellStatus } from '@/hooks/useSellStatus';
import { parseContractSymbol } from '@/lib/formatContract';

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
 *
 * Closes itself the instant the sell is submitted rather than waiting for the
 * mutation to resolve — a fill can take up to ~10s, and blocking here means
 * the user can't move on to their next position while it's in flight. See
 * useSellStatus/TickerTape for the "Selling… → Sold…" confirmation that
 * replaces the old in-modal spinner.
 */
export function ExitTradeModal({
  visible, colors, strategyId, ticker, contract, qtyRemaining, paperMode, onClose,
}: Props) {
  const toast = useToast();
  const { mutate: sell, isPending } = useSellPosition();
  const { startSelling, markSold, clearSelling } = useSellStatus();
  const max = Math.max(1, qtyRemaining || 1);
  const [qty, setQty] = useState(max);
  // Optional — leaving this blank makes the backend seek a good price itself
  // (sample the bid a few times, try a limit order, fall back to market
  // after ~10s) instead of firing an instant market order. Typing a price
  // here skips that and uses this exact limit instead.
  const [limitPriceInput, setLimitPriceInput] = useState('');

  // Reset the chosen qty/limit price whenever the sheet (re)opens or the held qty changes.
  useEffect(() => { if (visible) { setQty(max); setLimitPriceInput(''); } }, [visible, max]);

  const sellAll = qty >= max;
  const limitPrice = limitPriceInput ? parseFloat(limitPriceInput) : undefined;
  const hasValidLimit = limitPrice != null && !Number.isNaN(limitPrice) && limitPrice > 0;

  const doSell = () => {
    const qtyToSell = sellAll ? max : qty;
    const parsed = contract ? parseContractSymbol(contract) : null;
    const contractLabel = parsed
      ? `${parsed.ticker} ${parsed.strike % 1 === 0 ? parsed.strike : parsed.strike.toFixed(1)}${parsed.type}`
      : (contract || ticker);
    const id = `${strategyId}-${Date.now()}`;

    // Fire-and-close: a sell can take up to ~10s (the backend samples the
    // bid / tries a limit order before falling back to market — see
    // useSellPosition's docstring), and blocking the modal on that means the
    // user can't move on to their next position while it resolves. The
    // ticker tape (see TickerTape's useSellStatus branch) picks up "Selling…"
    // → "Sold…" instead, so there's still visible confirmation either way —
    // it's just not gating this sheet anymore.
    startSelling({ id, strategyId, ticker, contractLabel, qty: qtyToSell });
    onClose();

    sell(
      { strategyId, qty: sellAll ? undefined : qty, limitPrice: hasValidLimit ? limitPrice : undefined },
      {
        onSuccess: (r) => {
          toast.success(r.message || 'Position exited');
          markSold(id, r.avg_fill_price ?? 0, r.qty_sold ?? qtyToSell, r.pnl);
        },
        onError: (e) => {
          toast.error(e.message || 'Sell failed');
          clearSelling(id);
        },
      },
    );
  };

  const confirm = () => {
    const priceNote = hasValidLimit
      ? `\n\nLimit price: $${limitPrice!.toFixed(2)}`
      : '\n\nSeeking the best price (may take up to ~10s).';
    if (!paperMode) {
      Alert.alert(
        'Sell LIVE Position',
        `Sell ${sellAll ? 'ALL' : qty} contract(s) of ${contract || ticker} with REAL money now?${priceNote}`,
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
      <Pressable style={styles.backdrop} onPress={onClose}>
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

          {/* Limit price — optional. Left blank, the backend samples the bid
              and seeks a good price itself (limit order first, market
              fallback after ~10s) instead of firing an instant market
              order. */}
          <Text style={[styles.label, { color: colors.tabBarInactive, marginTop: 18 }]}>
            LIMIT PRICE (OPTIONAL)
          </Text>
          <View style={[styles.limitRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Text style={[styles.limitDollar, { color: colors.tabBarInactive }]}>$</Text>
            <TextInput
              value={limitPriceInput}
              onChangeText={t => setLimitPriceInput(t.replace(/[^0-9.]/g, ''))}
              placeholder="Best price (auto)"
              placeholderTextColor={colors.tabBarInactive}
              keyboardType="decimal-pad"
              style={[styles.limitInput, { color: colors.text }]}
            />
          </View>
          <Text style={[styles.limitHint, { color: colors.tabBarInactive }]}>
            {hasValidLimit
              ? `Sells at exactly $${limitPrice!.toFixed(2)} (or better).`
              : 'Samples the current price a few times and tries for the best fill — may take up to ~10s.'}
          </Text>

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
  limitRow:    { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  limitDollar: { fontSize: 15, fontWeight: '600', marginRight: 4 },
  limitInput:  { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: 11 },
  limitHint:   { fontSize: 11, marginTop: 6, lineHeight: 15 },
  maxBtn:   { alignSelf: 'center', marginTop: 14, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  maxBtnText: { fontSize: 13, fontWeight: '600' },
  sellBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12, marginTop: 18 },
  sellText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
