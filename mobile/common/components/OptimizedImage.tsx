import React, { useState, useCallback } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Image, ImageStyle } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from 'react-native-reanimated';

interface OptimizedImageProps {
  uri: string;
  style: ImageStyle;
  placeholder?: string;
  onLoad?: () => void;
  onError?: () => void;
  priority?: 'low' | 'normal' | 'high';
}

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  uri,
  style,
  placeholder = 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=250&fit=crop',
  onLoad,
  onError,
  priority = 'normal',
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.95);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    opacity.value = withTiming(1, { duration: 300 });
    scale.value = withTiming(1, { duration: 300 });
    onLoad?.();
  }, [opacity, scale, onLoad]);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
    onError?.();
  }, [onError]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const imageSource = hasError ? { uri: placeholder } : { uri };

  return (
    <View style={[style, { overflow: 'hidden' }]}>
      {isLoading && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#f0f0f0',
            zIndex: 1,
          }}
        >
          <ActivityIndicator size="small" color="#007AFF" />
        </View>
      )}
      
      <Animated.View style={[style, animatedStyle]}>
        <Image
          source={imageSource}
          style={style}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          priority={priority}
          onLoad={handleLoad}
          onError={handleError}
        />
      </Animated.View>
    </View>
  );
}; 