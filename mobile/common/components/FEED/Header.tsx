import { useThemeColors } from '@/lib/useColorScheme';
import type React from 'react';
import { Text, View } from 'react-native';

/**
 * Feed toolbar. The app-wide brand wordmark lives in the global AppHeader, so
 * this is just the feed's section title. (The blog-post and notification-preview
 * actions were deprecated and removed.)
 */
export const Header: React.FC = () => {
  const colors = useThemeColors();

  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 14,
        paddingBottom: 12,
        backgroundColor: colors.background,
      }}
    >
      <Text
        style={{
          fontSize: 28,
          fontWeight: '700',
          color: colors.text,
          letterSpacing: -0.4,
        }}
      >
        Feed
      </Text>
    </View>
  );
};
