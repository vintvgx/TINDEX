import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';

interface SharedElementTransitionProps {
  children: React.ReactNode;
  isExpanded: boolean;
  onAnimationComplete?: () => void;
}

export const SharedElementTransition: React.FC<SharedElementTransitionProps> = ({
  children,
  isExpanded,
  onAnimationComplete,
}) => {
  const progress = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (isExpanded) {
      // Animate to expanded state
      progress.value = withSpring(1, { damping: 20, stiffness: 300 }, () => {
        onAnimationComplete?.();
      });
      scale.value = withSpring(1.02, { damping: 15, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 200 });
    } else {
      // Animate to collapsed state
      progress.value = withSpring(0, { damping: 20, stiffness: 300 });
      scale.value = withSpring(1, { damping: 15, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [isExpanded, progress, scale, opacity, onAnimationComplete]);

  const animatedStyle = useAnimatedStyle(() => {
    const borderRadius = interpolate(
      progress.value,
      [0, 1],
      [16, 0],
      Extrapolate.CLAMP
    );

    const shadowOpacity = interpolate(
      progress.value,
      [0, 1],
      [0.1, 0],
      Extrapolate.CLAMP
    );

    return {
      borderRadius,
      shadowOpacity,
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      {children}
    </Animated.View>
  );
}; 