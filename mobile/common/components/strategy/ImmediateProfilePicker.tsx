import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ProfileKey } from '@/common/types/strategy';

/**
 * Profile picker + manual stop-loss picker shared by any "trade this specific
 * contract right now" surface — originally built for ImmediateTradePanel (the
 * Home screen's Trade flow) and reused as-is by TradeContractSheet (the
 * Contracts tab's per-contract trade entry) so both stay visually and
 * behaviorally identical.
 */

export interface ImmediateProfile {
  key: ProfileKey;
  emoji: string;
  name: string;
  qty: number;
  maxLoss: number;  // percent, e.g. 30
  tp1: number;      // percent gain at TP1 (0 = no auto TP)
  tp2: number;      // percent gain at TP2 (0 = runner or none)
  risk: string;
  description: string;
  isManual?: boolean;
  isOtmProfile?: boolean;
  /** No automatic exit of any kind — not even EOD close. Locks qty to 1 and
   *  hides every auto-exit control (SL picker, consol/volume toggles) since
   *  none of them apply. See profiles.py's NO_STOP_LOSS for the backend side. */
  isNoStopLoss?: boolean;
}

export const IMMEDIATE_PROFILES: ImmediateProfile[] = [
  {
    key: 'SCALPER',
    emoji: '⚡',
    name: 'Scalper',
    qty: 3,
    maxLoss: 30,
    tp1: 30,
    tp2: 60,
    risk: 'Low',
    description: 'Quick locks, take gains fast, tight trail on the runner.',
  },
  {
    key: 'PRECISION',
    emoji: '🎯',
    name: 'Precision',
    qty: 2,
    maxLoss: 25,
    tp1: 40,
    tp2: 80,
    risk: 'Low-Med',
    description: 'Disciplined ATM entry, balanced close at both targets.',
  },
  {
    key: 'MOMENTUM',
    emoji: '📈',
    name: 'Momentum',
    qty: 4,
    maxLoss: 40,
    tp1: 20,
    tp2: 50,
    risk: 'Medium',
    description: 'Small TP1 clip, let the bulk of the position run with the trend.',
  },
  {
    key: 'CONVICTION',
    emoji: '💎',
    name: 'Conviction',
    qty: 5,
    maxLoss: 45,
    tp1: 15,
    tp2: 35,
    risk: 'Med-High',
    description: 'High-confidence runner play. Tiny TP1 clip, almost all rides.',
  },
  {
    key: 'ALL_IN',
    emoji: '🔥',
    name: 'All In',
    qty: 8,
    maxLoss: 50,
    tp1: 10,
    tp2: 0,
    risk: 'High',
    description: 'Max size, no TP2 — pure runner trail until EOD or stopped.',
  },
  {
    key: 'OTM_RUNNER',
    emoji: '🚀',
    name: 'OTM Runner',
    qty: 10,
    maxLoss: 60,
    tp1: 100,
    tp2: 250,
    risk: 'High',
    description: 'For contracts under $0.25. TP targets sized for a real underlying move — not bid/ask noise.',
    isOtmProfile: true,
  },
  {
    key: 'OTM_CONVICTION',
    emoji: '🎯',
    name: 'OTM Conviction',
    qty: 6,
    maxLoss: 55,
    tp1: 75,
    tp2: 200,
    risk: 'Med-High',
    description: 'For contracts $0.25–$0.40. High-confidence directional play with room to breathe.',
    isOtmProfile: true,
  },
  {
    key: 'MANUAL',
    emoji: '✋',
    name: 'Manual',
    qty: 2,
    maxLoss: 30,
    tp1: 0,
    tp2: 0,
    risk: 'Custom',
    description: 'You control the exit. Set your stop loss below — nothing else closes automatically.',
    isManual: true,
  },
  {
    key: 'NO_STOP_LOSS',
    emoji: '🧗',
    name: 'No Stop Loss',
    qty: 1,
    maxLoss: 0,
    tp1: 0,
    tp2: 0,
    risk: 'Unbounded',
    description: 'No stop loss, no take profit, no EOD close — holds the contract(s) until you manually sell. Defaults to 1 contract.',
    isNoStopLoss: true,
  },
];

export const DEFAULT_PROFILE_INDEX = 2; // MOMENTUM
export const SL_PRESETS = [20, 30, 40, 50];

