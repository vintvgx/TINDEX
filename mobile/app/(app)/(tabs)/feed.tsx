import { FeedPositionBanner } from "@/common/components/FEED/FeedPositionBanner";
import { FeedMarketPulseStrip } from "@/common/components/FEED/FeedMarketPulseStrip";
import { Header } from "@/common/components/FEED/Header";
import MainContent from "@/common/components/FEED/MainContent";
import { useThemeColors } from "@/lib/useColorScheme";
import { PostDetailModal } from "@/common/components/FEED/modals/PostDetailModal";
import {
  ORBNotificationModal,
  ORBBreakoutNotificationData,
} from "@/common/components/FEED/modals/ORBNotificationModal";
import type { BlogPostType, UnifiedFeedItem } from "@/common/types";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { logDebug } from "@/common/utils/strings/function";
import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { useState, useEffect } from "react";
import { SafeAreaView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

const FeedScreen = () => {
  const colors = useThemeColors();
  const params = useLocalSearchParams();
  const router = useRouter();

  const [selectedPost, setSelectedPost] = useState<BlogPostType | null>(null);

  // Blog Post Modal
  const [blogPostModalVisible, setBlogPostModalVisible] = useState(false);

  // ORB Modal Notification (push-notification driven)
  const [orbNotificationModalVisible, setOrbNotificationModalVisible] =
    useState(false);
  const [orbNotificationData, setOrbNotificationData] =
    useState<ORBBreakoutNotificationData | null>(null);
  const [orbNotificationTitle, setOrbNotificationTitle] = useState<
    string | undefined
  >(undefined);
  const [orbNotificationBody, setOrbNotificationBody] = useState<
    string | undefined
  >(undefined);

  // Feed data
  const {
    data: feed,
    isLoading: feedLoading,
    refetch: refetchFeed,
    isRefetching: isRefetchingFeed,
  } = useFeedQuery();

  const {
    authState: { user },
  } = useAuth();

  const handlePostPress = (item: UnifiedFeedItem) => {
    if (item.item_type === "blog") {
      logDebug("Blog post pressed:", item.content); // content is the title for blogs
      setSelectedPost({ id: item.id } as BlogPostType);
      setBlogPostModalVisible(true);
    } else {
      // For updates, we can navigate to ticker detail or just log
      logDebug("Ticker update pressed:", item.ticker, item.content);
      // TODO: Navigate to ticker detail screen if needed
    }
  };

  const handleCloseModal = () => {
    setBlogPostModalVisible(false);
    setTimeout(() => setSelectedPost(null), 300);
  };

  const handleScroll = (_newScrollY: number) => {
    // Scroll handling can be implemented here if needed
  };

  // Handle notification data from route params
  useEffect(() => {
    if (params.notificationData) {
      try {
        const notificationData = JSON.parse(
          params.notificationData as string
        ) as ORBBreakoutNotificationData;
        const title = params.notificationTitle as string | undefined;
        const body = params.notificationBody as string | undefined;

        setOrbNotificationData(notificationData);
        setOrbNotificationTitle(title);
        setOrbNotificationBody(body);
        setOrbNotificationModalVisible(true);

        // Clear params after processing
        router.setParams({
          notificationData: undefined,
          notificationTitle: undefined,
          notificationBody: undefined,
        });
      } catch (error) {
        console.error(`Error parsing notification data: ${error}`);
      }
    }
  }, [
    params.notificationData,
    params.notificationTitle,
    params.notificationBody,
    router,
  ]);

  const handleOrbNotificationClose = () => {
    setOrbNotificationModalVisible(false);
    setTimeout(() => {
      setOrbNotificationData(null);
      setOrbNotificationTitle(undefined);
      setOrbNotificationBody(undefined);
    }, 300);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <Header />

      {/* Live positions — compact chips, or quiet empty state */}
      <FeedPositionBanner />

      {/* Market Pulse — long-press to configure visible items */}
      <FeedMarketPulseStrip />

      {/* Main Content */}
      <MainContent
        feed={feed}
        feedLoading={feedLoading}
        handlePostPress={handlePostPress}
        onScroll={handleScroll}
        refetchFeed={refetchFeed}
        isRefetching={isRefetchingFeed}
      />

      {/* Modals */}
      <PostDetailModal
        user={user}
        post={selectedPost}
        visible={blogPostModalVisible}
        onClose={handleCloseModal}
      />
      <ORBNotificationModal
        visible={orbNotificationModalVisible}
        onClose={handleOrbNotificationClose}
        notificationData={orbNotificationData}
        notificationTitle={orbNotificationTitle}
        notificationBody={orbNotificationBody}
      />
    </SafeAreaView>
  );
};

export default FeedScreen;
