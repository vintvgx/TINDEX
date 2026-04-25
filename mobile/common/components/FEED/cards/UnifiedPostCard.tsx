import { useThemeColors } from '@/lib/useColorScheme';
import type { UnifiedFeedItem } from '@/common/types';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { Ionicons } from '@expo/vector-icons';
import type React from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface UnifiedPostCardProps {
  item: UnifiedFeedItem;
  onPress?: () => void;
  onUpvote?: (id: string) => void;
  isLast?: boolean;
}

const formatRelativeTime = (dateString: string): string => {
  const diffInSeconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diffInSeconds < 60) return 'now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 604800)}w`;
  return `${Math.floor(diffInSeconds / 2592000)}mo`;
};

const truncateContent = (content: string | null | undefined, maxLength = 400): string => {
  if (!content) return '';
  return content.length <= maxLength ? content : content.substring(0, maxLength).trim() + '…';
};

export const UnifiedPostCard: React.FC<UnifiedPostCardProps> = ({
  item,
  onPress,
  onUpvote,
  isLast = false,
}) => {
  const colors = useThemeColors();
  const [isUpvoted, setIsUpvoted] = useState(false);
  const [upvoteCount, setUpvoteCount] = useState(0);
  const { toTicker } = useBaseNavigation();

  const isUpdate = item.item_type === 'update';
  const symbol = item.ticker || (isUpdate ? 'UPDATE' : 'POST');
  const title = isUpdate ? undefined : item.content || '';
  const content = isUpdate ? item.content || '' : item.full_content || '';
  const displayContent = isUpdate ? content : truncateContent(content, 400);
  const hasMore = !isUpdate && (item.full_content?.length ?? 0) > 400;
  const tags = item.tags || [];
  const relativeTime = formatRelativeTime(item.published_at || item.created_at);
  const accentColor = isUpdate ? colors.accent : '#5856D6';

  const handleUpvote = () => {
    const next = !isUpvoted;
    setIsUpvoted(next);
    setUpvoteCount((p) => (next ? p + 1 : Math.max(0, p - 1)));
    onUpvote?.(item.id);
  };

  return (
    <Pressable onPress={onPress} style={{ backgroundColor: colors.background }}>
      <View style={s.card}>
        {/* Avatar + name + time + badge */}
        <View style={s.topRow}>
          <Pressable onPress={() => item.ticker && toTicker(item.ticker)}>
            <View
              style={[
                s.avatar,
                { backgroundColor: accentColor + '18', borderColor: accentColor + '30' },
              ]}
            >
              <Text style={[s.avatarText, { color: accentColor }]}>
                {symbol.substring(0, 2).toUpperCase()}
              </Text>
            </View>
          </Pressable>

          <View style={s.nameBlock}>
            <Pressable onPress={() => item.ticker && toTicker(item.ticker)}>
              <Text style={[s.symbolText, { color: colors.text }]}>{symbol}</Text>
            </Pressable>
            <Text style={[s.timeText, { color: colors.textTertiary }]}>{relativeTime}</Text>
          </View>

          <View style={[s.badge, { backgroundColor: accentColor + '14' }]}>
            <Text style={[s.badgeText, { color: accentColor }]}>
              {isUpdate ? 'Update' : 'Post'}
            </Text>
          </View>
        </View>

        {/* Title */}
        {title ? (
          <Text style={[s.title, { color: colors.text }]}>{title}</Text>
        ) : null}

        {/* Tags */}
        {tags.length > 0 && (
          <View style={s.tagsRow}>
            {tags.slice(0, 3).map((tag, i) => (
              <View
                key={i}
                style={[s.tag, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[s.tagText, { color: colors.textSecondary }]}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Content */}
        {displayContent ? (
          <View style={s.contentBlock}>
            <Text style={[s.content, { color: colors.textSecondary }]}>{displayContent}</Text>
            {hasMore && (
              <Text style={[s.readMore, { color: colors.accent }]}>Read more</Text>
            )}
          </View>
        ) : null}

        {/* Footer */}
        <View style={s.footer}>
          <Pressable onPress={handleUpvote} style={s.upvoteRow}>
            <Ionicons
              name={isUpvoted ? 'chevron-up' : 'chevron-up-outline'}
              size={20}
              color={isUpvoted ? colors.success : colors.textTertiary}
            />
            {upvoteCount > 0 && (
              <Text style={[s.upvoteCount, { color: isUpvoted ? colors.success : colors.textTertiary }]}>
                {upvoteCount}
              </Text>
            )}
          </Pressable>

          {!isUpdate && item.full_content && (
            <View style={s.readTimeRow}>
              <Ionicons name="time-outline" size={13} color={colors.textTertiary} />
              <Text style={[s.readTimeText, { color: colors.textTertiary }]}>
                {Math.ceil((item.full_content.length || 0) / 200)} min
              </Text>
            </View>
          )}
        </View>
      </View>

      {!isLast && <View style={[s.separator, { backgroundColor: colors.separator }]} />}
    </Pressable>
  );
};

const s = StyleSheet.create({
  card: { paddingHorizontal: 20, paddingVertical: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
  },
  avatarText: { fontWeight: '700', fontSize: 13 },
  nameBlock: { flex: 1 },
  symbolText: { fontWeight: '600', fontSize: 15 },
  timeText: { fontSize: 12, marginTop: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  title: { fontWeight: '700', fontSize: 17, marginBottom: 8, letterSpacing: -0.2, lineHeight: 24 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8, gap: 6 },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    borderWidth: 1,
  },
  tagText: { fontSize: 12, fontWeight: '500' },
  contentBlock: { marginBottom: 12 },
  content: { fontSize: 15, lineHeight: 22 },
  readMore: { fontSize: 14, marginTop: 4, fontWeight: '500' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  upvoteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  upvoteCount: { fontSize: 13, fontWeight: '600' },
  readTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readTimeText: { fontSize: 12 },
  separator: { height: 1, marginHorizontal: 20 },
});
