import React, { useEffect, useRef } from 'react';
import { Text, Animated, StyleSheet } from 'react-native';

interface AnimatedNumberProps {
  value: number | null | undefined;
  format?: (value: number) => string;
  style?: any;
  color?: string;
  testID?: string;
}

/**
 * Animated number component that pulses when value changes
 * 
 * Provides a subtle visual cue when numbers update by:
 * - Scaling up slightly (1.0 -> 1.15 -> 1.0)
 * - Brief opacity pulse (1.0 -> 0.7 -> 1.0)
 * - Only animates on actual value changes (not initial render)
 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  format = (v) => v.toFixed(2),
  style,
  color,
  testID,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const previousValue = useRef(value);

  useEffect(() => {
    // Only animate if value actually changed (not initial render)
    if (previousValue.current !== undefined && previousValue.current !== value) {
      // Reset animations
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);

      // Pulse animation: scale up then back down
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.15,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.7,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }

    previousValue.current = value;
  }, [value, scaleAnim, opacityAnim]);

  if (value === null || value === undefined || isNaN(value)) {
    return <Text style={[style, { color }]}>N/A</Text>;
  }

  const formattedValue = format(value);

  return (
    <Animated.Text
      testID={testID}
      style={[
        style,
        {
          color,
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      {formattedValue}
    </Animated.Text>
  );
};

