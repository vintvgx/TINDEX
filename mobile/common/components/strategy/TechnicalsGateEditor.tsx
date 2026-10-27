import React from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ProfileKey, TechnicalsFactor, TechnicalsGate } from '@/common/types/strategy';
import { GateModePicker, NEW_GATE_MODE, gateModeOf } from './GateModePicker';

/**
 * Strategy-editor section for the per-strategy technicals gate: which of the
 * entry-sheet technicals must ALL match before this strategy auto-enters.
 * Backend: ORBEngine._check_technicals_gate → entry_check_service.evaluate_gate.
 */

export const TECHNICALS_FACTORS: { key: TechnicalsFactor; label: string; rule: string }[] = [
  { key: 'trend',          label: 'Trend (daily)',    rule: 'Daily EMA-20 vs EMA-50 aligned with the trade, price on the same side of EMA-20 — the multi-week regime' },
  { key: 'trend_intraday', label: 'Trend (intraday)', rule: '5-min EMA-9 vs EMA-21 aligned, price on the same side of EMA-9 — needs ~105 min of bars (≈10:15 ET), blocks until then' },
  { key: 'rsi',            label: 'RSI-14',           rule: 'Daily, Wilder-smoothed (matches TradingView). 50–70 for calls, 30–50 for puts (not chasing)' },
  { key: 'vwap',   label: 'VWAP',   rule: 'Price above session VWAP for calls, below for puts' },
  { key: 'orb',    label: 'ORB',    rule: 'Price broken out of the opening range in the trade direction' },
  { key: 'sector', label: 'Sector', rule: 'Sector ETF leading SPY for calls, lagging for puts (skipped for ETFs like SPY/IWM)' },
];

/** Recommended required-factor preset per profile. */
export function recommendedGate(profile: ProfileKey): TechnicalsFactor[] {
  // Reversal trades the counter-trend turn: daily trend would forbid it
  // outright (it only ever agrees with the multi-week regime), and RSI, ORB
  // and the 5-min trend all flip AFTER an early reversal entry — VWAP is
  // the one factor that moves with the turn itself.
  if (profile === 'REVERSAL') return ['vwap'];
  return ['trend', 'rsi', 'vwap', 'orb'];
}

interface Props {
  gate: TechnicalsGate | null;
  profile: ProfileKey;
  profileName: string;
  onChange: (gate: TechnicalsGate | null) => void;
  colors: any;
}

export function TechnicalsGateEditor({ gate, profile, profileName, onChange, colors }: Props) {
  const enabled = !!gate?.enabled;
  const required = gate?.required ?? [];
  const mode = gateModeOf(gate);
  const isComposite = mode === 'composite';
  // Spread so a gate saved without `mode` stays mode-less (= daily) on every
  // edit; only a brand-new gate gets NEW_GATE_MODE.
  const base = gate ?? { enabled: true, required: [], mode: NEW_GATE_MODE };
  const muted = colors.tabBarInactive;
  const recommended = recommendedGate(profile);
  const isRecommended = recommended.length === required.length && recommended.every(k => required.includes(k));

  const toggleEnabled = (on: boolean) =>
    onChange(on ? { ...base, enabled: true, required: required.length ? required : recommended } : { ...base, enabled: false, required });

  const toggleFactor = (key: TechnicalsFactor) => {
    const next = required.includes(key) ? required.filter(k => k !== key) : [...required, key];
    // Keep the canonical order so the saved list (and its summary) is stable.
    onChange({ ...base, enabled: true, required: TECHNICALS_FACTORS.map(f => f.key).filter(k => next.includes(k)) });
  };

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={s.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={[s.label, { color: colors.text }]}>Require Technicals</Text>
          <Text style={[s.hint, { color: muted }]}>
            {enabled
              ? isComposite
                ? 'Enters on a composite score of +6 or more (+4/+5 asks you to confirm first) — otherwise the signal is skipped and you get a push'
                : required.length
                  ? `Only enters when all ${required.length} selected technicals match — otherwise the signal is skipped and you get a push`
                  : 'Select at least one technical below'
              : 'Enter on the signal alone, regardless of technicals'}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggleEnabled}
          thumbColor={enabled ? '#30D158' : '#ccc'}
          trackColor={{ true: '#30D15855', false: colors.border }}
        />
      </View>

      {enabled && (
        <View style={[s.modeRow, { borderTopColor: colors.border }]}>
          <Text style={[s.modeLabel, { color: muted }]}>Gate Mode</Text>
          <GateModePicker
            value={mode}
            onChange={m => onChange({ ...base, enabled: true, required, mode: m })}
            profile={profile}
            colors={colors}
          />
          {mode !== 'composite' && (
            <Text style={[s.factorRule, { color: muted, marginTop: 4 }]}>
              {mode === 'daily'
                ? 'Trend + RSI judged on daily bars.'
                : mode === 'intraday'
                  ? 'Trend + RSI judged on 5-min bars (EMA-20/50, RSI-14). VWAP, ORB and sector are the same in every mode.'
                  : 'Trend + RSI must pass on daily AND 5-min bars. VWAP, ORB and sector are the same in every mode.'}
            </Text>
          )}
        </View>
      )}

      {enabled && !isComposite && (
        <>
          {TECHNICALS_FACTORS.map(f => {
            const on = required.includes(f.key);
            return (
              <TouchableOpacity
                key={f.key}
                onPress={() => toggleFactor(f.key)}
                activeOpacity={0.7}
                style={[s.factorRow, { borderTopColor: colors.border }]}
              >
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={21} color={on ? '#30D158' : muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.factorLabel, { color: colors.text }]}>{f.label}</Text>
                  <Text style={[s.factorRule, { color: muted }]}>{f.rule}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <View style={[s.footer, { borderTopColor: colors.border }]}>
            <Text style={[s.summary, { color: required.length ? colors.text : colors.error }]}>
              {required.length
                ? `${required.length}/${required.length} required · ${required.map(k => TECHNICALS_FACTORS.find(f => f.key === k)!.label).join(' + ')}`
                : 'No technicals selected — the gate blocks nothing'}
            </Text>
            {!isRecommended && (
              <TouchableOpacity onPress={() => onChange({ ...base, enabled: true, required: recommended })} hitSlop={8}>
                <Text style={[s.preset, { color: '#4A9EFF' }]}>Use {profileName} preset</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card:        { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 8 },
  headRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  label:       { fontSize: 14, fontWeight: '500' },
  hint:        { fontSize: 12, marginTop: 2 },
  factorRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth },
  factorLabel: { fontSize: 14, fontWeight: '600' },
  factorRule:  { fontSize: 11.5, marginTop: 2, lineHeight: 15 },
  footer:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth },
  summary:     { flex: 1, fontSize: 12.5, fontWeight: '600' },
  preset:      { fontSize: 12.5, fontWeight: '700' },
  modeRow:     { paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  modeLabel:   { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
});
