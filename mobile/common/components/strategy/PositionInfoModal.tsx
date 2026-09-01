import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView, TextInput, StyleSheet,
  SafeAreaView, Alert, Switch, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatContractSymbolShort } from '@/lib/formatContract';
import { PROFILES } from '@/common/components/strategy/ProfileGuideModal';
import { IMMEDIATE_PROFILES } from '@/common/components/strategy/ImmediateProfilePicker';
import { RUNNER_MODE_LABEL } from '@/common/utils/strategy/runnerModeLabel';
import { useUpdateStrategyExits } from '@/hooks/mutations/strategy/useUpdateStrategyExits';
import { useHiddenPositions } from '@/hooks/useHiddenPositions';
import { useToast } from '@/common/components/ui/Toast';
import type { ProfileKey } from '@/common/types/strategy';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';

export interface PositionInfoData {
  ticker: string;
  direction?: 'CALL' | 'PUT';
  contract?: string;
  paperMode?: boolean;
  isSwing?: boolean;
  entry_premium: number;
  mid_price: number;
  qty_remaining: number;
  pnl: number;
  pnl_pct: number;
  hard_stop: number;
  tp1: number;
  tp2?: number;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  showTp2?: boolean;
  slEnabled?: boolean;
  tpEnabled?: boolean;
  sl_grace_enabled?: boolean;
  sl_grace_minutes?: number | null;
  runner_mode?: 'trail' | 'be_hold' | 'none';
  runner_trail?: number;
  cascade_enabled?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: any;
  profile?: ProfileKey;
  data: PositionInfoData;
  /** ORB strategy_id — required to submit any edit. Omit to render this as
   *  read-only (view-only, no Save button, no toggles wired to a mutation). */
  strategyId?: string;
  /** Called with the submitted fields right after the server confirms —
   *  patches the caller's locally-held WS snapshot immediately instead of
   *  waiting on the next price tick. */
  onUpdated?: (payload: Partial<LivePriceData>) => void;
  /** Stable per-trade key for the client-only hide feature — see
   *  lib/positionHideKey.ts. Must be the SAME key the caller's position list
   *  filters on (e.g. positionHideKey(pos)) — this modal never derives its
   *  own, since a mismatched key would hide/unhide a key nothing reads. */
  hideKey?: string;
}

const RISK_COLOR: Record<string, string> = {
  Low: '#22C55E', Medium: '#F59E0B', High: '#EF4444', 'Med-High': '#F59E0B',
  Custom: '#8B5CF6', Unbounded: '#EF4444',
};

interface ProfileSummary {
  emoji: string;
  name: string;
  description: string;
  concept?: string;
  risk: string;
  riskColor: string;
}

/**
 * PROFILES (from ProfileGuideModal) only covers the 7 automated-ORB-strategy
 * profiles (BULL_DOG, THUNDER_CAT, ...) — every immediate/manual-trade
 * profile (MOMENTUM, SCALPER*, MANUAL, CONVICTION, ...) simply isn't in it,
 * so a plain PROFILES.find() silently came back empty for most real live
 * positions (those are almost all immediate trades) and the whole Profile
 * section never rendered. Falls back to IMMEDIATE_PROFILES — the picker's
 * own emoji/name/description/risk data — for exactly that case.
 */
function getProfileSummary(key?: ProfileKey): ProfileSummary | null {
  if (!key) return null;
  const guide = PROFILES.find((p) => p.key === key);
  if (guide) {
    return { emoji: guide.emoji, name: guide.name, description: guide.tagline, concept: guide.concept, risk: guide.risk, riskColor: guide.riskColor };
  }
  const imm = IMMEDIATE_PROFILES.find((p) => p.key === key);
  if (imm) {
    return { emoji: imm.emoji, name: imm.name, description: imm.description, risk: imm.risk, riskColor: RISK_COLOR[imm.risk] ?? '#8B5CF6' };
  }
  return null;
}

