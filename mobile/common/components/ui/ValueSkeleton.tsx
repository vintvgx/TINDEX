import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * A pulsing placeholder bar for a single live number (P&L, equity, price)
 * while it's being re-synced — e.g. right after the app returns from the
 * background, before the fresh socket's first price lands. Shown instead of
 * the pre-background value so stale numbers never flash on screen.
 */
export function ValueSkeleton({ width, height, style }: {
  width: number | `${number}%`;
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.9, duration: 550, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 550, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      accessibilityLabel="Updating"
      style={[{ width, height, borderRadius: Math.min(8, height / 2), backgroundColor: colors.surfaceSecondary ?? colors.border, opacity: pulse }, style]}
    />
  );
}
