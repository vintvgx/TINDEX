import React from 'react';
import { View, Text, ActivityIndicator, FlatList } from 'react-native';
import { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { ORBCard } from './ORBCard';
import type { ORBRange } from '@/common/types/orb';
import type { ORBGridLayout } from './ORBMenu';
import { useThemeColors } from '@/lib/useColorScheme';

interface ORBCardGridProps {
  data: ORBMonitoringState[];
  isLoading: boolean;
  onCardPress: (data: ORBMonitoringState) => void;
  lastFetchTime?: Date | null;
  rangesByTicker?: Record<string, ORBRange>;
  gridLayout?: ORBGridLayout;
}

const formatDateTime = (date: Date): string =>
  date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

export const ORBCardGrid: React.FC<ORBCardGridProps> = ({
  data,
  isLoading,
  onCardPress,
  lastFetchTime,
  rangesByTicker,
  gridLayout = '2x2',
}) => {
  const colors = useThemeColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>Loading ORB data…</Text>
      </View>
    );
  }

  if (!data || data.length === 0) {
    return (
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
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
            No ORB Data
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Tickers will appear here once ORB monitoring starts
          </Text>
        </View>
      </View>
    );
  }

  const renderFooter = () => {
    if (!lastFetchTime) return null;
    return (
      <View style={{ paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8 }}>
        <View style={{ height: 1, backgroundColor: colors.separator, marginBottom: 12 }} />
        <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: 'center' }}>
          Last updated: {formatDateTime(lastFetchTime)}
        </Text>
      </View>
    );
  };

  const numColumns = gridLayout === '1x1' ? 1 : 2;
  const fullWidth = gridLayout === '1x1';

  return (
    <FlatList
      key={`orb-grid-${gridLayout}`}
      data={data}
      numColumns={numColumns}
      keyExtractor={(item, index) => `${item.ticker}-${index}`}
      renderItem={({ item }) => (
        <ORBCard
          data={item}
          onPress={() => onCardPress(item)}
          orbRange={rangesByTicker?.[item.ticker]}
          fullWidth={fullWidth}
        />
      )}
      contentContainerStyle={{ padding: 16, paddingBottom: 170 }}
      columnWrapperStyle={numColumns === 2 ? { justifyContent: 'space-between' } : undefined}
      showsVerticalScrollIndicator={false}
      ListFooterComponent={renderFooter}
    />
  );
};
