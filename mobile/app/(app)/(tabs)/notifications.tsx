import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import useBaseNavigation from '@/hooks/navigation/useBaseNavigation';
import { useNotificationHistory } from '@/hooks/queries/notifications/useNotificationHistory';
import { NotificationRecord } from '@/common/types/notifications/notificationModel';
import { formatDistanceToNow } from 'date-fns';
import { ORBNotificationModal, ORBBreakoutNotificationData } from '@/common/components/FEED/modals/ORBNotificationModal';
import { useThemeColors } from '@/lib/useColorScheme';

const NotificationsScreen = () => {
  const colors = useThemeColors();
  const { toTicker } = useBaseNavigation();

  const { notifications, isLoading, error, refetch, markAsRead, markAllAsRead, unreadCount } =
    useNotificationHistory();

  const [refreshing, setRefreshing] = useState(false);
  const [orbModalVisible, setOrbModalVisible] = useState(false);
  const [orbNotificationData, setOrbNotificationData] = useState<ORBBreakoutNotificationData | null>(null);
  const [orbNotificationTitle, setOrbNotificationTitle] = useState<string | undefined>();
  const [orbNotificationBody, setOrbNotificationBody] = useState<string | undefined>();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  }, [refetch]);

  const extractTicker = (n: NotificationRecord): string | null => {
    if (n.data?.ticker) return n.data.ticker;
    const m = n.body.match(/\$?([A-Z]{1,5})\b/);
    return m ? m[1] : null;
  };

  const handleNotificationPress = useCallback(
    (notification: NotificationRecord) => {
      if (!notification.is_read) markAsRead(notification.id);

      const orbType = notification.data?.type;
      if (orbType === 'orb_breakout' || orbType === 'orb_breakout_confirmed' || orbType === 'orb_breakout_invalidated') {
        if (!notification.data.ticker) {
          Alert.alert('Missing ticker', notification.id);
          return;
        }
        setOrbNotificationData({
          type: orbType,
          ticker: notification.data.ticker || '',
          breakout_type: notification.data.breakout_type || 'above',
          price: notification.data.price || 0,
          screen: notification.data.screen || 'ticker',
          timestamp: notification.data.timestamp || notification.created_at,
          breakout_analysis: notification.data.breakout_analysis,
          orb_high: notification.data.orb_high,
          orb_low: notification.data.orb_low,
          confidence: notification.data.confidence,
          score: notification.data.score,
          reasons: notification.data.reasons,
          entry_price: notification.data.entry_price,
          stop_loss: notification.data.stop_loss,
          risk_per_share: notification.data.risk_per_share,
          rvol: notification.data.rvol,
          vwap_aligned: notification.data.vwap_aligned,
          gap_percent: notification.data.gap_percent,
          gap_points: notification.data.gap_points,
          gap_direction: notification.data.gap_direction,
          prior_day_trend: notification.data.prior_day_trend,
          trend_continuation: notification.data.trend_continuation,
          breakout_aligns_gap: notification.data.breakout_aligns_gap,
        });
        setOrbNotificationTitle(notification.title);
        setOrbNotificationBody(notification.body);
        setOrbModalVisible(true);
        return;
      }

      const ticker = extractTicker(notification);
      if (ticker) toTicker(ticker);
    },
    [markAsRead, toTicker]
  );

  const handleOrbModalClose = () => {
    setOrbModalVisible(false);
    setTimeout(() => {
      setOrbNotificationData(null);
      setOrbNotificationTitle(undefined);
      setOrbNotificationBody(undefined);
    }, 300);
  };

  const renderNotification = ({ item }: { item: NotificationRecord }) => {
    const timeAgo = formatDistanceToNow(new Date(item.created_at), { addSuffix: true });
    const isUnread = !item.is_read;

    return (
      <TouchableOpacity
        onPress={() => handleNotificationPress(item)}
        activeOpacity={0.7}
        style={{
          backgroundColor: isUnread ? colors.surface : colors.background,
          paddingHorizontal: 20,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {/* Unread dot */}
          {isUnread ? (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.unread,
                marginTop: 6,
                marginRight: 12,
              }}
            />
          ) : (
            <View style={{ width: 8, marginRight: 12 }} />
          )}

          {/* Content */}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text
                style={{
                  color: colors.text,
                  fontWeight: isUnread ? '700' : '600',
                  fontSize: 15,
                  flex: 1,
                  marginRight: 8,
                }}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{timeAgo}</Text>
            </View>

            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }} numberOfLines={2}>
              {item.body}
            </Text>

            {item.data?.subscribedWatchlists && item.data.subscribedWatchlists.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 }}>
                {item.data.subscribedWatchlists.map((watchlist: string, index: number) => (
                  <View
                    key={index}
                    style={{
                      backgroundColor: colors.surfaceSecondary,
                      borderRadius: 100,
                      paddingHorizontal: 10,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                      {watchlist.replace(/-/g, ' ').replace(/_/g, ' ')}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} style={{ marginLeft: 8, marginTop: 2 }} />
        </View>
      </TouchableOpacity>
    );
  };

  const EmptyState = () => (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Ionicons name="notifications-outline" size={32} color={colors.textTertiary} />
      </View>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
        No Notifications
      </Text>
      <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
        You'll receive notifications about your watchlists and ORB alerts here.
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>Loading notifications…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600', marginTop: 16, marginBottom: 20 }}>
            Failed to load notifications
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={{
              backgroundColor: colors.accent,
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 14,
            }}
          >
            <Text style={{ color: colors.accentForeground, fontWeight: '600', fontSize: 15 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
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
            Alerts
          </Text>
          {unreadCount > 0 && (
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500', marginTop: 2 }}>
              {unreadCount} unread
            </Text>
          )}
        </View>

        {unreadCount > 0 && (
          <TouchableOpacity
            onPress={() => markAllAsRead()}
            style={{ marginBottom: 6 }}
          >
            <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '600' }}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={EmptyState}
        refreshControl={
          <RefreshControl
            tintColor={colors.accent}
            colors={[colors.accent]}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 170 }}
      />

      <ORBNotificationModal
        visible={orbModalVisible}
        onClose={handleOrbModalClose}
        notificationData={orbNotificationData}
        notificationTitle={orbNotificationTitle}
        notificationBody={orbNotificationBody}
      />
    </SafeAreaView>
  );
};

export default NotificationsScreen;
