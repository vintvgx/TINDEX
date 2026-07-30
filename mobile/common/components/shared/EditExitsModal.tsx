import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  SafeAreaView, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExitEditMode = 'orb';

/** 5/10/15-minute grace timer, or Hard Stop (immediate). Mirrors StopTypeSelector's
 *  StopType but with 15 added — see EditExitsModal's own header comment for why
 *  entry only offers 5/10 while Edit additionally offers 15. */
type EditStopMode = 'HARD' | 'TIMER';
type GraceMinutes = 5 | 10 | 15;

export interface CurrentExits {
  hard_stop: number;       // absolute premium price
  tp1: number;             // absolute premium price
  tp2?: number;            // absolute premium price (optional)
  entry_premium: number;   // for display/validation
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  /** Contracts still open — drives the inline per-level qty stepper below
   *  (only shown when there's more than 1 to split). */
  qty_remaining?: number;
  /** False for a 1-contract entry regardless of profile — hides the TP2
   *  section entirely since it can never fire. */
  use_tp2?: boolean;
  /** Current stop-type configuration — see ExitManager.to_dict(). */
  sl_grace_enabled?: boolean;
  sl_grace_minutes?: number | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  mode: ExitEditMode;
  positionId: string;       // strategy_id for ORB
  ticker: string;
  current: CurrentExits;
  onSubmit: (payload: {
    hard_stop?: number;
    tp1?: number;
    tp2?: number;
    sl_qty?: number;
    tp1_qty?: number;
    tp2_qty?: number;
    sl_grace_minutes?: number | null;
  }) => Promise<void>;
  isLoading?: boolean;
  /** Whether this position is currently hidden from the Dashboard/Live
   *  Positions default view — flips the Hide button to "Unhide". */
  hidden?: boolean;
  /** Toggles the hidden state (e.g. a contract that expired worthless).
   *  Omit to hide the Hide/Unhide action entirely. */
  onToggleHidden?: () => Promise<void>;
  isTogglingHidden?: boolean;
}

const GRACE_OPTIONS: GraceMinutes[] = [5, 10, 15];

// ── Component ─────────────────────────────────────────────────────────────────

