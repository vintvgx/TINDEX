import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { SoldAlert } from './useSoldTradeAlert';

/**
 * Sold-contract card: contract PnL + day realized PnL. Auto-dismisses after
 * ~12s (see useSoldTradeAlert) or on horizontal swipe.
 */
export function SoldCard({ alert, onDismiss }: { alert: SoldAlert; onDismiss: () => void }) {
  const colors = useThemeColors();
  const t = alert.trade;
  const pnl = t.pnl ?? 0;
  const up = pnl >= 0;
  const pnlColor = up ? colors.success : colors.error;
  const dayUp = alert.dayPnl >= 0;

  const offsetX = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-24, 24])
    .onUpdate((e) => {
      'worklet';
      offsetX.value = e.translationX;
    })
    .onEnd((e) => {
      'worklet';
      if (Math.abs(e.translationX) > 90) {
        offsetX.value = withTiming(e.translationX > 0 ? 400 : -400, { duration: 180 }, (done) => {
          if (done) runOnJS(onDismiss)();
        });
      } else {
        offsetX.value = withTiming(0, { duration: 180 });
      }
    });
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }],
    opacity: 1 - Math.min(1, Math.abs(offsetX.value) / 300),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: pnlColor + '66' },
          cardStyle,
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons
            name={up ? 'checkmark-circle' : 'close-circle'}
            size={20}
            color={pnlColor}
          />
          <Text style={[styles.mono, { fontSize: 15, fontWeight: '800', color: colors.text }]}>
            {t.ticker} {t.direction}
          </Text>
          <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary }]}>
            {t.strike}{t.expiry ? ` · ${t.expiry}` : ''}
          </Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={onDismiss} hitSlop={10}>
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 16, marginTop: 10 }}>
          <View>
            <Text style={[styles.mono, { fontSize: 10, letterSpacing: 1.5, color: colors.textTertiary }]}>
              CONTRACT PNL
            </Text>
            <Text style={[styles.mono, { fontSize: 26, fontWeight: '800', color: pnlColor, marginTop: 2 }]}>
              {up ? '+' : ''}${pnl.toFixed(2)}
            </Text>
            {t.pnl_pct != null && (
              <Text style={[styles.mono, { fontSize: 12, color: pnlColor }]}>
                {up ? '+' : ''}{t.pnl_pct.toFixed(1)}%
              </Text>
            )}
          </View>
          <View>
            <Text style={[styles.mono, { fontSize: 10, letterSpacing: 1.5, color: colors.textTertiary }]}>
              DAY PNL
            </Text>
            <Text
              style={[
                styles.mono,
                { fontSize: 20, fontWeight: '800', color: dayUp ? colors.success : colors.error, marginTop: 2 },
              ]}
            >
              {dayUp ? '+' : ''}${alert.dayPnl.toFixed(2)}
            </Text>
          </View>
        </View>

        {t.exit_reason ? (
          <Text style={{ fontSize: 11.5, color: colors.textTertiary, marginTop: 8 }}>
            Exit: {t.exit_reason}
          </Text>
        ) : null}
        <Text style={[styles.mono, { fontSize: 9, color: colors.textTertiary, marginTop: 6 }]}>
          SWIPE TO DISMISS
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    margin: 14,
  },
});
