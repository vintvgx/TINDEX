import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  AccessibilityInfo,
} from 'react-native';
import { OptimizedImage } from './OptimizedImage';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePostModal } from '@/common/utils/context/PostModalContext';
import { BlogPostType } from '@/common/types';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const SPRING_CONFIG = { damping: 20, stiffness: 300 };
const TIMING_CONFIG = { duration: 300 };

interface PostModalProps {
  post: BlogPostType;
}

export const PostModal: React.FC<PostModalProps> = ({ post }) => {
  const { collapsePost, setAnimating } = usePostModal();
  const insets = useSafeAreaInsets();
  
  // Animation values
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const imageScale = useSharedValue(1);

  // Extract image URL from multimedia_data or use a placeholder
  const getImageUrl = useCallback(() => {
    if (post.multimedia_data?.images?.[0]?.url) {
      return post.multimedia_data.images[0].url;
    }
    if (post.multimedia_data?.featured_image) {
      return post.multimedia_data.featured_image;
    }
    return 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=250&fit=crop';
  }, [post.multimedia_data]);

  // Format date
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }, []);

  // Animated styles
  const modalStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: translateY.value },
        { scale: scale.value },
      ],
      opacity: opacity.value,
    };
  });

  const imageStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: imageScale.value }],
    };
  });

  const backgroundStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(
        translateY.value,
        [0, SCREEN_HEIGHT * 0.3],
        [1, 0],
        Extrapolate.CLAMP
      ),
    };
  });

  // Gesture handler for swipe to dismiss
  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onStart: () => {
      runOnJS(setAnimating)(true);
    },
    onActive: (event) => {
      translateY.value = Math.max(0, event.translationY);
      scale.value = interpolate(
        translateY.value,
        [0, SCREEN_HEIGHT * 0.3],
        [1, 0.9],
        Extrapolate.CLAMP
      );
      opacity.value = interpolate(
        translateY.value,
        [0, SCREEN_HEIGHT * 0.3],
        [1, 0.5],
        Extrapolate.CLAMP
      );
    },
    onEnd: (event) => {
      const shouldDismiss = event.translationY > SCREEN_HEIGHT * 0.2 || event.velocityY > 500;
      
      if (shouldDismiss) {
        translateY.value = withTiming(SCREEN_HEIGHT, TIMING_CONFIG, () => {
          runOnJS(handleDismiss)();
        });
        scale.value = withTiming(0.9, TIMING_CONFIG);
        opacity.value = withTiming(0, TIMING_CONFIG);
      } else {
        translateY.value = withSpring(0, SPRING_CONFIG);
        scale.value = withSpring(1, SPRING_CONFIG);
        opacity.value = withSpring(1, SPRING_CONFIG);
        runOnJS(setAnimating)(false);
      }
    },
  });

  // Handle modal dismiss
  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAnimating(false);
    collapsePost();
  }, [collapsePost, setAnimating]);

  // Handle background press
  const handleBackgroundPress = useCallback(() => {
    if (!translateY.value) {
      handleDismiss();
    }
  }, [handleDismiss, translateY.value]);

  // Initialize animations
  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAnimating(true);
    
    // Animate in
    opacity.value = withTiming(1, TIMING_CONFIG);
    scale.value = withSpring(1, SPRING_CONFIG);
    
    // Set accessibility focus
    AccessibilityInfo.announceForAccessibility('Post opened. Swipe down to close.');
    
    return () => {
      setAnimating(false);
    };
  }, [opacity, scale, setAnimating]);

  // Accessibility props
  const accessibilityProps = useMemo(() => ({
    accessible: true,
    accessibilityRole: 'button' as const,
    accessibilityLabel: 'Close post',
    accessibilityHint: 'Double tap to close the post',
  }), []);

  return (
    <Animated.View 
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          zIndex: 1000,
        },
        backgroundStyle,
      ]}
    >
      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View style={[modalStyle, { flex: 1 }]}>
          <Pressable
            style={{ flex: 1 }}
            onPress={handleBackgroundPress}
            {...accessibilityProps}
          >
            <View 
              style={{ 
                flex: 1, 
                backgroundColor: 'white',
                marginTop: insets.top,
                marginBottom: insets.bottom,
              }}
            >
              {/* Header with close button */}
              <View 
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 20,
                  paddingVertical: 15,
                  borderBottomWidth: 1,
                  borderBottomColor: '#f0f0f0',
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#333' }}>
                  {formatDate(post.created_at)}
                </Text>
                <Pressable
                  onPress={handleDismiss}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: '#f0f0f0',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Close post"
                >
                  <Text style={{ fontSize: 18, color: '#666' }}>×</Text>
                </Pressable>
              </View>

              <ScrollView 
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
              >
                {/* Hero Image */}
                <Animated.View style={[imageStyle, { marginBottom: 20 }]}>
                  <OptimizedImage
                    uri={getImageUrl()}
                    style={{
                      width: SCREEN_WIDTH,
                      height: SCREEN_WIDTH * 0.6,
                    }}
                    priority="high"
                  />
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.3)']}
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 60,
                    }}
                  />
                </Animated.View>

                {/* Content */}
                <View style={{ paddingHorizontal: 20 }}>
                  {/* Title */}
                  <Text 
                    style={{
                      fontSize: 28,
                      fontWeight: 'bold',
                      color: '#1a1a1a',
                      lineHeight: 36,
                      marginBottom: 16,
                    }}
                  >
                    {post.title}
                  </Text>

                  {/* Reading time and topics */}
                  <View 
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      marginBottom: 24,
                    }}
                  >
                    {post.reading_time && (
                      <View 
                        style={{
                          backgroundColor: '#f0f8ff',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 16,
                          marginRight: 12,
                        }}
                      >
                        <Text style={{ fontSize: 14, color: '#0066cc', fontWeight: '500' }}>
                          {post.reading_time} min read
                        </Text>
                      </View>
                    )}
                    {post.topics && (
                      <View 
                        style={{
                          backgroundColor: '#e6f3ff',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 16,
                        }}
                      >
                        <Text style={{ fontSize: 14, color: '#0066cc', fontWeight: '500' }}>
                          {post.topics.name}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Main content */}
                  <Text 
                    style={{
                      fontSize: 16,
                      lineHeight: 26,
                      color: '#333',
                      marginBottom: 20,
                    }}
                  >
                    {post.content}
                  </Text>

                  {/* Keywords/Hashtags */}
                  {post.keywords && post.keywords.length > 0 && (
                    <View style={{ marginTop: 20 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8 }}>
                        Keywords:
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {post.keywords.slice(0, 5).map((keyword, index) => (
                          <View
                            key={index}
                            style={{
                              backgroundColor: '#f0f0f0',
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              borderRadius: 12,
                              marginRight: 8,
                              marginBottom: 8,
                            }}
                          >
                            <Text style={{ fontSize: 12, color: '#666' }}>
                              #{keyword}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          </Pressable>
        </Animated.View>
      </PanGestureHandler>
    </Animated.View>
  );
}; 