import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProfileKey, TechnicalsGate, TechnicalsGateMode } from '@/common/types/strategy';

/**
 * Gate Mode segmented control — Daily / Intraday / Both (AND), plus Score
 * (composite) for breakout profiles. Backend: entry_check_service.GATE_MODES.
 *
 * A gate saved before modes existed has no `mode` and keeps judging on
 * daily bars — it is never switched silently (TODO c8fc1694). Only a NEW
 * gate starts on Both.
 */

export const GATE_MODES: { key: TechnicalsGateMode; label: string; note: string }[] = [
  { key: 'daily',     label: 'Daily',      note: 'Daily = slower, more selective (multi-day trend).' },
  { key: 'intraday',  label: 'Intraday',   note: 'Intraday = faster, catches moves early (5-min trend + RSI).' },
  { key: 'and',       label: 'Both (AND)', note: 'Both = strictest, highest quality — daily AND 5-min must pass.' },
  { key: 'composite', label: 'Score',      note: 'Score = composite -14..+14: +6 enters, +4/+5 enters with confirm-first, lower is skipped. Factor picks are ignored.' },
];

export const NEW_GATE_MODE: TechnicalsGateMode = 'and';

export function gateModeOf(gate: TechnicalsGate | null | undefined, profile?: ProfileKey | string): TechnicalsGateMode {
  const m = gate?.mode;
  // REVERSAL keeps its binary VWAP gate — a saved composite mode is its
  // effective daily mode, never Score. Normalizing here means every
  // display (and every save flowing through an editor) shows daily.
  if (profile === 'REVERSAL' && m === 'composite') return 'daily';
  return m === 'intraday' || m === 'and' || m === 'composite' ? m : 'daily';
}

/** REVERSAL keeps its binary VWAP gate — the composite score is for breakouts. */
export function gateModesFor(profile: ProfileKey | string | undefined) {
  if (profile !== 'REVERSAL') return GATE_MODES;
  return GATE_MODES.filter(m => m.key !== 'composite');
}

export function gateModeLabel(mode: TechnicalsGateMode): string {
  return GATE_MODES.find(m => m.key === mode)?.label ?? 'Daily';
}

export function GateModePicker({
  value, onChange, profile, colors, disabled, showNote = true, modes,
}: {
  value: TechnicalsGateMode;
  onChange: (m: TechnicalsGateMode) => void;
  profile?: ProfileKey | string;
  colors: any;
  disabled?: boolean;
  showNote?: boolean;
  /** Override the option list (e.g. the chart sheet hides Score unless active). */
  modes?: typeof GATE_MODES;
}) {
  const options = modes ?? gateModesFor(profile);
  const active = '#22c55e';
  return (
    <View style={{ opacity: disabled ? 0.5 : 1 }}>
      <View style={[s.pills, { backgroundColor: colors.surfaceSecondary ?? colors.card }]}>
        {options.map(m => {
          const on = m.key === value;
          return (
            <TouchableOpacity
              key={m.key}
              disabled={disabled}
              onPress={() => !on && onChange(m.key)}
              activeOpacity={0.7}
              style={[s.pill, on && { backgroundColor: active }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.pillText, { color: on ? '#000' : colors.textSecondary ?? colors.tabBarInactive }]} numberOfLines={1}>
                {m.label}{on ? ' ✓' : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {showNote && (
        <Text style={[s.note, { color: colors.textTertiary ?? colors.tabBarInactive }]}>
          {value === 'composite'
            ? GATE_MODES[3].note
            : 'Both = strictest, highest quality. Daily = slower, more selective. Intraday = faster, catches moves early.'}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  pills:    { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 4 },
  pill:     { flex: 1, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, borderRadius: 9 },
  pillText: { fontSize: 13, fontWeight: '600' },
  note:     { fontSize: 11, marginTop: 6, lineHeight: 15 },
});