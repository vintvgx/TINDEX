import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BE_GRACE_OPTIONS, BE_GRACE_DEFAULT } from '@/common/components/strategy/ExitSafetyControls';

export { BE_GRACE_DEFAULT };

/** Floor choices at entry, as a loss fraction of the fill. null = the stop
 *  type's own default (SL timers carry a 50% floor; Hard Stop has none). */
export const FLOOR_OPTIONS: (number | null)[] = [null, 0.3, 0.5, 0.7];
/** Floor depth the backend arms by default for SL-timer stops — mirrors
 *  profiles.py's grace_fields_for_minutes (sl_outer_floor_pct). Display only. */
export const TIMER_DEFAULT_FLOOR_PCT = 0.5;

/** The floor the backend will actually arm for an entry: the explicit
 *  choice, else the SL timer's default, else none (Hard Stop). */
export function effectiveFloorPct(floorPct: number | null, stopIsTimer: boolean): number | null {
  return floorPct ?? (stopIsTimer ? TIMER_DEFAULT_FLOOR_PCT : null);
}

/**
 * Entry-time worst-case floor + post-TP1 breakeven grace, shown under the
 * stop-type selector on every entry sheet — so both are set when the trade
 * is placed instead of being hand-armed on the position afterward.
 */
export function EntrySafetySelector({ colors, floorPct, onFloorPct, beGrace, onBeGrace, premium, stopIsTimer, defaultFloorHint }: {
  colors: any;
  floorPct: number | null;
  onFloorPct: (v: number | null) => void;
  beGrace: number;
  onBeGrace: (v: number) => void;
  /** Entry premium estimate (ask) — to show the floor as a price. */
  premium: number;
  stopIsTimer: boolean;
  /** Overrides the "Default" floor explanation when the default isn't known
   *  here (e.g. a strategy's own floor on the confirm-entry card). */
  defaultFloorHint?: string;
}) {
  const effective = effectiveFloorPct(floorPct, stopIsTimer);
  return (
    <View style={{ gap: 10 }}>
      <View>
        <Text style={[s.label, { color: colors.textTertiary }]}>WORST-CASE FLOOR</Text>
        <View style={s.chips}>
          {FLOOR_OPTIONS.map(opt => {
            const active = floorPct === opt;
            return (
              <TouchableOpacity
                key={String(opt)}
                onPress={() => onFloorPct(opt)}
                activeOpacity={0.6}
                style={[s.chip, { backgroundColor: active ? colors.text + '14' : 'transparent', borderColor: active ? colors.text : colors.separator }]}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: active ? colors.text : colors.textSecondary }}>
                  {opt == null ? 'Default' : `−${Math.round(opt * 100)}%`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[s.hint, { color: colors.textTertiary }]}>
          {floorPct == null && defaultFloorHint
            ? defaultFloorHint
            : effective == null
            ? 'No floor — the hard stop is the only exit on the way down.'
            : `Sells no matter what at ≈ $${(premium * (1 - effective)).toFixed(2)} (−${Math.round(effective * 100)}%), ignoring every timer.`}
        </Text>
      </View>
      <View>
        <Text style={[s.label, { color: colors.textTertiary }]}>BREAKEVEN GRACE AFTER TP1</Text>
        <View style={s.chips}>
          {BE_GRACE_OPTIONS.map(sec => {
            const active = beGrace === sec;
            return (
              <TouchableOpacity
                key={sec}
                onPress={() => onBeGrace(sec)}
                activeOpacity={0.6}
                style={[s.chip, { backgroundColor: active ? colors.text + '14' : 'transparent', borderColor: active ? colors.text : colors.separator }]}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: active ? colors.text : colors.textSecondary }}>
                  {sec === 0 ? 'Off' : `${sec}s`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[s.hint, { color: colors.textTertiary }]}>
          {beGrace > 0
            ? `After TP1, a dip below breakeven is checked once after ${beGrace}s — still below → sold, back above → held. Falling below the original stop sells immediately.`
            : 'After TP1, the breakeven stop sells on the first confirmed touch.'}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, marginBottom: 7 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, borderWidth: 1 },
  hint: { fontSize: 11.5, lineHeight: 16, marginTop: 6 },
});
