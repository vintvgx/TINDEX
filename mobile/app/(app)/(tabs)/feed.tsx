import { MinimizedWatchlistComponent } from "@/common/components/FEED/cards/MinimizedWatchlistComponent";
import { Header } from "@/common/components/FEED/Header";
import MainContent from "@/common/components/FEED/MainContent";
import { AddPostModal } from "@/common/components/FEED/modals/AddPostModal";
import { PostDetailModal } from "@/common/components/FEED/modals/PostDetailModal";
import { SetMinimizedWatchlistModal } from "@/common/components/FEED/modals/SetMinimizedWatchlistModal";
import {
  ORBNotificationModal,
  ORBBreakoutNotificationData,
} from "@/common/components/FEED/modals/ORBNotificationModal";
import type { BlogPostType, UnifiedFeedItem } from "@/common/types";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { logDebug } from "@/common/utils/strings/function";
import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { useQueryClientReady } from "@/hooks/queries/useQueryClientReady";
import { useWatchlists } from "@/hooks/queries/watchlist/useWatchlist";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { SafeAreaView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

const FeedScreen = () => {
  const queryClient = useQueryClient();
  const isQueryClientReady = useQueryClientReady();
  const params = useLocalSearchParams();
  const router = useRouter();

  const [selectedPost, setSelectedPost] = useState<BlogPostType | null>(null);
  const [hasErrorOrNoData, setHasErrorOrNoData] = useState(false);

  // Blog Post Modal
  const [blogPostModalVisible, setBlogPostModalVisible] = useState(false);

  // Add Post Modal
  const [addModalVisible, setAddModalVisible] = useState(false);

  // Watchlist View Modal
  const [watchlistModalVisible, setWatchlistModalVisible] = useState(false);

  //ORB Modal Notification
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
  const [previewMode, setPreviewMode] = useState<
    "breakout" | "confirmed" | null
  >(null);

  // Feed data
  const { data: feed, isLoading: feedLoading, refetch: refetchFeed, isRefetching: isRefetchingFeed } = useFeedQuery();

  // Watchlists
  const {
    data: watchlistsData,
    isLoading: watchlistsLoading,
    error: watchlistError,
  } = useWatchlists();

  const {
    authState: { user, profile },
  } = useAuth();

  const handlePostPress = (item: UnifiedFeedItem) => {
    if (item.item_type === "blog") {
      logDebug("Blog post pressed:", item.content); // content is the title for blogs
      // Set the selected post ID to trigger the query
      setSelectedPost({ id: item.id } as BlogPostType);
      setBlogPostModalVisible(true);
    } else {
      // For updates, we can navigate to ticker detail or just log
      logDebug("Ticker update pressed:", item.ticker, item.content);
      // TODO: Navigate to ticker detail screen if needed
      // router.push(`/ticker/${item.ticker}`);
    }
  };

  const handleCloseModal = () => {
    setBlogPostModalVisible(false);
    setTimeout(() => setSelectedPost(null), 300);
  };

  const handleAddPress = () => {
    setAddModalVisible(true);
  };

  const handleAddModalClose = () => {
    setAddModalVisible(false);
  };

  const handleWatchlistModalClose = () => {
    setWatchlistModalVisible(false);
  };

  const handleSetWatchlistModalPress = () => {
    setWatchlistModalVisible(true);
  };

  const handleErrorOrNoDataChange = (hasErrorOrNoData: boolean) => {
    setHasErrorOrNoData(hasErrorOrNoData);
  };

  const handleBlogPostSuccess = async () => {
    console.log("Post submitted successfully");
    await queryClient.invalidateQueries({ queryKey: ["feed"] });
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
      setPreviewMode(null);
    }, 300);
  };

  // Mock data for breakout notification
  const mockBreakoutNotification: ORBBreakoutNotificationData = {
    type: "orb_breakout",
    ticker: "SPY",
    breakout_type: "above",
    price: 690.28,
    screen: "ticker",
    timestamp: new Date().toISOString(),
    orb_high: 688.61,
    orb_low: 687.98,
    breakout_analysis: {
      signal: "BULLISH",
      score: 85,
      confidence: "HIGH",
      reasons: [
        "Strong volume (1.8x avg)",
        "VWAP aligned",
        "Tight ORB range",
        "Clean break",
      ],
      rvol: 1.8,
      vwap_aligned: true,
      entry_price: 690.28,
      stop_loss: 687.98,
      risk_per_share: 2.3,
    },
  };

  const mockBreakoutTitle = "🟢 SPY ORB BREAKOUT (HIGH CONFIDENCE - 85/100)";
  const mockBreakoutBody = `Direction: BULLISH (Call opportunity)
Entry: $690.28
ORB High: $688.61
Stop Loss: $687.98 (ORL)

✓ Strong volume (1.8x avg)
✓ VWAP aligned
✓ Tight ORB range
✓ Clean break

Risk: $2.30 per share`;

  // Mock data for confirmed notification
  const mockConfirmedNotification: ORBBreakoutNotificationData = {
    type: "orb_breakout_confirmed",
    ticker: "AAPL",
    breakout_type: "above",
    price: 195.45,
    screen: "ticker",
    timestamp: new Date().toISOString(),
    orb_high: 194.2,
    orb_low: 193.5,
    breakout_analysis: {
      signal: "BULLISH",
      score: 92,
      confidence: "HIGH",
      reasons: [
        "Strong volume (2.3x avg)",
        "VWAP aligned",
        "Tight ORB range",
        "Clean break",
        "Confirmed after 3-minute close",
      ],
      rvol: 2.3,
      vwap_aligned: true,
      entry_price: 194.25,
      stop_loss: 193.5,
      risk_per_share: 0.75,
    },
  };

  const mockConfirmedTitle = "🟢 AAPL BREAKOUT CONFIRMED";
  const mockConfirmedBody = `AAPL BULLISH breakout confirmed after 3-minute close. Price: $195.45`;

  const handlePreviewPress = () => {
    // Toggle between breakout and confirmed previews
    if (previewMode === null || previewMode === "confirmed") {
      // Show breakout preview
      setOrbNotificationData(mockBreakoutNotification);
      setOrbNotificationTitle(mockBreakoutTitle);
      setOrbNotificationBody(mockBreakoutBody);
      setPreviewMode("breakout");
      setOrbNotificationModalVisible(true);
    } else {
      // Show confirmed preview
      setOrbNotificationData(mockConfirmedNotification);
      setOrbNotificationTitle(mockConfirmedTitle);
      setOrbNotificationBody(mockConfirmedBody);
      setPreviewMode("confirmed");
      setOrbNotificationModalVisible(true);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Subtle background gradient */}
      <View 
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.1)',
        }}
      />

      {/* Header Component */}
      <Header onAddPress={handleAddPress} onPreviewPress={handlePreviewPress} />

      {/* Unified Trending Stocks Component */}
      <MinimizedWatchlistComponent
        watchlists={watchlistsData}
        isLoading={watchlistsLoading}
        error={watchlistError}
        isQueryClientReady={isQueryClientReady}
        openSetWatchlistModal={handleSetWatchlistModalPress}
        profile={profile}
        onErrorOrNoDataChange={handleErrorOrNoDataChange}
      />

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
      <AddPostModal
        visible={addModalVisible}
        onClose={handleAddModalClose}
        onSubmit={handleBlogPostSuccess}
      />
      <SetMinimizedWatchlistModal
        visible={watchlistModalVisible}
        onClose={handleWatchlistModalClose}
        hasErrorOrNoData={hasErrorOrNoData}
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
