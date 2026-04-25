import React, { useEffect } from 'react';
import { View, Text, useColorScheme } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { lightTheme, darkTheme } from '@/styles/index';

interface LoadingScreenProps {
  message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message = 'Loading…' }) => {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkTheme : lightTheme;

  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);
  const pulse = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 600 });
    scale.value = withTiming(1, { duration: 600 });
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 1500 }), withTiming(0, { duration: 1500 })), -1, true);
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.04], Extrapolate.CLAMP) * scale.value }],
  }));

  const dotStyle = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [0.3, 1], Extrapolate.CLAMP) }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={[{ alignItems: 'center', gap: 20 }, containerStyle]}>
        {/* Logo mark */}
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            backgroundColor: colors.accent + '18',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: colors.accent + '30',
            marginBottom: 8,
          }}
        >
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.accent }} />
        </View>

        <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>
          TINDEX
        </Text>

        <Animated.View style={[{ flexDirection: 'row', gap: 6 }, dotStyle]}>
          {[colors.accent, colors.success, colors.textTertiary].map((c, i) => (
            <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
          ))}
        </Animated.View>

        <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>{message}</Text>
      </Animated.View>
    </View>
  );
};

export default LoadingScreen;