// ── Cheap-contract auto stop-type suggestion ──────────────────────────────────
// Above this ask price, a contract is priced well enough that an instant Hard
// Stop is fine — this mirrors the server-side rule in orb_engine.py's
// _execute_entry, which force-applies a grace-timer stop to any fill under
// $0.50 REGARDLESS of what stop type was picked (see the 2026-07-27/2026-07-30
// SL-5/SL-10 discussions). Sizing/profile is no longer part of this — stop
// type is now independent of which profile is selected — so this only
// previews which STOP-TYPE tab the backend will force, not a profile switch.
// Deliberately NOT gated on OTM-ness (the backend rule isn't either — a cheap
// ITM/ATM contract gets the same treatment).
const AUTO_PRICE_CEILING = 0.50;
// Below this ask price, suggest the 10-min timer (longer grace — the noisiest
// tier). Between SL_10_CEILING and AUTO_PRICE_CEILING, suggest 5 min.
const SL_10_CEILING = 0.25;

export function getCheapContractAutoGraceMinutes(askPrice: number): 5 | 10 | null {
  if (askPrice <= 0 || askPrice >= AUTO_PRICE_CEILING) return null;
  return askPrice < SL_10_CEILING ? 10 : 5;
}

export const riskColor = (r: string, colors: any): string => {
  if (r === 'Low')      return '#22C55E';
  if (r === 'Low-Med')  return '#84CC16';
  if (r === 'Medium')   return '#F59E0B';
  if (r === 'Med-High') return '#F97316';
  if (r === 'High')     return '#EF4444';
  return colors.accent; // Custom / OTM
};

// ── ProfileDropdown ───────────────────────────────────────────────────────────

