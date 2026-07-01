import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, SafeAreaView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { usePerformanceReviews } from '@/hooks/queries/review/usePerformanceReviews';
import { useGenerateReview } from '@/hooks/mutations/review/useGenerateReview';
import { ReviewDetailModal } from '@/common/components/review/ReviewDetailModal';
import type { PerformanceReviewSummary } from '@/common/types/review';

function pnlColor(pnl: number, colors: ReturnType<typeof useThemeColors>) {
  if (pnl > 0) return colors.success;
  if (pnl < 0) return colors.error;
  return colors.textSecondary;
}

function fmtPnl(n: number) {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(0)}`;
}

function fmtDate(dateStr: string) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function DailyReviewScreen() {
  const colors = useThemeColors();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = usePerformanceReviews(30);
  const generateReview = useGenerateReview();

  const reviews: PerformanceReviewSummary[] = data?.data ?? [];

  const handleGenerate = () => {
    Alert.alert(
      'Generate Today\'s Review',
      'This calls Claude to analyse today\'s trades. It takes ~15 seconds and costs a small amount of API credit.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: () => {
            generateReview.mutate(undefined, {
              onSuccess: (res) => {
                const date = res?.date;
                Alert.alert('Review ready', `Review for ${date} generated.`);
                if (date) setSelectedDate(date);
              },
              onError: (e) => Alert.alert('Failed', (e as Error).message),
            });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>
              Daily Review
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
              Auto-generated at 4:15 PM ET · paper + live
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleGenerate}
            disabled={generateReview.isPending}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {generateReview.isPending
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Ionicons name="sparkles" size={18} color={colors.accent} />
            }
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={reviews}
        keyExtractor={(r) => r.review_date}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={() => refetch()}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => <ReviewCard item={item} colors={colors} onPress={() => setSelectedDate(item.review_date)} />}
        ListEmptyComponent={() => (
          isLoading ? (
            <View style={{ padding: 60, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : (
            <View style={{ padding: 60, alignItems: 'center' }}>
              <Text style={{ fontSize: 40, marginBottom: 16 }}>📋</Text>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
                No reviews yet
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
                Reviews are auto-generated at 4:15 PM ET after each trading session.{'\n'}
                Tap ✦ to generate today's review manually.
              </Text>
            </View>
          )
        )}
      />

      <ReviewDetailModal
        date={selectedDate}
        visible={!!selectedDate}
        onClose={() => setSelectedDate(null)}
      />
    </SafeAreaView>
  );
}

function ReviewCard({
  item, colors, onPress,
}: {
  item: PerformanceReviewSummary;
  colors: ReturnType<typeof useThemeColors>;
  onPress: () => void;
}) {
  const profit = item.net_pnl >= 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.78}
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 16,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: profit ? colors.success + '33' : colors.error + '33',
        borderLeftWidth: 3,
        borderLeftColor: profit ? colors.success : colors.error,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
            {fmtDate(item.review_date)}
          </Text>
        </View>
        <Text style={{ color: pnlColor(item.net_pnl, colors), fontSize: 20, fontWeight: '800' }}>
          {fmtPnl(item.net_pnl)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {/* Win rate bar */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Win rate</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
              {item.winners}W · {item.losers}L
            </Text>
          </View>
          <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
            <View style={{
              height: 4,
              width: `${Math.min(item.win_rate, 100)}%`,
              backgroundColor: item.win_rate >= 50 ? colors.success : colors.error,
              borderRadius: 2,
            }} />
          </View>
        </View>

        {/* Win % chip */}
        <View style={{
          backgroundColor: (item.win_rate >= 50 ? colors.success : colors.error) + '22',
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 4,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <Text style={{ color: item.win_rate >= 50 ? colors.success : colors.error, fontSize: 13, fontWeight: '700' }}>
            {item.win_rate.toFixed(0)}%
          </Text>
        </View>

        {/* Trades chip */}
        <View style={{
          backgroundColor: colors.border,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 4,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>
            {item.trade_count}T
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
        <Text style={{ color: colors.textTertiary, fontSize: 11, flex: 1 }}>
          Tap to view full AI analysis
        </Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}