export function EditExitsModal({
  visible, onClose, mode, ticker, current, onSubmit, isLoading,
  hidden, onToggleHidden, isTogglingHidden,
}: Props) {
  const colors = useThemeColors();

  const [stopVal, setStopVal] = useState('');
  const [tp1Val, setTp1Val] = useState('');
  const [tp2Val, setTp2Val] = useState('');

  // Stop type — an independent choice from the price itself (see
  // StopTypeSelector for the entry-time equivalent; Edit additionally offers
  // a 15-min tier since there's no need to keep the post-entry picker as
  // minimal as the entry flow).
  const [stopMode, setStopMode] = useState<EditStopMode>('HARD');
  const [graceMinutes, setGraceMinutes] = useState<GraceMinutes>(5);
  const initialStopRef = useRef<{ mode: EditStopMode; minutes: GraceMinutes }>({ mode: 'HARD', minutes: 5 });

  // Per-level qty overrides — how many of qty_remaining to sell at that
  // level, instead of the profile's fixed close percentage. Only meaningful
  // (and only shown) when there's more than 1 contract to split. Lives
  // inline in each level's own card now, not a separate collapsed section —
  // everything about one exit level lives in one place.
  const [slQtyVal, setSlQtyVal]   = useState('');
  const [tp1QtyVal, setTp1QtyVal] = useState('');
  const [tp2QtyVal, setTp2QtyVal] = useState('');
  const canSplit = (current.qty_remaining ?? 0) > 1;

  // TP2 is unreachable for this trade (1-contract entry, or a profile that
  // opts out, e.g. NO_STOP_LOSS's sentinel 999x-entry tp1/tp2) — its section
  // is never rendered (see below), so it must never be pre-filled or
  // validated either. Without this gate, a NO_STOP_LOSS position's hidden
  // tp2Val still got pre-filled from its real (but meaningless) sentinel
  // tp2, which then equalled tp1 and tripped "TP2 must be above TP1" on
  // every submit — including a plain stop-loss-only edit.
  const tp2Editable = current.use_tp2 !== false;

  // Reset fields to current values only on the closed→open transition — `current`
  // comes from a polling query and gets a new object reference on every refetch,
  // so keying this effect on `current` too would wipe out in-progress edits every
  // few seconds while the sheet is open, before the user can hit submit.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setStopVal(current.hard_stop > 0 ? current.hard_stop.toFixed(2) : '');
      setTp1Val(current.tp1 > 0 ? current.tp1.toFixed(2) : '');
      setTp2Val(tp2Editable && current.tp2 && current.tp2 > 0 ? current.tp2.toFixed(2) : '');
      const startMode: EditStopMode = current.sl_grace_enabled ? 'TIMER' : 'HARD';
      const startMinutes = (current.sl_grace_minutes === 5 || current.sl_grace_minutes === 10 || current.sl_grace_minutes === 15)
        ? current.sl_grace_minutes : 5;
      setStopMode(startMode);
      setGraceMinutes(startMinutes);
      initialStopRef.current = { mode: startMode, minutes: startMinutes };
      setSlQtyVal('');
      setTp1QtyVal('');
      setTp2QtyVal('');
    }
    wasVisibleRef.current = visible;
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
    // TP1/TP2 inputs are locked (non-editable) once that target has already
    // been hit, but they still carry their pre-filled value into this
    // validation — so without these hit-checks, raising the stop past an
    // already-filled target (e.g. trailing SL up to lock in TP1 profit)
    // would be rejected using a TP value the user isn't even editing.
    if (!current.tp1_hit && tp1 !== undefined && !isNaN(tp1) && tp1 <= (stop ?? current.hard_stop)) {
      Alert.alert('Invalid', 'TP1 must be above the stop loss.');
      return;
    }
    if (tp1 !== undefined && !isNaN(tp1) && entry > 0 && tp1 <= entry) {
      Alert.alert('Invalid', 'TP1 must be above your entry premium.');
      return;
    }
    if (tp2Editable && !current.tp2_hit && tp2 !== undefined && !isNaN(tp2) && tp2 <= (stop ?? current.hard_stop)) {
      Alert.alert('Invalid', 'TP2 must be above the stop loss.');
      return;
    }
    if (tp2Editable && tp2 !== undefined && tp1 !== undefined && !isNaN(tp2) && !isNaN(tp1) && tp2 <= tp1) {
      Alert.alert('Invalid', 'TP2 must be above TP1.');
      return;
    }

    const qtyRemaining = current.qty_remaining ?? 0;
    const parseQty = (raw: string): number | undefined => raw ? parseInt(raw, 10) : undefined;
    const slQty  = parseQty(slQtyVal);
    const tp1Qty = parseQty(tp1QtyVal);
    const tp2Qty = parseQty(tp2QtyVal);
    for (const [label, qty] of [['Stop-loss', slQty], ['TP1', tp1Qty], ['TP2', tp2Qty]] as const) {
      if (qty !== undefined && (isNaN(qty) || qty < 1 || qty > qtyRemaining)) {
        Alert.alert('Invalid', `${label} quantity must be between 1 and ${qtyRemaining}.`);
        return;
      }
    }

    const payload: Parameters<typeof onSubmit>[0] = {};
    if (stop !== undefined && !isNaN(stop)) payload.hard_stop = stop;
    if (tp1 !== undefined && !isNaN(tp1)) payload.tp1 = tp1;
    if (tp2Editable && tp2 !== undefined && !isNaN(tp2)) payload.tp2 = tp2;
    if (slQty !== undefined) payload.sl_qty = slQty;
    if (tp1Qty !== undefined) payload.tp1_qty = tp1Qty;
    if (tp2Editable && tp2Qty !== undefined) payload.tp2_qty = tp2Qty;

    // Only send sl_grace_minutes if the stop type actually changed from what
    // it was when the sheet opened — same "sparse payload" convention as
    // every other field here.
    const initial = initialStopRef.current;
    const stopTypeChanged = initial.mode !== stopMode || (stopMode === 'TIMER' && initial.minutes !== graceMinutes);
    if (stopTypeChanged) {
      payload.sl_grace_minutes = stopMode === 'TIMER' ? graceMinutes : null;
    }

    if (!Object.keys(payload).length) {
      Alert.alert('No changes', 'Enter at least one value to update.');
      return;
    }

    await onSubmit(payload);
  };

  const handleToggleHidden = () => {
    if (!onToggleHidden) return;
    if (hidden) {
      onToggleHidden();
      return;
    }
    Alert.alert(
      'Hide This Trade?',
      `${ticker} will no longer show on the Dashboard or Live Positions until you unhide it from this same Edit menu.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Hide', onPress: () => onToggleHidden() },
      ],
    );
  };

  const pctLabel = (abs: number | undefined) => {
    if (!abs || !entry) return '';
    const pct = ((abs - entry) / entry) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header — Update button lives here too so a change can be
            submitted without scrolling all the way down past every
            section. Bottom button stays for the natural end-of-form flow. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: colors.border }}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Edit Stop / Target</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
              {ticker} · entry ${entry.toFixed(2)}
              {current.qty_remaining != null ? ` · ${current.qty_remaining} contract${current.qty_remaining !== 1 ? 's' : ''}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={validateAndSubmit}
            disabled={isLoading}
            style={{
              backgroundColor: isLoading ? colors.border : colors.accent,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 9,
              marginLeft: 10,
            }}
          >
            <Text style={{ color: colors.accentForeground ?? '#fff', fontSize: 14, fontWeight: '700' }}>
              {isLoading ? 'Updating…' : 'Update'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>

          {/* Stop Type — Hard Stop fires the instant price touches the stop;
              SL Timer waits 5/10/15 min to see if it recovers first. Lives
              above the Stop Loss price section since it governs how that
              price actually behaves. */}
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
            STOP TYPE
          </Text>
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
            <View style={{ flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, gap: 3 }}>
              {([['HARD', 'Hard Stop'], ['TIMER', 'SL Timer']] as const).map(([m, label]) => {
                const active = stopMode === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setStopMode(m)}
                    activeOpacity={0.75}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, backgroundColor: active ? colors.accent + '22' : 'transparent' }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: active ? colors.accent : colors.textSecondary }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {stopMode === 'TIMER' && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {GRACE_OPTIONS.map(m => {
                  const active = graceMinutes === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setGraceMinutes(m)}
                      activeOpacity={0.75}
                      style={{
                        flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8,
                        borderWidth: 1, borderColor: active ? colors.accent : colors.border,
                        backgroundColor: active ? colors.accent + '14' : colors.background,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: active ? colors.accent : colors.text }}>
                        {m} min
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {stopMode === 'TIMER' && (
              <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15 }}>
                Stop still fires at the price below, but waits {graceMinutes} min to see if it recovers before force-selling.
              </Text>
            )}
          </View>

          {/* Stop Loss */}
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
            STOP LOSS
          </Text>
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
            <View>
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
            {canSplit && (
              <AdvancedQtyRow
                label="Qty to sell"
                value={slQtyVal}
                onChangeText={setSlQtyVal}
                max={current.qty_remaining ?? 0}
                color="#FF453A"
                colors={colors}
              />
            )}
          </View>

          {/* TP1 */}
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
            TAKE PROFIT 1{current.tp1_hit ? '  ✓ HIT' : ''}
          </Text>
          <View style={{
            backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20, gap: 12,
            borderWidth: 1, borderColor: current.tp1_hit ? '#10B98133' : colors.border,
            opacity: current.tp1_hit ? 0.6 : 1,
          }}>
            <View>
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
            {canSplit && (
              <AdvancedQtyRow
                label="Qty to sell"
                value={tp1QtyVal}
                onChangeText={setTp1QtyVal}
                max={current.qty_remaining ?? 0}
                color="#10B981"
                colors={colors}
                disabled={current.tp1_hit}
              />
            )}
          </View>

          {/* TP2 — hidden entirely when unreachable (1-contract entry, or a
              profile that opts out), same gate the position card itself uses. */}
          {tp2Editable && (
            <>
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
                TAKE PROFIT 2 (OPTIONAL){current.tp2_hit ? '  ✓ HIT' : ''}
              </Text>
              <View style={{
                backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 28, gap: 12,
                borderWidth: 1, borderColor: current.tp2_hit ? '#10B98133' : colors.border,
                opacity: current.tp2_hit ? 0.6 : 1,
              }}>
                <View>
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
                {canSplit && (
                  <AdvancedQtyRow
                    label="Qty to sell"
                    value={tp2QtyVal}
                    onChangeText={setTp2QtyVal}
                    max={current.qty_remaining ?? 0}
                    color="#F59E0B"
                    colors={colors}
                    disabled={current.tp2_hit}
                  />
                )}
              </View>
            </>
          )}

          {onToggleHidden && (
            <TouchableOpacity
              onPress={handleToggleHidden}
              disabled={isTogglingHidden}
              style={{
                marginTop: 4,
                borderRadius: 12,
                padding: 14,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: isTogglingHidden ? colors.border : 'transparent',
              }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '600' }}>
                {isTogglingHidden
                  ? (hidden ? 'Unhiding…' : 'Hiding…')
                  : (hidden ? 'Unhide This Trade' : 'Hide This Trade')}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function AdvancedQtyRow({ label, value, onChangeText, max, color, colors, disabled }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  max: number;
  color: string;
  colors: any;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        editable={!disabled}
        placeholder={`of ${max}`}
        placeholderTextColor={colors.textTertiary}
        style={{
          width: 70,
          textAlign: 'center',
          backgroundColor: colors.background,
          borderRadius: 8,
          paddingVertical: 8,
          color,
          fontSize: 15,
          fontWeight: '700',
          borderWidth: 1,
          borderColor: value ? color + '55' : colors.border,
        }}
      />
    </View>
  );
}
