import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  SafeAreaView, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExitEditMode = 'swing' | 'orb';

export interface CurrentExits {
  hard_stop: number;       // absolute premium price
  tp1: number;             // absolute premium price
  tp2?: number;            // absolute premium price (optional)
  entry_premium: number;   // for display/validation
  tp1_hit?: boolean;
  tp2_hit?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  mode: ExitEditMode;
  positionId: string;       // strategy_id for ORB, position uuid for swing
  userId?: string;          // required for swing
  ticker: string;
  current: CurrentExits;
  onSubmit: (payload: {
    hard_stop?: number;
    tp1?: number;
    tp2?: number;
    // swing-specific: percentages derived from abs prices
    tp1_pct?: number;
    tp2_pct?: number;
  }) => Promise<void>;
  isLoading?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EditExitsModal({
  visible, onClose, mode, ticker, current, onSubmit, isLoading,
}: Props) {
  const colors = useThemeColors();

  const [stopVal, setStopVal] = useState('');
  const [tp1Val, setTp1Val] = useState('');
  const [tp2Val, setTp2Val] = useState('');

  // Reset fields to current values when modal opens
  useEffect(() => {
    if (visible) {
      setStopVal(current.hard_stop > 0 ? current.hard_stop.toFixed(2) : '');
      setTp1Val(current.tp1 > 0 ? current.tp1.toFixed(2) : '');
      setTp2Val(current.tp2 && current.tp2 > 0 ? current.tp2.toFixed(2) : '');
    }
  }, [visible, current]);

  const entry = current.entry_premium;

  const validateAndSubmit = async () => {
    const stop = stopVal ? parseFloat(stopVal) : undefined;
    const tp1 = tp1Val ? parseFloat(tp1Val) : undefined;
    const tp2 = tp2Val ? parseFloat(tp2Val) : undefined;

    if (stop !== undefined && (isNaN(stop) || stop <= 0)) {
      Alert.alert('Invalid', 'Stop loss must be a positive price.');
      return;
    }
    if (tp1 !== undefined && !isNaN(tp1) && tp1 <= (stop ?? current.hard_stop)) {
      Alert.alert('Invalid', 'TP1 must be above the stop loss.');
      return;
    }
    if (tp1 !== undefined && !isNaN(tp1) && entry > 0 && tp1 <= entry) {
      Alert.alert('Invalid', 'TP1 must be above your entry premium.');
      return;
    }
    if (tp2 !== undefined && tp1 !== undefined && !isNaN(tp2) && !isNaN(tp1) && tp2 <= tp1) {
      Alert.alert('Invalid', 'TP2 must be above TP1.');
      return;
    }

    // For swing, convert absolute prices → percentages (backend expects pct)
    const payload: Parameters<typeof onSubmit>[0] = {};
    if (stop !== undefined && !isNaN(stop)) payload.hard_stop = stop;
    if (tp1 !== undefined && !isNaN(tp1)) {
      payload.tp1 = tp1;
      if (mode === 'swing' && entry > 0) payload.tp1_pct = parseFloat(((tp1 - entry) / entry).toFixed(4));
    }
    if (tp2 !== undefined && !isNaN(tp2)) {
      payload.tp2 = tp2;
      if (mode === 'swing' && entry > 0) payload.tp2_pct = parseFloat(((tp2 - entry) / entry).toFixed(4));
    }

    if (!Object.keys(payload).length) {
      Alert.alert('No changes', 'Enter at least one value to update.');
      return;
    }

    await onSubmit(payload);
  };

  const pctLabel = (abs: number | undefined) => {
    if (!abs || !entry) return '';
    const pct = ((abs - entry) / entry) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: colors.border }}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Edit Stop / Target</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
              {ticker} · entry ${entry.toFixed(2)} · {mode === 'orb' ? '0DTE' : 'Swing'}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* Info banner */}
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', gap: 10 }}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} style={{ marginTop: 1 }} />
            <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 }}>
              Changes take effect immediately on submit. For live trades, the engine evaluates the new levels on the next price tick — not via a bracket order update.{'\n\n'}
              <Text style={{ color: colors.warning, fontWeight: '600' }}>Tip: use limit orders at the mid-price for best fills, not market orders.</Text>
            </Text>
          </View>

          {/* Stop Loss */}
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
            STOP LOSS
          </Text>
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Current: ${current.hard_stop.toFixed(2)}</Text>
              <Text style={{ color: '#FF453A', fontSize: 12 }}>{pctLabel(current.hard_stop)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TextInput
                value={stopVal}
                onChangeText={setStopVal}
                keyboardType="decimal-pad"
                placeholder={current.hard_stop.toFixed(2)}
                placeholderTextColor={colors.textTertiary}
                style={{
                  flex: 1,
                  backgroundColor: colors.background,
                  borderRadius: 10,
                  padding: 12,
                  color: '#FF453A',
                  fontSize: 18,
                  fontWeight: '700',
                  borderWidth: 1,
                  borderColor: stopVal ? '#FF453A44' : colors.border,
                }}
              />
              {stopVal && entry > 0 && (
                <Text style={{ color: '#FF453A', fontSize: 13, fontWeight: '600', minWidth: 52, textAlign: 'right' }}>
                  {pctLabel(parseFloat(stopVal))}
                </Text>
              )}
            </View>
          </View>

          {/* TP1 */}
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
            TAKE PROFIT 1{current.tp1_hit ? '  ✓ HIT' : ''}
          </Text>
          <View style={{
            backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20,
            borderWidth: 1, borderColor: current.tp1_hit ? '#10B98133' : colors.border,
            opacity: current.tp1_hit ? 0.6 : 1,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Current: ${current.tp1.toFixed(2)}</Text>
              <Text style={{ color: '#10B981', fontSize: 12 }}>{pctLabel(current.tp1)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TextInput
                value={tp1Val}
                onChangeText={setTp1Val}
                keyboardType="decimal-pad"
                placeholder={current.tp1.toFixed(2)}
                placeholderTextColor={colors.textTertiary}
                editable={!current.tp1_hit}
                style={{
                  flex: 1,
                  backgroundColor: colors.background,
                  borderRadius: 10,
                  padding: 12,
                  color: '#10B981',
                  fontSize: 18,
                  fontWeight: '700',
                  borderWidth: 1,
                  borderColor: tp1Val ? '#10B98144' : colors.border,
                }}
              />
              {tp1Val && entry > 0 && (
                <Text style={{ color: '#10B981', fontSize: 13, fontWeight: '600', minWidth: 52, textAlign: 'right' }}>
                  {pctLabel(parseFloat(tp1Val))}
                </Text>
              )}
            </View>
          </View>

          {/* TP2 */}
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
            TAKE PROFIT 2 (OPTIONAL){current.tp2_hit ? '  ✓ HIT' : ''}
          </Text>
          <View style={{
            backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 28,
            borderWidth: 1, borderColor: current.tp2_hit ? '#10B98133' : colors.border,
            opacity: current.tp2_hit ? 0.6 : 1,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                Current: {current.tp2 ? `$${current.tp2.toFixed(2)}` : 'Not set'}
              </Text>
              {current.tp2 && (
                <Text style={{ color: '#F59E0B', fontSize: 12 }}>{pctLabel(current.tp2)}</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TextInput
                value={tp2Val}
                onChangeText={setTp2Val}
                keyboardType="decimal-pad"
                placeholder={current.tp2 ? current.tp2.toFixed(2) : 'e.g. 0.65'}
                placeholderTextColor={colors.textTertiary}
                editable={!current.tp2_hit}
                style={{
                  flex: 1,
                  backgroundColor: colors.background,
                  borderRadius: 10,
                  padding: 12,
                  color: '#F59E0B',
                  fontSize: 18,
                  fontWeight: '700',
                  borderWidth: 1,
                  borderColor: tp2Val ? '#F59E0B44' : colors.border,
                }}
              />
              {tp2Val && entry > 0 && (
                <Text style={{ color: '#F59E0B', fontSize: 13, fontWeight: '600', minWidth: 52, textAlign: 'right' }}>
                  {pctLabel(parseFloat(tp2Val))}
                </Text>
              )}
            </View>
          </View>

          {/* Submit */}
          <TouchableOpacity
            onPress={validateAndSubmit}
            disabled={isLoading}
            style={{
              backgroundColor: isLoading ? colors.border : colors.text,
              borderRadius: 12,
              padding: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: colors.background, fontSize: 16, fontWeight: '700' }}>
              {isLoading ? 'Updating…' : 'Update Stop & Targets'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