export function ProfileDropdown({
  selectedIndex,
  onSelect,
  colors,
}: {
  selectedIndex: number;
  onSelect: (idx: number) => void;
  colors: any;
}) {
  const [open, setOpen] = useState(false);
  const profile = IMMEDIATE_PROFILES[selectedIndex];

  return (
    <View>
      {/* Trigger */}
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.8}
        style={[s.ddTrigger, { backgroundColor: colors.card, borderColor: open ? colors.accent : colors.border }]}
      >
        <Text style={[s.ddTriggerEmoji]}>{profile.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[s.ddTriggerName, { color: colors.text }]}>{profile.name}</Text>
          <Text style={[s.ddTriggerSub, { color: colors.tabBarInactive }]} numberOfLines={1}>
            {profile.isNoStopLoss
              ? 'No auto exit — hold until you sell'
              : profile.isManual
              ? 'Manual exit — SL only'
              : `Stop −${profile.maxLoss}%  ·  TP1 +${profile.tp1}%  ·  ${profile.tp2 > 0 ? `TP2 +${profile.tp2}%` : 'Runner'}`}
          </Text>
        </View>
        <View style={[s.ddRiskBadge, { backgroundColor: riskColor(profile.risk, colors) + '22' }]}>
          <Text style={[s.ddRiskText, { color: riskColor(profile.risk, colors) }]}>{profile.risk}</Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.tabBarInactive}
          style={{ marginLeft: 6 }}
        />
      </TouchableOpacity>

      {/* Expanded list — scrollable: 11 profiles no longer fit on screen at once,
          and a plain View here used to silently clip/hide whichever ones didn't
          (including No Stop Loss, last in the list) with no way to reach them. */}
      {open && (
        <View style={[s.ddList, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ScrollView style={s.ddScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {IMMEDIATE_PROFILES.map((p, i) => {
            const active = i === selectedIndex;
            const rc = riskColor(p.risk, colors);
            const prevProfile = i > 0 ? IMMEDIATE_PROFILES[i - 1] : null;
            const showOtmHeader = p.isOtmProfile && !prevProfile?.isOtmProfile;
            const showManualHeader = p.isManual && !prevProfile?.isManual;
            const showNoStopLossHeader = p.isNoStopLoss && !prevProfile?.isNoStopLoss;
            return (
              <View key={p.key}>
                {showOtmHeader && (
                  <View style={[s.ddSectionHeader, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
                    <View style={[s.ddSectionDivider, { backgroundColor: colors.border }]} />
                    <Text style={[s.ddSectionLabel, { color: colors.tabBarInactive }]}>OTM CONTRACTS</Text>
                    <View style={[s.ddSectionDivider, { backgroundColor: colors.border }]} />
                  </View>
                )}
                {showManualHeader && (
                  <View style={[s.ddSectionHeader, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
                    <View style={[s.ddSectionDivider, { backgroundColor: colors.border }]} />
                    <Text style={[s.ddSectionLabel, { color: colors.tabBarInactive }]}>MANUAL CONTROL</Text>
                    <View style={[s.ddSectionDivider, { backgroundColor: colors.border }]} />
                  </View>
                )}
                {showNoStopLossHeader && (
                  <View style={[s.ddSectionHeader, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
                    <View style={[s.ddSectionDivider, { backgroundColor: colors.border }]} />
                    <Text style={[s.ddSectionLabel, { color: colors.tabBarInactive }]}>NO AUTO EXIT</Text>
                    <View style={[s.ddSectionDivider, { backgroundColor: colors.border }]} />
                  </View>
                )}
              <TouchableOpacity
                onPress={() => { onSelect(i); setOpen(false); }}
                activeOpacity={0.75}
                style={[
                  s.ddItem,
                  { borderBottomColor: colors.border },
                  active && { backgroundColor: colors.accent + '12' },
                  i === IMMEDIATE_PROFILES.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={s.ddItemHeader}>
                  <Text style={s.ddItemEmoji}>{p.emoji}</Text>
                  <Text style={[s.ddItemName, { color: colors.text }]}>{p.name}</Text>
                  {active && (
                    <Ionicons name="checkmark-circle" size={15} color={colors.accent} style={{ marginLeft: 4 }} />
                  )}
                  <View style={[s.ddRiskBadge, { backgroundColor: rc + '22', marginLeft: 'auto' }]}>
                    <Text style={[s.ddRiskText, { color: rc }]}>{p.risk}</Text>
                  </View>
                </View>
                <Text style={[s.ddItemDesc, { color: colors.tabBarInactive }]}>{p.description}</Text>
                {!p.isManual && !p.isNoStopLoss && (
                  <View style={s.ddItemStats}>
                    <DDStat label="Max Loss" value={`−${p.maxLoss}%`} color="#EF4444" colors={colors} />
                    <DDStat label="TP1"      value={`+${p.tp1}%`}   color="#22C55E" colors={colors} />
                    <DDStat
                      label={p.tp2 > 0 ? 'TP2' : 'Exit'}
                      value={p.tp2 > 0 ? `+${p.tp2}%` : 'Runner'}
                      color={p.tp2 > 0 ? '#22C55E' : colors.accent}
                      colors={colors}
                    />
                    <DDStat label="Qty" value={String(p.qty)} colors={colors} />
                  </View>
                )}
                {p.isManual && (
                  <View style={s.ddItemStats}>
                    <DDStat label="TP1 / TP2" value="None" color={colors.tabBarInactive} colors={colors} />
                    <DDStat label="Stop Loss" value="You set it" color="#EF4444" colors={colors} />
                    <DDStat label="Qty" value={String(p.qty)} colors={colors} />
                  </View>
                )}
                {p.isNoStopLoss && (
                  <View style={s.ddItemStats}>
                    <DDStat label="Stop Loss" value="None" color={colors.tabBarInactive} colors={colors} />
                    <DDStat label="TP1 / TP2" value="None" color={colors.tabBarInactive} colors={colors} />
                    <DDStat label="EOD Close" value="None" color={colors.tabBarInactive} colors={colors} />
                    <DDStat label="Qty" value={`${p.qty} (default)`} colors={colors} />
                  </View>
                )}
              </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
        </View>
      )}
    </View>
  );
}

const DDStat = ({ label, value, color, colors }: { label: string; value: string; color?: string; colors: any }) => (
  <View style={s.ddStatItem}>
    <Text style={[s.ddStatValue, { color: color ?? colors.text }]}>{value}</Text>
    <Text style={[s.ddStatLabel, { color: colors.tabBarInactive }]}>{label}</Text>
  </View>
);

// ── ManualSLPicker ────────────────────────────────────────────────────────────

export function ManualSLPicker({
  slPct,
  onChangePct,
  askPrice,
  colors,
}: {
  slPct: number;
  onChangePct: (pct: number) => void;
  askPrice: number;
  colors: any;
}) {
  const stopPrice = askPrice > 0 ? (askPrice * (1 - slPct / 100)).toFixed(2) : null;

  return (
    <View style={[s.slPickerWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={s.slHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="shield-half-outline" size={14} color="#EF4444" />
          <Text style={[s.slTitle, { color: colors.text }]}>Stop Loss</Text>
        </View>
        <View style={s.slValueRow}>
          <Text style={[s.slPct, { color: '#EF4444' }]}>−{slPct}%</Text>
          {stopPrice && (
            <Text style={[s.slStop, { color: colors.tabBarInactive }]}>
              stop at ${stopPrice}
            </Text>
          )}
        </View>
      </View>

      {/* Preset chips */}
      <View style={s.slPresets}>
        {SL_PRESETS.map(pct => {
          const active = slPct === pct;
          const stopAt = askPrice > 0 ? (askPrice * (1 - pct / 100)).toFixed(2) : null;
          return (
            <TouchableOpacity
              key={pct}
              onPress={() => onChangePct(pct)}
              activeOpacity={0.75}
              style={[
                s.slChip,
                {
                  backgroundColor: active ? '#EF444422' : colors.surface ?? colors.card,
                  borderColor: active ? '#EF4444' : colors.border,
                },
              ]}
            >
              <Text style={[s.slChipPct, { color: active ? '#EF4444' : colors.text }]}>
                −{pct}%
              </Text>
              {stopAt && (
                <Text style={[s.slChipStop, { color: active ? '#EF4444' : colors.tabBarInactive }]}>
                  ${stopAt}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Fine stepper */}
      <View style={[s.slStepper, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => onChangePct(Math.max(10, slPct - 5))}
          style={[s.slStepBtn, { borderColor: colors.border }]}
          hitSlop={8}
        >
          <Ionicons name="remove" size={16} color={colors.text} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[s.slStepValue, { color: colors.text }]}>{slPct}%</Text>
          <Text style={[s.slStepLabel, { color: colors.tabBarInactive }]}>custom</Text>
        </View>
        <TouchableOpacity
          onPress={() => onChangePct(Math.min(75, slPct + 5))}
          style={[s.slStepBtn, { borderColor: colors.border }]}
          hitSlop={8}
        >
          <Ionicons name="add" size={16} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  ddTrigger:      { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  ddTriggerEmoji: { fontSize: 22 },
  ddTriggerName:  { fontSize: 15, fontWeight: '700', marginBottom: 1 },
  ddTriggerSub:   { fontSize: 11 },
  ddRiskBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  ddRiskText:     { fontSize: 10, fontWeight: '700' },
  ddList:         { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginTop: 6, maxHeight: 420 },
  ddScroll:       { maxHeight: 420 },
  ddItem:         { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  ddItemHeader:   { flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 6 },
  ddItemEmoji:    { fontSize: 16 },
  ddItemName:     { fontSize: 14, fontWeight: '700' },
  ddItemDesc:     { fontSize: 11, lineHeight: 15, marginBottom: 8 },
  ddItemStats:    { flexDirection: 'row', gap: 16 },
  ddSectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  ddSectionDivider:{ flex: 1, height: StyleSheet.hairlineWidth },
  ddSectionLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  ddStatItem:      { alignItems: 'center' },
  ddStatValue:    { fontSize: 13, fontWeight: '700' },
  ddStatLabel:    { fontSize: 10, marginTop: 1 },

  slPickerWrap: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  slHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  slTitle:      { fontSize: 13, fontWeight: '700' },
  slValueRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slPct:        { fontSize: 16, fontWeight: '800' },
  slStop:       { fontSize: 11 },
  slPresets:    { flexDirection: 'row', paddingHorizontal: 10, paddingBottom: 10, gap: 8 },
  slChip:       { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  slChipPct:    { fontSize: 13, fontWeight: '700' },
  slChipStop:   { fontSize: 10, marginTop: 2 },
  slStepper:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  slStepBtn:    { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  slStepValue:  { fontSize: 18, fontWeight: '700' },
  slStepLabel:  { fontSize: 10, marginTop: 1 },
});
