import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";
import { useNotificationHistory } from "@/hooks/queries/notifications/useNotificationHistory";
import { NotificationRecord } from "@/common/types/notifications/notificationModel";
import { formatDistanceToNow } from "date-fns";
import {
  ORBNotificationModal,
  ORBBreakoutNotificationData,
} from "@/common/components/FEED/modals/ORBNotificationModal";

const NotificationsScreen = () => {
  const { toTicker } = useBaseNavigation();

  const {
    notifications,
    isLoading,
    error,
    refetch,
    markAsRead,
    markAllAsRead,
    unreadCount,
  } = useNotificationHistory();

  const [refreshing, setRefreshing] = useState(false);

  // ORB Modal state
  const [orbModalVisible, setOrbModalVisible] = useState(false);
  const [orbNotificationData, setOrbNotificationData] =
    useState<ORBBreakoutNotificationData | null>(null);
  const [orbNotificationTitle, setOrbNotificationTitle] = useState<
    string | undefined
  >(undefined);
  const [orbNotificationBody, setOrbNotificationBody] = useState<
    string | undefined
  >(undefined);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  // Extract ticker from notification body or watchlist data
  const extractTicker = (notification: NotificationRecord): string | null => {
    // If ticker is explicitly in data
    if (notification.data?.ticker) {
      return notification.data.ticker;
    }

    // Try to extract ticker from body using regex (e.g., "$AAPL" or "AAPL")
    const tickerMatch = notification.body.match(/\$?([A-Z]{1,5})\b/);
    return tickerMatch ? tickerMatch[1] : null;
  };

  // Handle notification press
  const handleNotificationPress = useCallback(
    (notification: NotificationRecord) => {
      // Mark as read if not already
      if (!notification.is_read) {
        markAsRead(notification.id);
      }

      // Check if this is an ORB notification
      const orbType = notification.data?.type;
      if (
        orbType === "orb_breakout" ||
        orbType === "orb_breakout_confirmed" ||
        orbType === "orb_breakout_invalidated"
      ) {
        // Log warning and display Alert if ticker name is not included
        if (!notification.data.ticker) {
          console.warn("ORB notification missing ticker:", notification.id);
          Alert.alert("ORB notification missing ticker:", notification.id);
          return;
        }

        // Show ORB modal
        const orbData: ORBBreakoutNotificationData = {
          type: orbType,
          ticker: notification.data.ticker || "",
          breakout_type: notification.data.breakout_type || "above",
          price: notification.data.price || 0,
          screen: notification.data.screen || "ticker",
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
        };

        setOrbNotificationData(orbData);
        setOrbNotificationTitle(notification.title);
        setOrbNotificationBody(notification.body);
        setOrbModalVisible(true);
        return;
      }

      // Extract ticker and navigate if found
      const ticker = extractTicker(notification);
      if (ticker) {
        toTicker(ticker);
      } else {
        // Navigate to watchlist screen if no specific ticker
        // You might need to adjust this based on your navigation structure
        console.log("Navigate to watchlist:", notification.data?.watchlistType);
      }
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

  // Render individual notification item
  const renderNotification = ({ item }: { item: NotificationRecord }) => {
    const timeAgo = formatDistanceToNow(new Date(item.created_at), {
      addSuffix: true,
    });

    return (
      <TouchableOpacity
        onPress={() => handleNotificationPress(item)}
        className={`px-4 py-4 border-b border-gray-800 ${
          !item.is_read ? "bg-gray-900/50" : ""
        }`}
        activeOpacity={0.7}>
        <View className="flex-row items-start">
          {/* Unread indicator */}
          {!item.is_read && (
            <View className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3" />
          )}

          {/* Notification content */}
          <View className="flex-1">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-white font-semibold text-base">
                {item.title}
              </Text>
              <Text className="text-gray-500 text-xs">{timeAgo}</Text>
            </View>

            <Text className="text-gray-400 text-sm leading-5">{item.body}</Text>

            {/* Watchlist badges */}
            {item.data?.subscribedWatchlists &&
              item.data.subscribedWatchlists.length > 0 && (
                <View className="flex-row flex-wrap mt-2">
                  {item.data.subscribedWatchlists.map((watchlist, index) => (
                    <View
                      key={index}
                      className="bg-gray-800 rounded-full px-2 py-1 mr-2 mb-1">
                      <Text className="text-gray-300 text-xs">
                        {watchlist.replace(/-/g, " ").replace(/_/g, " ")}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
          </View>

          {/* Chevron icon */}
          <Ionicons
            name="chevron-forward"
            size={16}
            color="#6B7280"
            style={{ marginLeft: 8, marginTop: 2 }}
          />
        </View>
      </TouchableOpacity>
    );
  };

  // Empty state component
  const EmptyState = () => (
    <View className="flex-1 justify-center items-center px-6">
      <Ionicons name="notifications-outline" size={64} color="#4B5563" />
      <Text className="text-white text-xl font-semibold mt-4">
        No notifications yet
      </Text>
      <Text className="text-gray-400 text-center mt-2">
        You will receive notifications about your watchlists here
      </Text>
    </View>
  );

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text className="text-gray-400 mt-4">Loading notifications...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <View className="flex-1 justify-center items-center px-6">
          <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
          <Text className="text-white text-lg mt-4">
            Failed to load notifications
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            className="mt-4 bg-blue-600 px-4 py-2 rounded-lg">
            <Text className="text-white font-semibold">Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-800">
        <Text className="text-white text-xl font-bold">Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            onPress={() => markAllAsRead()}
            className="px-3 py-1">
            <Text className="text-blue-500 text-sm font-medium">
              Mark all as read
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Notifications list */}
      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={EmptyState}
        refreshControl={
          <RefreshControl
            tintColor="#3B82F6"
            colors={["#3B82F6"]}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
        contentContainerStyle={{
          flexGrow: 1,
        }}
      />

      {/* ORB Notification Modal */}
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
