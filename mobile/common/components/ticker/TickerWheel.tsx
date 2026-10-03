import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * TickerWheel — vertical ticker navigator for the chart toolbar.
 * Drag up/down to cycle through the ticker list (wraps around); tap to
 * open search. Shows the neighbors peeking above/below the current ticker
 * for the wheel feel.
 */
export function TickerWheel({
  tickers,
  activeTicker,
  onSelect,
  onSearchPress,
}: {
  tickers: string[];
  activeTicker: string;
  onSelect: (t: string) => void;
  onSearchPress: () => void;
}) {
  const colors = useThemeColors();

  const idx = Math.max(0, tickers.indexOf(activeTicker));
  const prev = tickers[(idx - 1 + tickers.length) % tickers.length] ?? activeTicker;
  const next = tickers[(idx + 1) % tickers.length] ?? activeTicker;

  const go = (dir: 1 | -1) => {
    const nextIdx = (idx + dir + tickers.length) % tickers.length;
    const t = tickers[nextIdx];
    if (t && t !== activeTicker) {
      Haptics.selectionAsync().catch(() => {});
      onSelect(t);
    }
  };

  const gesture = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-18, 18])
    .onEnd((e) => {
      'worklet';
      if (e.translationY <= -28) runOnJS(go)(1);       // drag up → next
      else if (e.translationY >= 28) runOnJS(go)(-1);  // drag down → prev
      else if (Math.abs(e.translationY) < 10 && Math.abs(e.translationX) < 10) {
        runOnJS(onSearchPress)();                       // tap → search
      }
    });

  const Row = ({ t, active }: { t: string; active?: boolean }) => (
    <View style={s.row}>
      <TickerLogo ticker={t} size={active ? 18 : 13} />
      <Text
        numberOfLines={1}
        style={{
          fontSize: active ? 15 : 11,
          fontWeight: active ? '800' : '600',
          color: active ? colors.text : colors.textTertiary,
        }}
      >
        {t}
      </Text>
    </View>
  );

  return (
    <GestureDetector gesture={gesture}>
      <View style={[s.wheel, { backgroundColor: colors.surfaceSecondary, borderColor: colors.separator }]}>
        <View style={{ opacity: 0.45 }}><Row t={prev} /></View>
        <Row t={activeTicker} active />
        <View style={{ opacity: 0.45 }}><Row t={next} /></View>
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  wheel: {
    width: 76,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
