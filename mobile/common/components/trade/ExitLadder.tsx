import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Trade sheet v2 exit ladder (2026-10-11). Built on the SCALPER profile —
 * TP1 +30%, SL −30%, and the exit manager only arms TP2 when qty > 2 — so:
 *
 *   qty 1   C1 all-out at TP1
 *   qty 2   C1 at TP1 · C2 runner
 *   qty 3   C1 at TP1 · C2 at TP2 (+100% Standard / +60% Risky) · C3 runner
 *   qty ≥4  1 at TP1 · half the rest at TP2 · the rest run
 *
 * `ladderRequest` is what the entry endpoint's `ladder` field gets.
 */

export type LadderSetup = 'standard' | 'risky';

export const LADDER_TP1_PCT = 30;
export const LADDER_SL_PCT = 30;
export const LADDER_TP2_PCT: Record<LadderSetup, number> = { standard: 100, risky: 60 };

export interface LadderRung {
  key: 'tp1' | 'tp2' | 'run';
  /** Contracts this rung closes. */
  qty: number;
  /** Gain % this rung exits at; null = runner. */
  pct: number | null;
}

export function ladderRungs(qty: number, setup: LadderSetup): LadderRung[] {
  if (qty <= 1) return [{ key: 'tp1', qty: 1, pct: LADDER_TP1_PCT }];
  if (qty === 2) return [{ key: 'tp1', qty: 1, pct: LADDER_TP1_PCT }, { key: 'run', qty: 1, pct: null }];
  const tp2 = Math.max(1, Math.floor((qty - 1) / 2));
  return [
    { key: 'tp1', qty: 1, pct: LADDER_TP1_PCT },
    { key: 'tp2', qty: tp2, pct: LADDER_TP2_PCT[setup] },
    ...(qty - 1 - tp2 > 0 ? [{ key: 'run' as const, qty: qty - 1 - tp2, pct: null }] : []),
  ];
}

/** Backend `ladder` overrides for this qty/setup (see _ladder_fields). The
 *  SCALPER defaults (tp1_close_pct 0.34, tp2_close_pct 0.5) already give the
 *  1–3 contract splits; ≥4 pins TP1 to exactly one contract. */
export function ladderRequest(qty: number, setup: LadderSetup) {
  return {
    tp2_mult: 1 + LADDER_TP2_PCT[setup] / 100,
    ...(qty >= 4 ? { tp1_close_pct: Math.min(1, 1 / qty + 0.001), tp2_close_pct: 0.5 } : {}),
  };
}

const RUNG_COLORS = { tp1: '#4ADE80', tp2: '#4A9EFF', run: '#C084FC' } as const;

export function ExitLadder({
  qty, setup, onSetup, ask, slPct, slEnabled, tpEnabled, onToggleSl, onToggleTp, colors,
}: {
  qty: number;
  setup: LadderSetup;
  onSetup: (s: LadderSetup) => void;
  ask: number;
  /** Stop as a loss fraction (alert-matched or the ladder's −30%); null = off. */
  slPct: number | null;
  slEnabled: boolean;
  tpEnabled: boolean;
  onToggleSl: () => void;
  onToggleTp: () => void;
  colors: any;
}) {
  const muted = colors.textSecondary ?? colors.tabBarInactive;
  const rungs = ladderRungs(qty, setup);
  const setupEnabled = qty >= 3;
  let n = 0;

  return (
    <View>
      <View style={[s.setupRow, { opacity: setupEnabled ? 1 : 0.35 }]} pointerEvents={setupEnabled ? 'auto' : 'none'}>
        {(['standard', 'risky'] as const).map((k) => {
          const on = setup === k;
          return (
            <TouchableOpacity
              key={k}
              onPress={() => onSetup(k)}
              activeOpacity={0.75}
              style={[s.setupBtn, { borderColor: on ? '#4A9EFF' : colors.border, backgroundColor: on ? '#4A9EFF14' : colors.card }]}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: on ? colors.text : muted }}>
                {k === 'standard' ? 'Standard' : 'Risky'}
              </Text>
              <Text style={{ fontSize: 10.5, color: muted, marginTop: 1 }}>C2 takes +{LADDER_TP2_PCT[k]}%</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ opacity: tpEnabled ? 1 : 0.4 }}>
        {rungs.map((r) => {
          const from = n + 1;
          n += r.qty;
          const label = r.qty === 1 ? `C${from}` : `C${from}–${n}`;
          const price = r.pct != null ? ask * (1 + r.pct / 100) : null;
          const perContract = r.pct != null ? ask * (r.pct / 100) * 100 : null;
          return (
            <View key={r.key} style={[s.rung, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[s.cn, { backgroundColor: colors.surfaceSecondary ?? colors.border }]}>
                <Text style={{ fontSize: 10.5, fontWeight: '800', color: muted }}>{label}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '800', color: colors.text }}>
                  {r.pct != null ? `Take profit +${r.pct}%` : 'Runner'}
                  {qty === 1 && r.key === 'tp1' ? ' · all out' : ''}
                </Text>
                <Text style={[s.tab, { fontSize: 10.5, color: muted }]}>
                  {price != null ? `$${price.toFixed(2)} · +$${perContract!.toFixed(2)} / contract` : 'trailing stop'}
                </Text>
              </View>
              <Text style={[s.tab, { fontSize: 13.5, fontWeight: '800', color: RUNG_COLORS[r.key] }]}>
                {perContract != null ? `+$${(perContract * r.qty).toFixed(2)}` : '∞'}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={[s.slBand, { backgroundColor: colors.error + '12', borderColor: colors.error + '40', opacity: slEnabled ? 1 : 0.4 }]}>
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.error }}>
          {slPct != null
            ? `SL −${Math.round(slPct * 100)}% · $${(ask * (1 - slPct)).toFixed(2)} all contracts`
            : 'Stop loss off'}
        </Text>
        {slPct != null && (
          <Text style={[s.tab, { fontSize: 12, fontWeight: '700', color: colors.error }]}>
            −${(ask * slPct * 100).toFixed(2)} / contract
          </Text>
        )}
      </View>

      <View style={s.armRow}>
        <ArmPill label="Stop Loss" on={slEnabled} onPress={onToggleSl} colors={colors} />
        <ArmPill label="Take Profit" on={tpEnabled} onPress={onToggleTp} colors={colors} />
      </View>
    </View>
  );
}

function ArmPill({ label, on, onPress, colors }: { label: string; on: boolean; onPress: () => void; colors: any }) {
  const c = on ? colors.success : colors.textTertiary ?? colors.tabBarInactive;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[s.arm, { borderColor: colors.border, backgroundColor: colors.card }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
    >
      <View style={[s.dot, { backgroundColor: c }]} />
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.text }}>{label}</Text>
      <Text style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8, color: c }}>
        {on ? 'ARMED' : 'OFF'}
      </Text>
      <Ionicons name="swap-horizontal" size={11} color={colors.textTertiary ?? colors.tabBarInactive} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  tab: { fontVariant: ['tabular-nums'] },
  setupRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  setupBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  rung: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, marginTop: 7 },
  cn: { minWidth: 30, height: 30, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  slBand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 7 },
  armRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  arm: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 9 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
