import React, { useEffect } from 'react';
import { View, Text, Dimensions, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

interface LoadingScreenProps {
  message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  message = "Loading your experience..." 
}) => {
  // Animation values
  const logoScale = useSharedValue(0.8);
  const logoOpacity = useSharedValue(0);
  const dotsOpacity = useSharedValue(0);
  const gradientRotation = useSharedValue(0);
  const pulseValue = useSharedValue(0);

  // Logo animation
  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 800 });
    logoScale.value = withTiming(1, { duration: 800 });
    
    // Subtle pulse animation
    pulseValue.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000 }),
        withTiming(0, { duration: 2000 })
      ),
      -1,
      true
    );
  }, []);

  // Dots animation
  useEffect(() => {
    const dotsAnimation = () => {
      dotsOpacity.value = withSequence(
        withTiming(1, { duration: 600 }),
        withTiming(0.3, { duration: 600 })
      );
    };

    dotsAnimation();
    const interval = setInterval(dotsAnimation, 1200);
    return () => clearInterval(interval);
  }, []);

  // Gradient rotation animation
  useEffect(() => {
    gradientRotation.value = withRepeat(
      withTiming(360, { duration: 3000 }),
      -1,
      false
    );
  }, []);

  // Animated styles
  const logoAnimatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      pulseValue.value,
      [0, 1],
      [1, 1.05],
      Extrapolate.CLAMP
    );

    return {
      opacity: logoOpacity.value,
      transform: [
        { scale: logoScale.value * scale },
      ],
    };
  });

  const dotsAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: dotsOpacity.value,
    };
  });

  const gradientAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { rotate: `${gradientRotation.value}deg` },
      ],
    };
  });

  return (
    <View style={styles.container}>
      {/* Animated gradient background */}
      <Animated.View 
        style={[styles.gradientContainer, gradientAnimatedStyle]}
      >
        <LinearGradient
          colors={['rgba(59, 130, 246, 0.1)', 'rgba(147, 51, 234, 0.1)', 'rgba(236, 72, 153, 0.1)']}
          style={styles.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>

      {/* Main content */}
      <View style={styles.content}>
        {/* Logo/App Name */}
        <Animated.View style={logoAnimatedStyle}>
          <Text style={styles.logoText}>
            ALE
            <Text style={styles.logoAccent}>THIA</Text>
          </Text>
        </Animated.View>

        {/* Loading dots */}
        <Animated.View 
          style={[styles.dotsContainer, dotsAnimatedStyle]}
        >
          <View style={[styles.dot, styles.dotBlue]} />
          <View style={[styles.dot, styles.dotPurple]} />
          <View style={[styles.dot, styles.dotPink]} />
        </Animated.View>

        {/* Loading message */}
        <Text style={styles.messageText}>
          {message}
        </Text>
      </View>

      {/* Subtle bottom accent */}
      <View style={styles.bottomAccent} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  gradient: {
    width: '100%',
    height: '100%',
  },
  content: {
    alignItems: 'center',
    gap: 32,
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 2,
  },
  logoAccent: {
    color: '#60a5fa', // blue-400
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotBlue: {
    backgroundColor: '#60a5fa', // blue-400
  },
  dotPurple: {
    backgroundColor: '#a78bfa', // purple-400
  },
  dotPink: {
    backgroundColor: '#f472b6', // pink-400
  },
  messageText: {
    color: '#d1d5db', // gray-300
    fontSize: 18,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  bottomAccent: {
    position: 'absolute',
    bottom: 80,
    width: 128,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
    // Note: Linear gradient for bottom accent would need to be implemented differently
    // For now using a solid color that matches the gradient theme
    backgroundColor: '#60a5fa',
  },
});

export default LoadingScreen; 