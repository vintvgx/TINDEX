import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, Animated, Easing, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * Full-screen "generating" state shown while an on-demand digest build is in
 * flight (Home card / Daily Review button) — MarketDigestModal itself stays
 * a pure viewer, same split as ReviewDetailModal / useGenerateReview's
 * generatingDate spinner in daily_review.tsx.
 */
export function DigestGeneratingOverlay({ visible, onCancel }: { visible: boolean; onCancel?: () => void }) {
  const colors = useThemeColors();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        {onCancel && (
          <TouchableOpacity onPress={onCancel} hitSlop={12} style={{ position: 'absolute', top: 60, right: 24 }}>
            <Ionicons name="close" size={24} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
        <Animated.View style={{ opacity: pulse }}>
          <Ionicons name="sparkles" size={30} color={colors.accent} />
        </Animated.View>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 18 }}>
          Building today’s Market Digest
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 6 }}>
          Live levels, headlines, and your levels — this takes ~20 seconds
        </Text>
      </View>
    </Modal>
  );
}
