import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, SafeAreaView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { ZeroDTEPosition } from '@/common/types/zero_dte';

interface Props {
  position: ZeroDTEPosition | null;
  visible: boolean;
  onClose: () => void;
  onSubmit: (positionId: string, stopPrice: number, tpLadder: ZeroDTEPosition['tp_ladder']) => void;
  isLoading?: boolean;
}

function pctFromEntry(price: number, entry: number): string {
  if (!entry) return '';
  const pct = ((price - entry) / entry) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function ZeroDTEEditExitsModal({ position, visible, onClose, onSubmit, isLoading }: Props) {
  const colors = useThemeColors();

  const [stopPrice, setStopPrice]   = useState('');
  const [tp1Price, setTp1Price]     = useState('');
  const [tp2Price, setTp2Price]     = useState('');

  useEffect(() => {
    if (!position) return;
    const entry = position.entry_price;
    setStopPrice(position.stop_price.toFixed(2));
    const tp1 = position.tp_ladder[0];
    if (tp1) setTp1Price((entry * (1 + tp1.pct)).toFixed(2));
    const tp2 = position.tp_ladder[1];
    if (tp2) setTp2Price((entry * (1 + tp2.pct)).toFixed(2));
  }, [position]);

  if (!position) return null;

  const entry      = position.entry_price;
  const isCall     = position.contract_type === 'call';
  const sideColor  = isCall ? '#10B981' : '#EF4444';
  const hasTP2     = position.tp_ladder.length > 1;

  const parsedStop = parseFloat(stopPrice) || 0;
  const parsedTP1  = parseFloat(tp1Price) || 0;
  const parsedTP2  = parseFloat(tp2Price) || 0;

  const isValid = parsedStop > 0 && parsedTP1 > 0 && (!hasTP2 || parsedTP2 > 0);

  const handleSubmit = () => {
    if (!isValid) return;

    const newLadder = position.tp_ladder.map((step, i) => {
      if (i === 0) {
        const price = parsedTP1;
        return { ...step, pct: (price - entry) / entry };
      }
      if (i === 1 && hasTP2) {
        const price = parsedTP2;
        return { ...step, pct: (price - entry) / entry };
      }
      return step;
    });

    onSubmit(position.id, parsedStop, newLadder);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[s.header, { borderColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.text }]}>Edit Exits</Text>
          <View style={[s.modeBadge, { backgroundColor: position.mode === 'live' ? '#EF4444' + '22' : '#8B5CF6' + '22' }]}>
            <Text style={{ color: position.mode === 'live' ? '#EF4444' : '#8B5CF6', fontSize: 11, fontWeight: '700' }}>
              {position.mode.toUpperCase()}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Position summary */}
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={s.row}>
              <Text style={[s.ticker, { color: colors.text }]}>{position.ticker}</Text>
              <View style={[s.sidePill, { backgroundColor: sideColor + '22' }]}>
                <Text style={[s.sideLabel, { color: sideColor }]}>
                  {isCall ? '▲' : '▼'} {position.contract_type.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={[s.detail, { color: colors.textSecondary }]}>
              ${position.strike} strike · {position.qty_remaining}/{position.qty} contracts remaining
            </Text>
            <View style={[s.entryRow, { borderTopColor: colors.border }]}>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Entry price</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
                ${entry.toFixed(2)}
              </Text>
            </View>
          </View>

          {/* Stop Loss */}
          <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>STOP LOSS</Text>
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={s.inputRow}>
              <View style={{ flex: 1 }}>
                <Text style={[s.inputLabel, { color: colors.textTertiary }]}>Price</Text>
                <TextInput
                  value={stopPrice}
                  onChangeText={setStopPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textTertiary}
                  style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
              <View style={s.pctBox}>
                <Text style={[s.inputLabel, { color: colors.textTertiary }]}>vs entry</Text>
                <Text style={{ color: '#EF4444', fontSize: 15, fontWeight: '700', marginTop: 10 }}>
                  {parsedStop > 0 ? pctFromEntry(parsedStop, entry) : '—'}
                </Text>
              </View>
            </View>
            <Text style={[s.hint, { color: colors.textTertiary }]}>
              Current: ${position.stop_price.toFixed(2)} ({(position.stop_pct * 100).toFixed(0)}% below entry)
            </Text>
          </View>

          {/* TP1 */}
          <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>TARGET 1</Text>
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={s.inputRow}>
              <View style={{ flex: 1 }}>
                <Text style={[s.inputLabel, { color: colors.textTertiary }]}>Price</Text>
                <TextInput
                  value={tp1Price}
                  onChangeText={setTp1Price}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textTertiary}
                  style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
              <View style={s.pctBox}>
                <Text style={[s.inputLabel, { color: colors.textTertiary }]}>vs entry</Text>
                <Text style={{ color: '#10B981', fontSize: 15, fontWeight: '700', marginTop: 10 }}>
                  {parsedTP1 > 0 ? pctFromEntry(parsedTP1, entry) : '—'}
                </Text>
              </View>
            </View>
            {position.tp_ladder[0] && (
              <Text style={[s.hint, { color: colors.textTertiary }]}>
                Current: ${(entry * (1 + position.tp_ladder[0].pct)).toFixed(2)} (+{(position.tp_ladder[0].pct * 100).toFixed(0)}%)
                · {(position.tp_ladder[0].qty_pct * 100).toFixed(0)}% of position
              </Text>
            )}
          </View>

          {/* TP2 (if applicable) */}
          {hasTP2 && (
            <>
              <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>TARGET 2</Text>
              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={s.inputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.inputLabel, { color: colors.textTertiary }]}>Price</Text>
                    <TextInput
                      value={tp2Price}
                      onChangeText={setTp2Price}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.textTertiary}
                      style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    />
                  </View>
                  <View style={s.pctBox}>
                    <Text style={[s.inputLabel, { color: colors.textTertiary }]}>vs entry</Text>
                    <Text style={{ color: '#F59E0B', fontSize: 15, fontWeight: '700', marginTop: 10 }}>
                      {parsedTP2 > 0 ? pctFromEntry(parsedTP2, entry) : '—'}
                    </Text>
                  </View>
                </View>
                {position.tp_ladder[1] && (
                  <Text style={[s.hint, { color: colors.textTertiary }]}>
                    Current: ${(entry * (1 + position.tp_ladder[1].pct)).toFixed(2)} (+{(position.tp_ladder[1].pct * 100).toFixed(0)}%)
                    · {(position.tp_ladder[1].qty_pct * 100).toFixed(0)}% of position
                  </Text>
                )}
              </View>
            </>
          )}

          {/* Submit */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!isValid || isLoading}
            style={[s.submitBtn, { backgroundColor: (!isValid || isLoading) ? colors.border : '#3B82F6' }]}
          >
            <Ionicons name="checkmark-circle" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={s.submitLabel}>
              {isLoading ? 'Saving...' : 'Save Exit Levels'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  headerTitle:  { fontSize: 17, fontWeight: '700', flex: 1 },
  modeBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  scroll:       { padding: 16 },
  card:         { borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1 },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  ticker:       { fontSize: 20, fontWeight: '800' },
  sidePill:     { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 2 },
  sideLabel:    { fontSize: 12, fontWeight: '700' },
  detail:       { fontSize: 12, marginBottom: 10 },
  entryRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  inputRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  inputLabel:   { fontSize: 12, marginBottom: 6 },
  input:        { height: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
  pctBox:       { width: 72, alignItems: 'flex-end' },
  hint:         { fontSize: 11, marginTop: 8 },
  submitBtn:    { flexDirection: 'row', borderRadius: 12, padding: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  submitLabel:  { color: '#fff', fontSize: 16, fontWeight: '700' },
});
