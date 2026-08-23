import { useState } from 'react';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { SafeAreaView, Text, View, Pressable, TouchableOpacity, ScrollView, Alert, Switch } from 'react-native';
import { router } from 'expo-router';
import { ORBAdminModal } from '@/common/components/admin/ORBAdminModal';
import { ServiceStatusModal } from '@/common/components/admin/ServiceStatusModal';
import { LogViewerModal } from '@/common/components/orb/LogViewerModal';
import { AgentModal } from '@/common/components/agent/AgentModal';
import { ThemeToggle } from '@/common/components/ThemeToggle';
import { useThemeColors } from '@/lib/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useNotificationHistory } from '@/hooks/queries/notifications/useNotificationHistory';
import { useSearchBarVisibility } from '@/hooks/useSearchBarVisibility';
import { useCardTintDarkMode } from '@/hooks/useCardTintDarkMode';
import { useChartPriceSource } from '@/hooks/useChartPriceSource';
import { signOut } from '@/common/utils/auth/function';

const ProfileScreen = () => {
  const { authState: { isAuthenticated, user } } = useAuth();
  const colors = useThemeColors();
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [logViewerVisible, setLogViewerVisible] = useState(false);
  const [serviceStatusVisible, setServiceStatusVisible] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const toast = useToast();
  const { unreadCount } = useNotificationHistory();
  const { hidden: searchBarHidden, setHidden: setSearchBarHidden } = useSearchBarVisibility();
  const { enabled: cardTintDarkMode, setEnabled: setCardTintDarkMode } = useCardTintDarkMode();
  const { source: chartPriceSource, setSource: setChartPriceSource } = useChartPriceSource();

  const email = user?.email || 'User';
  const initials = email.substring(0, 2).toUpperCase();

  const go = (route: string) => router.push(route as any);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try { await signOut(); }
          catch { Alert.alert('Sign Out Failed', 'Please try again.'); }
        },
      },
    ]);
  };

  // Moved from the old Menu tab (menu.tsx, removed) — this screen is now
  // that tab's replacement, so these navigable rows live here instead.
  const accountItems = [
    { icon: 'layers-outline' as const, label: 'Watchlists', onPress: () => go('/(app)/(tabs)/watchlists') },
    { icon: 'briefcase-outline' as const, label: 'Track Portfolio', onPress: () => go('/(app)/(tabs)/track') },
    { icon: 'notifications-outline' as const, label: 'Notifications', onPress: () => go('/(app)/(tabs)/notifications'), badge: unreadCount },
    { icon: 'flask-outline' as const, label: 'Run Simulation', onPress: () => go('/(app)/(tabs)/simulation') },
    { icon: 'game-controller-outline' as const, label: 'Simulator', onPress: () => go('/(app)/(tabs)/simulator') },
    // Fallback entry point for the AI assistant — the floating sparkle
    // button above the tab bar hides along with the search bar when the
    // "Hide Search Bar" setting is on (see CustomTabBar), so it needs
    // another way in.
    { icon: 'sparkles-outline' as const, label: 'Open AI Assistant', onPress: () => setAgentOpen(true) },
  ];

  const menuItems = [
    { icon: 'pulse-outline' as const, label: 'Service Status', onPress: () => setServiceStatusVisible(true) },
    { icon: 'shield-outline' as const, label: 'Admin Panel', onPress: () => setAdminModalVisible(true) },
    { icon: 'document-text-outline' as const, label: 'View Logs', onPress: () => setLogViewerVisible(true) },
    // Moved from the "..." button in monitor.tsx's own header (2026-08-04) —
    // deep-links there and opens the same ORBMenu modal in place, rather than
    // duplicating its state (grid layout, mock-data toggles, service status)
    // here as a second copy.
    { icon: 'ellipsis-horizontal-outline' as const, label: 'ORB Menu', onPress: () => go('/(app)/(tabs)/orb?section=monitor&openMenu=true') },
  ];

  const toastItems: Array<{
    label: string;
    color: string;
    iconName: React.ComponentProps<typeof Ionicons>['name'];
    onPress: () => void;
  }> = [
    {
      label: 'Success',
      color: colors.success,
      iconName: 'checkmark-circle',
      onPress: () => toast.success('Contract tracked successfully'),
    },
    {
      label: 'Error',
      color: colors.error,
      iconName: 'alert-circle',
      onPress: () => toast.error('Failed to connect to service'),
    },
    {
      label: 'Warning',
      color: colors.warning,
      iconName: 'warning',
      onPress: () => toast.warning('Market closes in 15 minutes'),
    },
    {
      label: 'Info',
      color: colors.accent,
      iconName: 'information-circle',
      onPress: () => toast.info('ORB calculation phase starting'),
    },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 170 }} showsVerticalScrollIndicator={false}>
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

        {/* Account section — moved from the old Menu tab */}
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
            Account
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
            {accountItems.map((item, index) => (
              <TouchableOpacity
                key={item.label}
                onPress={item.onPress}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: index < accountItems.length - 1 ? 1 : 0,
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
                {!!item.badge && (
                  <View
                    style={{
                      backgroundColor: colors.badge,
                      borderRadius: 9,
                      minWidth: 18,
                      height: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingHorizontal: 5,
                      marginRight: 8,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Display section */}
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
            Display
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
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 14,
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
                <Ionicons name="search-outline" size={17} color={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }}>
                  Hide Search Bar
                </Text>
                <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 1 }}>
                  Hides the floating search bar above the tab bar
                </Text>
              </View>
              <Switch
                value={searchBarHidden}
                onValueChange={setSearchBarHidden}
                trackColor={{ false: colors.border, true: colors.accent }}
              />
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderTopWidth: 1,
                borderTopColor: colors.separator,
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
                <Ionicons name="color-palette-outline" size={17} color={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }}>
                  Tint Cards in Dark Mode
                </Text>
                <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 1 }}>
                  Applies the green/red position card tint in dark mode too (on by default in light mode)
                </Text>
              </View>
              <Switch
                value={cardTintDarkMode}
                onValueChange={setCardTintDarkMode}
                trackColor={{ false: colors.border, true: colors.accent }}
              />
            </View>
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderTopWidth: 1,
                borderTopColor: colors.separator,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
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
                  <Ionicons name="pulse-outline" size={17} color={colors.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }}>
                    Chart Live Price Source
                  </Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 1 }}>
                    Fall back to Yahoo polling if the Alpaca stream acts up mid-day
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, backgroundColor: colors.background }}>
                {([['alpaca', 'Alpaca Stream'], ['yfinance', 'Yahoo Polling']] as const).map(([key, label]) => {
                  const active = chartPriceSource === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setChartPriceSource(key)}
                      activeOpacity={0.75}
                      style={{
                        flex: 1,
                        alignItems: 'center',
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor: active ? colors.accent : 'transparent',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? colors.accentForeground : colors.textSecondary }}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
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

        {/* Generate Toast section */}
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
            Generate Toast
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {toastItems.map(item => (
              <TouchableOpacity
                key={item.label}
                onPress={item.onPress}
                activeOpacity={0.75}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: item.color + '18',
                  borderWidth: 1,
                  borderColor: item.color + '40',
                }}
              >
                <Ionicons name={item.iconName} size={16} color={item.color} />
                <Text style={{ color: item.color, fontSize: 13, fontWeight: '600' }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Sign out — moved from the old Menu tab's footer */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          {isAuthenticated ? (
            <TouchableOpacity
              onPress={handleSignOut}
              activeOpacity={0.7}
              style={{
                alignItems: 'center',
                paddingVertical: 14,
                borderRadius: 16,
                borderWidth: 1,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.error, fontSize: 15, fontWeight: '600' }}>Sign Out</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => go('/(public)/auth')}
              activeOpacity={0.7}
              style={{
                alignItems: 'center',
                paddingVertical: 14,
                borderRadius: 16,
                borderWidth: 1,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Login</Text>
            </TouchableOpacity>
          )}
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
      <ServiceStatusModal
        visible={serviceStatusVisible}
        onClose={() => setServiceStatusVisible(false)}
      />
      <AgentModal
        visible={agentOpen}
        onClose={() => setAgentOpen(false)}
        onError={(msg) => toast.error(msg)}
      />
    </SafeAreaView>
  );
};

export default ProfileScreen;
