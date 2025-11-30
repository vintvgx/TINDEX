import { WatchlistType } from '@/common/types';
import { WATCHLIST_LABELS } from '@/common/types/watchlist';
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';

interface WatchlistSelectorProps {
  selectedWatchlist: WatchlistType;
  onSelectWatchlist: (watchlist: WatchlistType) => void;
}

const WATCHLIST_OPTIONS: WatchlistType[] = [
  'gainers',
  'trending',
  'most_active',
  'favorites',
  // 'insider_buying',
  // 'congress_trading',
  // 'top_gainers',
  // 'top_losers',
];

export const WatchlistSelector: React.FC<WatchlistSelectorProps> = ({
  selectedWatchlist,
  onSelectWatchlist,
}) => {
  return (
    <View className="py-4 border-b border-gray-800">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {WATCHLIST_OPTIONS.map((watchlist) => {
          const isSelected = selectedWatchlist === watchlist;
          return (
            <TouchableOpacity
              key={watchlist}
              onPress={() => onSelectWatchlist(watchlist)}
              className={`px-4 py-2 rounded-full ${
                isSelected
                  ? 'bg-blue-600'
                  : 'bg-gray-800/50 border border-gray-700'
              }`}
              activeOpacity={0.7}
            >
              <Text
                className={`text-sm font-medium ${
                  isSelected ? 'text-white' : 'text-gray-400'
                }`}
              >
                {WATCHLIST_LABELS[watchlist]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};