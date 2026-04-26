import { useState } from 'react';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { SafeAreaView, Text, View, Pressable, TouchableOpacity, ScrollView } from 'react-native';
import { ORBAdminModal } from '@/common/components/admin/ORBAdminModal';
import { LogViewerModal } from '@/common/components/orb/LogViewerModal';
import { ThemeToggle } from '@/common/components/ThemeToggle';
import { useThemeColors } from '@/lib/useColorScheme';
import { Ionicons } from '@expo/vector-icons';

const ProfileScreen = () => {
  const { authState: { user } } = useAuth();
  const colors = useThemeColors();
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [logViewerVisible, setLogViewerVisible] = useState(false);

  const email = user?.email || 'User';
  const initials = email.substring(0, 2).toUpperCase();

  const menuItems = [
    { icon: 'shield-outline' as const, label: 'Admin Panel', onPress: () => setAdminModalVisible(true) },
    { icon: 'document-text-outline' as const, label: 'View Logs', onPress: () => setLogViewerVisible(true) },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.separator,
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 }}>
              Profile
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500', marginTop: 2 }}>
              Account & Settings
            </Text>
          </View>
          <View style={{ marginBottom: 6 }}>
            <ThemeToggle />
          </View>
        </View>

        {/* User avatar + info */}
        <View style={{ alignItems: 'center', paddingVertical: 36 }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: colors.accent + '18',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
              borderWidth: 2,
              borderColor: colors.accent + '30',
            }}
          >
            <Text style={{ color: colors.accent, fontSize: 28, fontWeight: '800' }}>{initials}</Text>
          </View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>
            {email.split('@')[0]}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{email}</Text>
        </View>

        {/* Menu section */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              marginBottom: 8,
              paddingHorizontal: 4,
            }}
          >
            Developer
          </Text>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
            }}
          >
            {menuItems.map((item, index) => (
              <TouchableOpacity
                key={item.label}
                onPress={item.onPress}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: index < menuItems.length - 1 ? 1 : 0,
                  borderBottomColor: colors.separator,
                }}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: colors.iconButton,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12,
                  }}
                >
                  <Ionicons name={item.icon} size={17} color={colors.textSecondary} />
                </View>
                <Text style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: '500' }}>
                  {item.label}
                </Text>
                <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* App version */}
        <Text style={{ textAlign: 'center', color: colors.textTertiary, fontSize: 12, marginTop: 8 }}>
          TINDEX • Market Intelligence
        </Text>
      </ScrollView>

      <ORBAdminModal
        visible={adminModalVisible}
        onClose={() => setAdminModalVisible(false)}
        onViewLogs={() => setLogViewerVisible(true)}
      />
      <LogViewerModal
        visible={logViewerVisible}
        onClose={() => setLogViewerVisible(false)}
      />
    </SafeAreaView>
  );
};

export default ProfileScreen;
