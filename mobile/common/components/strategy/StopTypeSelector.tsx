import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type StopType = 'HARD' | 5 | 10;

const OPTIONS: { value: StopType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'HARD', label: 'Hard Stop', icon: 'flash-outline' },
  { value: 5,      label: 'SL-5',      icon: 'timer-outline' },
  { value: 10,     label: 'SL-10',     icon: 'hourglass-outline' },
];

/**
 * Stop-type row shared by every contract-entry sheet (TradeContractSheet,
 * OptionsChainPicker, SignalEnterSheet) — Hard Stop fires the moment price
 * touches the stop; SL-5/SL-10 wait 5/10 minutes to see if it recovers
 * before force-selling (see exit_manager.py's sl_grace_* fields). This used
 * to be bundled into the SL_5/SL_10 PROFILE identity (bundling a specific
 * sizing archetype with the grace timer); it's now an independent per-trade
 * choice layered on top of whatever sizing profile is selected (2026-07-30).
 *
 * `autoSuggested` previews the backend's own cheap-contract safety net (any
 * fill under $0.50 gets a grace-timer stop applied regardless of this
 * choice — see orb_engine.py's _execute_entry) so the user isn't surprised
 * later by a trade log that doesn't match what they picked here.
 */
export function StopTypeSelector({
  value,
  onChange,
  colors,
  autoSuggested,
}: {
  value: StopType;
  onChange: (v: StopType) => void;
  colors: any;
  /** Non-null when the currently-selected contract is cheap enough that the
   *  backend will force a grace stop onto it regardless of this choice. */
  autoSuggested?: 5 | 10 | null;
}) {
  return (
    <View>
      <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {OPTIONS.map(opt => {
          const active = value === opt.value;
          return (
            <TouchableOpacity
              key={String(opt.value)}
              onPress={() => onChange(opt.value)}
              activeOpacity={0.75}
              style={[styles.tab, active && { backgroundColor: colors.accent + '22' }]}
            >
              <Ionicons name={opt.icon} size={14} color={active ? colors.accent : colors.tabBarInactive} />
              <Text style={[styles.tabLabel, { color: active ? colors.accent : colors.tabBarInactive }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {!!autoSuggested && value === 'HARD' && (
        <View style={styles.hintRow}>
          <Ionicons name="information-circle-outline" size={12} color={colors.warning} />
          <Text style={[styles.hintText, { color: colors.warning }]}>
            This contract is cheap enough that a {autoSuggested}-min grace stop applies automatically, regardless of this choice.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, gap: 3,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 8, borderRadius: 8,
  },
  tabLabel: { fontSize: 12, fontWeight: '700' },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 6 },
  hintText: { fontSize: 11, flex: 1, lineHeight: 15 },
});
