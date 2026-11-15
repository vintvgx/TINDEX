import React, { useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle, type GestureResponderEvent } from 'react-native';

/**
 * Pressable with a STATIC style plus an optional `pressedStyle` applied while
 * pressed. Use this instead of `style={({ pressed }) => …}`: NativeWind's
 * react-native-css-interop (0.1.22) replaces a Pressable style FUNCTION with
 * {}, silently dropping all its layout on device.
 */
export function PressableStyled({
  style, pressedStyle, onPressIn, onPressOut, ...rest
}: Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => { setPressed(true); onPressIn?.(e); }}
      onPressOut={(e: GestureResponderEvent) => { setPressed(false); onPressOut?.(e); }}
      style={[style, pressed && pressedStyle]}
    />
  );
}
