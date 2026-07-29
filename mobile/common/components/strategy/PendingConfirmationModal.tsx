import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { useApprovePendingEntry } from '@/hooks/mutations/strategy/useApprovePendingEntry';
import { useSkipPendingEntry } from '@/hooks/mutations/strategy/useSkipPendingEntry';
import type { PendingConfirmation } from '@/common/types/strategy';

interface Props {
  visible: boolean;
  pending: PendingConfirmation;
  onResolved: () => void;
}

function fmtCountdown(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expiring…';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function confidenceColor(score: number): string {
  if (score >= 70) return '#10B981';
  if (score >= 40) return '#F59E0B';
  return '#FF453A';
}

export function PendingConfirmationModal({ visible, pending, onResolved }: Props) {
  const colors = useThemeColors();
  const toast = useToast();

  const { pendingPriceData, connected } = useStrategyLivePrice(pending.strategy_id, visible);
  const { mutate: approve, isPending: approving } = useApprovePendingEntry();
  const { mutate: skip, isPending: skipping } = useSkipPendingEntry();

  const [stopVal, setStopVal] = useState(pending.hard_stop.toFixed(2));
  const [tp1Val, setTp1Val]   = useState(pending.tp1.toFixed(2));
  const [tp2Val, setTp2Val]   = useState(pending.tp2 != null ? pending.tp2.toFixed(2) : '');
  const [qty, setQty]         = useState(pending.qty);
  const touched = useRef({ hard_stop: false, tp1: false, tp2: false });

  const [, forceTick] = useState(0);

  // Reset per-field edit state when a new (different) confirmation comes in.
  useEffect(() => {
    setStopVal(pending.hard_stop.toFixed(2));
    setTp1Val(pending.tp1.toFixed(2));
    setTp2Val(pending.tp2 != null ? pending.tp2.toFixed(2) : '');
    setQty(pending.qty);
    touched.current = { hard_stop: false, tp1: false, tp2: false };
  }, [pending.id]);

  // Live preview keeps unedited fields in sync with the streaming premium —
  // the moment the user edits a field it's frozen and no longer overwritten.
  useEffect(() => {
    if (!pendingPriceData) return;
    if (!touched.current.hard_stop) setStopVal(pendingPriceData.hard_stop_preview.toFixed(2));
    if (!touched.current.tp1) setTp1Val(pendingPriceData.tp1_preview.toFixed(2));
    if (!touched.current.tp2 && pendingPriceData.tp2_preview != null) {
      setTp2Val(pendingPriceData.tp2_preview.toFixed(2));
    }
  }, [pendingPriceData]);

  // Tick the expiry countdown every second while visible.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [visible]);

  const livePremium = pendingPriceData?.mid_price ?? pending.entry_estimate;
  const confColor = confidenceColor(pending.confidence);
  const isBusy = approving || skipping;

  const handleEnter = () => {
    const overrides: { hard_stop?: number; tp1?: number; tp2?: number; qty?: number } = {};
    if (touched.current.hard_stop) overrides.hard_stop = parseFloat(stopVal);
    if (touched.current.tp1) overrides.tp1 = parseFloat(tp1Val);
    if (touched.current.tp2 && tp2Val) overrides.tp2 = parseFloat(tp2Val);
    if (qty !== pending.qty) overrides.qty = qty;

    approve(
      { strategy_id: pending.strategy_id, pending_id: pending.id, ...overrides },
      {
        // A selection was made either way — the modal must not get stuck on
        // screen. Success closes it with a confirmation toast; a failed
        // request (network error, broker rejection, engine unreachable)
        // still closes it, with an error toast instead. The backend already
        // guarantees the pending row ends up in a terminal state on its
        // side regardless of which of these fires.
        onSuccess: () => { toast.success(`${pending.ticker} entered`); onResolved(); },
        onError:   (e) => { toast.error(e.message || 'Entry failed'); onResolved(); },
      },
    );
  };

  const handleSkip = () => {
    Alert.alert('Skip This Trade?', `Decline the ${pending.direction} ${pending.ticker} signal — the strategy keeps watching for another setup today.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Skip', style: 'destructive',
        onPress: () => skip(
          { strategy_id: pending.strategy_id, pending_id: pending.id },
          {
            onSuccess: () => { toast.info('Trade skipped'); onResolved(); },
            onError:   (e) => { toast.error(e.message || 'Skip failed'); onResolved(); },
          },
        ),
      },
    ]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      // pageSheet — this is now opened via "Edit" from a Dashboard card that
      // already offers Skip/Enter directly (see PendingConfirmationCard), so
      // it no longer needs to be the only way out. Swipe-down-to-dismiss and
      // the header close button both just cancel back to the card, which
      // still shows Skip/Enter for whenever the user does want to act.
      presentationStyle="pageSheet"
      onRequestClose={onResolved}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: colors.border }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>
              {pending.conflict_context ? `${pending.ticker} Already Open` : `Confirm ${pending.ticker} Trade`}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <Badge label={pending.direction} color={pending.direction === 'CALL' ? '#10B981' : '#FF453A'} colors={colors} />
              <Badge label={pending.profile.replace('_', ' ')} color={colors.accent} colors={colors} />
              <Badge label={`Confidence ${pending.confidence.toFixed(0)}/100`} color={confColor} colors={colors} />
            </View>
          </View>
          <TouchableOpacity onPress={onResolved} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* Ticker conflict — another engine already holds this exact
              ticker+direction open (see ORBEngine._find_ticker_conflict) */}
          {pending.conflict_context && (
            <View style={{
              backgroundColor: '#F59E0B18', borderRadius: 14, padding: 14, marginBottom: 20,
              borderWidth: 1, borderColor: '#F59E0B55',
            }}>
              <Text style={{ color: '#F59E0B', fontSize: 13, fontWeight: '700', marginBottom: 4 }}>
                ⚠️ Already have a matching open position
              </Text>
              <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18 }}>
                {(pending.conflict_context.strategy_name || pending.conflict_context.profile.replace('_', ' '))}
                {' '}already has an open {pending.conflict_context.direction} on{' '}
                {pending.conflict_context.ticker}
                {' '}({pending.conflict_context.paper_mode ? 'Paper' : 'Live'}
                {pending.conflict_context.entry_premium != null
                  ? `, entered at $${pending.conflict_context.entry_premium.toFixed(2)}`
                  : ''}
                ). Entering this {pending.profile.replace('_', ' ')} {pending.direction} would stack a
                second position in the same direction on the same ticker.
              </Text>
            </View>
          )}

          {/* Live premium */}
          <View style={{
            backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 20,
            borderWidth: 1, borderColor: colors.border, alignItems: 'center',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? '#10B981' : colors.textTertiary }} />
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.6 }}>
                {connected ? 'LIVE PREMIUM' : 'CONNECTING…'}
              </Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 32, fontWeight: '800' }}>
              ${livePremium.toFixed(2)}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
              {pending.contract_symbol} · ${pending.strike} strike
            </Text>
            <Text style={{ color: colors.warning, fontSize: 12, marginTop: 8, fontWeight: '600' }}>
              Expires in {fmtCountdown(pending.expires_at)}
            </Text>
          </View>

          {/* Contracts */}
          <FieldLabel text="CONTRACTS" colors={colors} />
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: colors.surface, borderRadius: 12, padding: 10, marginBottom: 16,
            borderWidth: 1, borderColor: colors.border,
          }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              Signal default: {pending.qty}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <TouchableOpacity
                onPress={() => setQty(q => Math.max(1, q - 1))}
                style={{ width: 36, height: 36, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>−</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', minWidth: 24, textAlign: 'center' }}>
                {qty}
              </Text>
              <TouchableOpacity
                onPress={() => setQty(q => q + 1)}
                style={{ width: 36, height: 36, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Stop Loss */}
          <FieldLabel text="STOP LOSS" colors={colors} />
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
            <TextInput
              value={stopVal}
              onChangeText={v => { touched.current.hard_stop = true; setStopVal(v); }}
              keyboardType="decimal-pad"
              style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, color: '#FF453A', fontSize: 18, fontWeight: '700', borderWidth: 1, borderColor: '#FF453A44' }}
            />
          </View>

          {/* TP1 */}
          <FieldLabel text="TAKE PROFIT 1" colors={colors} />
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
            <TextInput
              value={tp1Val}
              onChangeText={v => { touched.current.tp1 = true; setTp1Val(v); }}
              keyboardType="decimal-pad"
              style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, color: '#10B981', fontSize: 18, fontWeight: '700', borderWidth: 1, borderColor: '#10B98144' }}
            />
          </View>

          {/* TP2 */}
          <FieldLabel text="TAKE PROFIT 2 (OPTIONAL)" colors={colors} />
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: colors.border }}>
            <TextInput
              value={tp2Val}
              onChangeText={v => { touched.current.tp2 = true; setTp2Val(v); }}
              keyboardType="decimal-pad"
              placeholder="e.g. 0.65"
              placeholderTextColor={colors.textTertiary}
              style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, color: '#F59E0B', fontSize: 18, fontWeight: '700', borderWidth: 1, borderColor: '#F59E0B44' }}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={handleSkip}
              disabled={isBusy}
              style={{ flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: isBusy ? colors.border : 'transparent' }}
            >
              {skipping ? <ActivityIndicator color={colors.text} /> : (
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>Skip</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleEnter}
              disabled={isBusy}
              style={{ flex: 2, borderRadius: 12, paddingVertical: 16, alignItems: 'center', backgroundColor: isBusy ? colors.border : '#10B981' }}
            >
              {approving ? <ActivityIndicator color="#fff" /> : (
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Enter Trade</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Badge({ label, color, colors }: { label: string; color: string; colors: any }) {
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: color + '22', borderWidth: 1, borderColor: color + '55' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function FieldLabel({ text, colors }: { text: string; colors: any }) {
  return (
    <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
      {text}
    </Text>
  );
}