type GraceMinutes = 5 | 10 | 15;
const GRACE_OPTIONS: GraceMinutes[] = [5, 10, 15];
const RUNNER_MODE_OPTIONS: { key: 'trail' | 'be_hold' | 'none'; label: string }[] = [
  { key: 'trail', label: 'Trail' },
  { key: 'be_hold', label: 'BE Hold' },
  { key: 'none', label: 'No Trail' },
];

/**
 * The single "everything about this position" surface — Robinhood-inspired:
 * one hero number, quiet dividers instead of boxed cards, big legible
 * editable fields. This is now the ONLY place stop/TP price and SL/TP
 * on-off get edited from a live position card — it replaces the old
 * "tap to expand inline" + separate EditExitsModal split (still used
 * as-is by the automated Strategy screen, untouched) with one sheet that's
 * both the detail view AND the quick-edit surface, so there's no second tap
 * to get from "look" to "edit". Renders the profile's guide content (from
 * PROFILES, the same data ProfileGuideModal reads) INLINE rather than a
 * second native Modal — RN only reliably presents one Modal at a time.
 */
export function PositionInfoModal({ visible, onClose, colors, profile, data, strategyId, onUpdated, hideKey: hideKeyProp }: Props) {
  const toast = useToast();
  const guide = getProfileSummary(profile);
  const accentColor = data.direction === 'PUT' ? colors.error : colors.success;
  const pnlColor = data.pnl >= 0 ? colors.success : colors.error;
  const marketValue = data.mid_price * data.qty_remaining * 100;

  const editable = !!strategyId;
  const mutation = useUpdateStrategyExits();
  const { isHidden, setHidden } = useHiddenPositions();
  const hideKey = hideKeyProp ?? '';
  const hidden = !!hideKeyProp && isHidden(hideKey);

  // ── Edit state — reset to `data` only on the closed→open transition, same
  // as EditExitsModal, so `data` refreshing from a poll every few seconds
  // never wipes an in-progress edit while the sheet is open. ──
  const [stopVal, setStopVal] = useState('');
  const [tp1Val, setTp1Val] = useState('');
  const [tp2Val, setTp2Val] = useState('');
  const [slOn, setSlOn] = useState(true);
  const [tpOn, setTpOn] = useState(true);
  const [stopMode, setStopMode] = useState<'HARD' | 'TIMER'>('HARD');
  const [graceMinutes, setGraceMinutes] = useState<GraceMinutes>(5);
  const [runnerMode, setRunnerMode] = useState<'trail' | 'be_hold' | 'none'>('trail');
  const [cascadeOn, setCascadeOn] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const initial = useRef({
    sl: true, tp: true, stopMode: 'HARD' as 'HARD' | 'TIMER', minutes: 5 as GraceMinutes,
    runnerMode: 'trail' as 'trail' | 'be_hold' | 'none', cascade: true,
  });

  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setStopVal('');
      setTp1Val('');
      setTp2Val('');
      const sl = data.slEnabled !== false;
      const tp = data.tpEnabled !== false;
      setSlOn(sl);
      setTpOn(tp);
      const sMode: 'HARD' | 'TIMER' = data.sl_grace_enabled ? 'TIMER' : 'HARD';
      const sMinutes = (data.sl_grace_minutes === 5 || data.sl_grace_minutes === 10 || data.sl_grace_minutes === 15)
        ? data.sl_grace_minutes : 5;
      setStopMode(sMode);
      setGraceMinutes(sMinutes);
      const rMode = data.runner_mode ?? 'trail';
      const rCascade = data.cascade_enabled ?? true;
      setRunnerMode(rMode);
      setCascadeOn(rCascade);
      setAdvancedOpen(false);
      initial.current = { sl, tp, stopMode: sMode, minutes: sMinutes, runnerMode: rMode, cascade: rCascade };
    }
    wasVisibleRef.current = visible;
  }, [visible, data]);

  const canSplit = data.qty_remaining > 1;
  const tp2Editable = data.showTp2 !== false;
  const entry = data.entry_premium;

  const dirty =
    !!stopVal || !!tp1Val || !!tp2Val ||
    slOn !== initial.current.sl || tpOn !== initial.current.tp ||
    (slOn && (stopMode !== initial.current.stopMode || (stopMode === 'TIMER' && graceMinutes !== initial.current.minutes))) ||
    (canSplit && (runnerMode !== initial.current.runnerMode || cascadeOn !== initial.current.cascade));

  const pctLabel = (abs: number | undefined) => {
    if (!abs || !entry) return '';
    const pct = ((abs - entry) / entry) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  const handleSave = async () => {
    const stop = stopVal ? parseFloat(stopVal) : undefined;
    const tp1  = tp1Val ? parseFloat(tp1Val) : undefined;
    const tp2  = tp2Val ? parseFloat(tp2Val) : undefined;

    if (stop !== undefined && (isNaN(stop) || stop <= 0)) {
      Alert.alert('Invalid', 'Stop loss must be a positive price.');
      return;
    }
    if (!data.tp1_hit && tp1 !== undefined && !isNaN(tp1) && tp1 <= (stop ?? data.hard_stop)) {
      Alert.alert('Invalid', 'TP1 must be above the stop loss.');
      return;
    }
    if (tp1 !== undefined && !isNaN(tp1) && entry > 0 && tp1 <= entry) {
      Alert.alert('Invalid', 'TP1 must be above your entry premium.');
      return;
    }
    if (tp2Editable && !data.tp2_hit && tp2 !== undefined && !isNaN(tp2) && tp1 !== undefined && !isNaN(tp1) && tp2 <= tp1) {
      Alert.alert('Invalid', 'TP2 must be above TP1.');
      return;
    }

    const slChanged = slOn !== initial.current.sl;
    const tpChanged = tpOn !== initial.current.tp;
    if (slChanged && slOn && stop === undefined && !(data.hard_stop > 0)) {
      Alert.alert('Stop Loss Price Required', 'Enter a stop-loss price to turn Stop Loss back on.');
      return;
    }
    if (tpChanged && tpOn && tp1 === undefined && !(data.tp1 > entry)) {
      Alert.alert('Take Profit Price Required', 'Enter a TP1 price to turn Take Profit back on.');
      return;
    }

    const payload: Parameters<typeof mutation.mutateAsync>[0] = { strategy_id: strategyId! };
    if (stop !== undefined && !isNaN(stop)) payload.hard_stop = stop;
    if (tp1 !== undefined && !isNaN(tp1)) payload.tp1 = tp1;
    if (tp2Editable && tp2 !== undefined && !isNaN(tp2)) payload.tp2 = tp2;
    if (slChanged) payload.sl_enabled = slOn;
    if (tpChanged) payload.tp_enabled = tpOn;
    if (slOn && (stopMode !== initial.current.stopMode || (stopMode === 'TIMER' && graceMinutes !== initial.current.minutes))) {
      payload.sl_grace_minutes = stopMode === 'TIMER' ? graceMinutes : null;
    }
    if (canSplit && runnerMode !== initial.current.runnerMode) payload.runner_mode = runnerMode;
    if (canSplit && cascadeOn !== initial.current.cascade) payload.cascade_enabled = cascadeOn;

    try {
      await mutation.mutateAsync(payload);
      const { strategy_id: _sid, ...patch } = payload;
      const derived = 'sl_grace_minutes' in patch
        ? { ...patch, sl_grace_enabled: patch.sl_grace_minutes != null }
        : patch;
      onUpdated?.(derived);
      toast.success('Position updated');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const handleToggleHidden = () => {
    if (hidden) {
      setHidden(hideKey, false);
      toast.success(`${data.ticker} unhidden`);
      return;
    }
    Alert.alert(
      'Hide This Trade?',
      `${data.ticker} will no longer show on the Dashboard or Live Positions until you unhide it from this same sheet.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Hide', onPress: () => { setHidden(hideKey, true); toast.success(`${data.ticker} hidden`); onClose(); } },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: colors.text }]}>{data.ticker}</Text>
            {!!data.contract && (
              <Text style={[s.subtitle, { color: colors.textTertiary }]} numberOfLines={1}>
                {formatContractSymbolShort(data.contract)}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={[s.closeBtn, { backgroundColor: colors.text + '0F' }]}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Hero */}
            <Text style={[s.heroValue, { color: colors.text }]}>${marketValue.toFixed(2)}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Text style={[s.heroPnl, { color: pnlColor }]}>
                {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)} ({data.pnl_pct >= 0 ? '+' : ''}{data.pnl_pct.toFixed(1)}%)
              </Text>
            </View>

            {/* Flags */}
            <View style={s.flagRow}>
              {!!data.direction && <Flag label={data.direction} color={accentColor} />}
              {data.paperMode && <Flag label="PAPER" color="#FF9F0A" />}
              {data.isSwing && <Flag label="SWING" color="#A855F7" />}
              {!slOn && <Flag label="NO SL" color={colors.error} />}
              {!tpOn && <Flag label="NO TP" color="#FF9F0A" />}
            </View>

            {/* Position quick stats */}
            <View style={[s.divider, { backgroundColor: colors.separator }]} />
            <View style={s.quickStatsRow}>
              <QuickStat label="Entry" value={`$${data.entry_premium.toFixed(2)}`} colors={colors} />
              <QuickStat label="Current" value={`$${data.mid_price.toFixed(2)}`} colors={colors} />
              <QuickStat label="Qty" value={String(data.qty_remaining)} colors={colors} />
            </View>

            {/* ── Stop Loss ── */}
            <View style={[s.divider, { backgroundColor: colors.separator }]} />
            <SectionHeader
              label="STOP LOSS"
              colors={colors}
              right={editable && (
                <Switch
                  value={slOn}
                  onValueChange={setSlOn}
                  trackColor={{ false: colors.border, true: colors.error + '66' }}
                  thumbColor={slOn ? colors.error : undefined}
                />
              )}
            />
            {editable ? (
              <View style={{ opacity: slOn ? 1 : 0.45 }}>
                <View style={s.editRow}>
                  <TextInput
                    value={stopVal}
                    onChangeText={setStopVal}
                    keyboardType="decimal-pad"
                    placeholder={data.hard_stop.toFixed(2)}
                    placeholderTextColor={colors.textTertiary}
                    style={[s.editInput, { color: colors.error }]}
                  />
                  <Text style={{ color: colors.error, fontSize: 13, fontWeight: '600' }}>
                    {pctLabel(stopVal ? parseFloat(stopVal) : data.hard_stop)}
                  </Text>
                </View>
                {!slOn && (
                  <Text style={[s.hintText, { color: colors.textTertiary }]}>
                    No stop loss — this runner rides its own course, including into close.
                  </Text>
                )}
              </View>
            ) : (
              <Text style={[s.readonlyValue, { color: slOn ? colors.error : colors.textTertiary }]}>
                {slOn ? `$${data.hard_stop.toFixed(2)}` : 'Disabled'}
              </Text>
            )}

            {/* ── Take Profit ── */}
            <View style={[s.divider, { backgroundColor: colors.separator }]} />
            <SectionHeader
              label={`TAKE PROFIT${data.tp1_hit ? ' · TP1 HIT' : ''}`}
              colors={colors}
              right={editable && !data.tp1_hit && (
                <Switch
                  value={tpOn}
                  onValueChange={setTpOn}
                  trackColor={{ false: colors.border, true: colors.success + '66' }}
                  thumbColor={tpOn ? colors.success : undefined}
                />
              )}
            />
            {editable ? (
              <View style={{ opacity: (tpOn || data.tp1_hit) ? 1 : 0.45 }}>
                <View style={s.editRow}>
                  <TextInput
                    value={tp1Val}
                    onChangeText={setTp1Val}
                    keyboardType="decimal-pad"
                    editable={!data.tp1_hit}
                    placeholder={data.tp1.toFixed(2)}
                    placeholderTextColor={colors.textTertiary}
                    style={[s.editInput, { color: colors.success }]}
                  />
                  <Text style={{ color: colors.success, fontSize: 13, fontWeight: '600' }}>
                    {pctLabel(tp1Val ? parseFloat(tp1Val) : data.tp1)}
                  </Text>
                </View>
                {tp2Editable && (tpOn || data.tp2_hit) && (
                  <View style={[s.editRow, { marginTop: 8 }]}>
                    <Text style={[s.tp2Label, { color: colors.textTertiary }]}>TP2</Text>
                    <TextInput
                      value={tp2Val}
                      onChangeText={setTp2Val}
                      keyboardType="decimal-pad"
                      editable={!data.tp2_hit}
                      placeholder={data.tp2 ? data.tp2.toFixed(2) : 'optional'}
                      placeholderTextColor={colors.textTertiary}
                      style={[s.editInput, { flex: 1, color: colors.success, fontSize: 15 }]}
                    />
                  </View>
                )}
                {!tpOn && !data.tp1_hit && (
                  <Text style={[s.hintText, { color: colors.textTertiary }]}>
                    No take profit — this runner rides its own course, including into close.
                  </Text>
                )}
              </View>
            ) : (
              <Text style={[s.readonlyValue, { color: tpOn ? colors.success : colors.textTertiary }]}>
                {tpOn ? `$${data.tp1.toFixed(2)}${data.tp1_hit ? ' · Hit' : ''}` : 'Disabled'}
              </Text>
            )}

            {/* ── Runner (only when there's something to manage) ── */}
            {canSplit && (
              <>
                <View style={[s.divider, { backgroundColor: colors.separator }]} />
                <SectionHeader label="RUNNER" colors={colors} />
                {editable ? (
                  <>
                    <View style={[s.segmented, { borderColor: colors.separator }]}>
                      {RUNNER_MODE_OPTIONS.map(({ key, label }) => {
                        const active = runnerMode === key;
                        return (
                          <TouchableOpacity
                            key={key}
                            onPress={() => setRunnerMode(key)}
                            activeOpacity={0.75}
                            style={[s.segmentBtn, active && { backgroundColor: colors.text + '12' }]}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '700', color: active ? colors.text : colors.textTertiary }}>
                              {label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={s.inlineSwitchRow}>
                      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Cascade exit</Text>
                      <Switch
                        value={cascadeOn}
                        onValueChange={setCascadeOn}
                        trackColor={{ false: colors.border, true: '#A855F766' }}
                        thumbColor={cascadeOn ? '#A855F7' : undefined}
                      />
                    </View>
                  </>
                ) : (
                  <Text style={[s.readonlyValue, { color: colors.text }]}>
                    {data.runner_mode === 'trail' && data.runner_trail != null
                      ? `Trail $${data.runner_trail.toFixed(2)}`
                      : RUNNER_MODE_LABEL[data.runner_mode ?? 'trail']}
                  </Text>
                )}
              </>
            )}

            {/* ── Advanced (stop type, per-level qty) — collapsed by default ── */}
            {editable && slOn && (
              <>
                <View style={[s.divider, { backgroundColor: colors.separator }]} />
                <TouchableOpacity onPress={() => setAdvancedOpen(v => !v)} activeOpacity={0.7} style={s.advancedToggle}>
                  <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>ADVANCED</Text>
                  <Ionicons name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                {advancedOpen && (
                  <View style={{ gap: 12, marginTop: 10 }}>
                    <View>
                      <Text style={[s.hintText, { color: colors.textTertiary, marginBottom: 8 }]}>Stop type</Text>
                      <View style={[s.segmented, { borderColor: colors.separator }]}>
                        {([['HARD', 'Hard Stop'], ['TIMER', 'SL Timer']] as const).map(([m, label]) => {
                          const active = stopMode === m;
                          return (
                            <TouchableOpacity
                              key={m}
                              onPress={() => setStopMode(m)}
                              activeOpacity={0.75}
                              style={[s.segmentBtn, active && { backgroundColor: colors.text + '12' }]}
                            >
                              <Text style={{ fontSize: 13, fontWeight: '700', color: active ? colors.text : colors.textTertiary }}>
                                {label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
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
                              style={[s.chip, { borderColor: active ? colors.text : colors.separator, backgroundColor: active ? colors.text + '12' : 'transparent' }]}
                            >
                              <Text style={{ fontSize: 13, fontWeight: '700', color: active ? colors.text : colors.textSecondary }}>{m} min</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </>
            )}

            {/* Profile */}
            {guide && (
              <>
                <View style={[s.divider, { backgroundColor: colors.separator }]} />
                <SectionHeader label="PROFILE" colors={colors} />
                <View style={s.profileHeaderRow}>
                  <Text style={s.profileEmoji}>{guide.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.profileName, { color: colors.text }]}>{guide.name}</Text>
                    <Text style={[s.profileTagline, { color: colors.textSecondary }]}>{guide.description}</Text>
                  </View>
                  <Text style={{ color: guide.riskColor, fontSize: 12, fontWeight: '700' }}>{guide.risk}</Text>
                </View>
                {!!guide.concept && (
                  <Text style={[s.profileConcept, { color: colors.textSecondary }]}>{guide.concept}</Text>
                )}
              </>
            )}

            {/* Hide */}
            {!!hideKeyProp && (
              <TouchableOpacity onPress={handleToggleHidden} activeOpacity={0.7} style={{ marginTop: 24, alignItems: 'center' }}>
                <Text style={{ color: colors.textTertiary, fontSize: 13, fontWeight: '600' }}>
                  {hidden ? 'Unhide This Trade' : 'Hide This Trade'}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {editable && dirty && (
            <View style={[s.saveBar, { backgroundColor: colors.background, borderTopColor: colors.separator }]}>
              <TouchableOpacity
                onPress={handleSave}
                disabled={mutation.isPending}
                activeOpacity={0.85}
                style={[s.saveBtn, { backgroundColor: mutation.isPending ? colors.border : colors.text }]}
              >
                {mutation.isPending ? (
                  <ActivityIndicator color={colors.background} />
                ) : (
                  <Text style={[s.saveBtnText, { color: colors.background }]}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function Flag({ label, color }: { label: string; color: string }) {
  return (
    <View style={[s.flag, { backgroundColor: color + '1A' }]}>
      <Text style={[s.flagText, { color }]}>{label}</Text>
    </View>
  );
}

function SectionHeader({ label, colors, right }: { label: string; colors: any; right?: React.ReactNode }) {
  return (
    <View style={s.sectionHeaderRow}>
      <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>{label}</Text>
      {right}
    </View>
  );
}

function QuickStat({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 10.5, fontWeight: '600', marginBottom: 2 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title:     { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  subtitle:  { fontSize: 13, marginTop: 2 },
  closeBtn:  { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },

  heroValue: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8, marginTop: 6 },
  heroPnl:   { fontSize: 15, fontWeight: '700' },

  flagRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  flag:      { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
  flagText:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  divider:   { height: StyleSheet.hairlineWidth, marginVertical: 18 },

  quickStatsRow: { flexDirection: 'row' },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionLabel:      { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },

  editRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  editInput: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, flex: 1, padding: 0 },
  tp2Label:  { fontSize: 12, fontWeight: '700', width: 32 },
  readonlyValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  hintText:  { fontSize: 12, lineHeight: 16, marginTop: 8 },

  segmented: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, gap: 3 },
  segmentBtn:{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  chip:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  inlineSwitchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },

  advancedToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  profileHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  profileEmoji:     { fontSize: 24 },
  profileName:      { fontSize: 14.5, fontWeight: '700' },
  profileTagline:   { fontSize: 12, marginTop: 2, lineHeight: 16 },
  profileConcept:   { fontSize: 12.5, lineHeight: 18, marginTop: 10 },

  saveBar: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '700' },
});
