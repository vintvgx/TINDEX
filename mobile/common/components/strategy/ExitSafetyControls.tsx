import { View, Text, TextInput, Switch, TouchableOpacity, StyleSheet } from 'react-native';

export const BE_GRACE_OPTIONS = [0, 60, 90, 120] as const;
export const BE_GRACE_DEFAULT = 60;

/**
 * Worst-case floor + post-TP1 breakeven grace + an honest summary of what
 * each timer actually covers — shared by every exit-edit surface
 * (PositionInfoModal) so the floor is ALWAYS visible there, whatever the
 * stop type, and can be added when a trade has none yet.
 * The floor is independent of the stop loss: turning SL off mid-trade does
 * not disarm it (see ExitManager.evaluate), so the floor section always
 * renders. The breakeven grace only matters once a
 * breakeven stop can arm (TP1 can still fire), hence the tpOn gate.
 * See ExitManager (exit_manager.py): the floor sells immediately and
 * ignores both timers; the SL timer only covers the initial stop.
 */
export function ExitSafetyControls({
  colors, editable, tpOn, floor, floorEnabled, onFloorEnabled, floorPriceVal, onFloorPriceVal,
  beGrace, onBeGrace, slGraceMinutes, tp1Hit,
}: {
  colors: any;
  editable: boolean;
  /** Take-profit still on — gates the breakeven-grace stepper (no TP1, no
   *  breakeven stop, no grace). */
  tpOn: boolean;
  /** Current floor price from the backend (null = none set). */
  floor: number | null | undefined;
  floorEnabled: boolean;
  onFloorEnabled: (v: boolean) => void;
  floorPriceVal: string;
  onFloorPriceVal: (v: string) => void;
  beGrace: number;
  onBeGrace: (v: number) => void;
  /** Stop type in effect (null = Hard Stop) — for the scope summary. */
  slGraceMinutes: number | null | undefined;
  tp1Hit?: boolean;
}) {
  const hasFloor = floor != null;

  return (
    <View style={{ gap: 12, marginTop: 12 }}>
      {/* Worst-case floor — independent of the stop loss, always shown. */}
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={[s.label, { color: colors.textSecondary }]}>Worst-case floor</Text>
          <Text style={[s.hint, { color: colors.textTertiary }]}>
            {!hasFloor && !floorPriceVal
              ? 'None set — enter a price to add one'
              : floorEnabled
                ? `Sells immediately at $${(floorPriceVal ? parseFloat(floorPriceVal) || 0 : floor!).toFixed(2)}, ignoring every timer`
                : 'Off — this trade can hold through any drop'}
          </Text>
        </View>
        {hasFloor && (
          <Switch
            value={floorEnabled}
            onValueChange={onFloorEnabled}
            disabled={!editable}
            trackColor={{ false: colors.border, true: colors.error + '66' }}
            thumbColor={floorEnabled ? colors.error : undefined}
          />
        )}
      </View>
      {editable && (floorEnabled || !hasFloor) && (
        <TextInput
          value={floorPriceVal}
          onChangeText={onFloorPriceVal}
          keyboardType="decimal-pad"
          placeholder={hasFloor ? floor!.toFixed(2) : 'e.g. 0.50'}
          placeholderTextColor={colors.textTertiary}
          style={[s.input, { color: colors.error, borderColor: colors.separator }]}
        />
      )}

      {/* Post-TP1 breakeven grace — only meaningful while a breakeven stop
          can still arm (TP on). */}
      {tpOn && (
      <View>
        <Text style={[s.label, { color: colors.textSecondary, marginBottom: 6 }]}>Breakeven grace</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {BE_GRACE_OPTIONS.map(sec => {
            const active = beGrace === sec;
            return (
              <TouchableOpacity
                key={sec}
                disabled={!editable}
                onPress={() => onBeGrace(sec)}
                activeOpacity={0.75}
                style={[s.chip, { borderColor: active ? colors.text : colors.separator, backgroundColor: active ? colors.text + '12' : 'transparent' }]}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: active ? colors.text : colors.textSecondary }}>
                  {sec === 0 ? 'Off' : `${sec}s`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      )}

      {/* Honest timer scope */}
      <Text style={[s.scope, { color: colors.textTertiary }]}>
        {timerScopeText(slGraceMinutes, beGrace, hasFloor && floorEnabled, tp1Hit, tpOn)}
      </Text>
    </View>
  );
}

/** Plain-language summary of what each exit timer covers. */
export function timerScopeText(slGraceMinutes: number | null | undefined, beGrace: number,
                               floorOn: boolean, tp1Hit?: boolean, tpOn: boolean = true): string {
  const parts = [
    slGraceMinutes
      ? `SL timer (${slGraceMinutes} min) covers the initial stop only${tp1Hit ? ' — no longer in play after TP1' : ''}.`
      : `Initial stop is a hard stop${tp1Hit ? ' — no longer in play after TP1' : ''}.`,
    !tpOn
      ? 'Take-profit is off, so the stop never moves to breakeven.'
      : beGrace > 0
        ? `After TP1 the stop moves to breakeven. A dip below it starts a ${beGrace}s check: still below at the end → sold, back above → held. Falling below the original stop sells immediately.`
        : 'After TP1 the stop moves to breakeven and sells on the first confirmed touch.',
    floorOn ? 'The floor ignores both timers.' : 'No floor is armed.',
  ];
  return parts.join(' ');
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, fontWeight: '600' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, borderWidth: 1 },
  scope: { fontSize: 11.5, lineHeight: 16 },
});
