import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import AccountsOverviewScreen from './accounts_overview';
import PositionScreen from './position';

type SubView = 'summary' | 'positions';

interface Props {
  /** True when rendered as a SegmentedPager scene (Accounts tab). */
  embedded?: boolean;
}

/**
 * Alpaca segment of the Accounts tab — Summary and Live Positions are two
 * full self-contained screens (each owns its own header/scroll/live sockets),
 * so this switches between them with a plain tap toggle rather than nesting
 * a second swipeable SegmentedPager inside the outer Alpaca/Robin Hood one —
 * two horizontal swipe gesture recognizers stacked on each other fight for
 * the same pan gesture.
 */
export default function AlpacaScreen({ embedded = false }: Props) {
  const colors = useThemeColors();
  const [view, setView] = useState<SubView>('summary');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.toggleBar, { borderBottomColor: colors.border }]}>
        <View style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ToggleBtn label="Summary" active={view === 'summary'} onPress={() => setView('summary')} colors={colors} />
          <ToggleBtn label="Live Positions" active={view === 'positions'} onPress={() => setView('positions')} colors={colors} />
        </View>
      </View>

      {view === 'summary'
        ? <AccountsOverviewScreen embedded />
        : <PositionScreen embedded />}
    </View>
  );
}

const ToggleBtn = ({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: any }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.75}
    style={[styles.toggleBtn, active && { backgroundColor: colors.accent }]}
  >
    <Text style={[styles.toggleBtnText, { color: active ? '#fff' : colors.tabBarInactive, fontWeight: active ? '700' : '600' }]}>
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  toggleBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleRow: { flexDirection: 'row', borderRadius: 100, borderWidth: 1, padding: 3 },
  toggleBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 100 },
  toggleBtnText: { fontSize: 13 },
});
