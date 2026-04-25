import { signOut } from '@/common/utils/auth/function';
import { useThemeColors } from '@/lib/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import type React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

interface HeaderProps {
  onAddPress: () => void;
  onPreviewPress?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onAddPress, onPreviewPress }) => {
  const colors = useThemeColors();

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch {
              Alert.alert('Sign Out Failed', 'There was an error signing out. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 16,
        backgroundColor: colors.background,
      }}
    >
      {/* App title */}
      <Pressable onPress={handleSignOut} accessibilityRole="button">
        <Text
          style={{
            fontSize: 36,
            fontWeight: '800',
            color: colors.text,
            letterSpacing: -0.5,
            lineHeight: 40,
          }}
        >
          TINDEX
        </Text>
        <Text
          style={{
            fontSize: 13,
            color: colors.textSecondary,
            fontWeight: '500',
            letterSpacing: 0.3,
            marginTop: 2,
          }}
        >
          Market Intelligence
        </Text>
      </Pressable>

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
        {onPreviewPress && (
          <Pressable
            onPress={onPreviewPress}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.iconButton,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.iconButtonBorder,
            }}
          >
            <Ionicons name="notifications-outline" size={17} color={colors.text} />
          </Pressable>
        )}
        <Pressable
          onPress={onAddPress}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
};
