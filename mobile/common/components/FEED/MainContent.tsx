import { FeedType, UnifiedFeedItem } from '@/common/types';
import { useThemeColors } from '@/lib/useColorScheme';
import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { UnifiedPostCard } from './cards/UnifiedPostCard';

interface MainContentType {
  feedLoading: boolean;
  feed: FeedType | null | undefined;
  handlePostPress: (item: UnifiedFeedItem) => void;
  onScroll?: (scrollY: number) => void;
  refetchFeed?: () => void;
  isRefetching?: boolean;
}

const MainContent: React.FC<MainContentType> = ({
  feedLoading,
  feed,
  handlePostPress,
  onScroll,
  refetchFeed,
  isRefetching = false,
}) => {
  const colors = useThemeColors();
  const items = feed?.items;

  const handleScroll = (event: any) => {
    onScroll?.(event.nativeEvent.contentOffset.y);
  };

  if (feedLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={{ marginTop: 14, fontSize: 15, color: colors.textSecondary, fontWeight: '500' }}>
          Loading feed…
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 110, paddingTop: 4 }}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetchFeed}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      {items && items.length > 0 ? (
        items.map((item, index) => (
          <UnifiedPostCard
            key={item.id}
            item={item}
            onPress={() => handlePostPress(item)}
            isLast={index === items.length - 1}
          />
        ))
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, paddingHorizontal: 32 }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 20,
              padding: 32,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                fontSize: 20,
                fontWeight: '700',
                color: colors.text,
                marginBottom: 8,
                textAlign: 'center',
              }}
            >
              No Posts Yet
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: colors.textSecondary,
                textAlign: 'center',
                lineHeight: 20,
              }}
            >
              Check back later for new content
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
};

export default MainContent;
