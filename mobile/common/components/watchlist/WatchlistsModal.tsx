import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  SafeAreaView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WatchlistType } from '@/common/types';
import { useWatchlists } from '@/hooks/queries/watchlist/useWatchlist';
import { WatchlistSelector } from '@/common/components/watchlist/WatchlistSelector';
import { StockTable } from '@/common/components/watchlist/StockTable';
import { WATCHLIST_LABELS, WatchlistStock } from '@/common/types/watchlist';
import useBaseNavigation from '@/hooks/navigation/useBaseNavigation';

interface WatchlistsModalProps {
  visible: boolean;
  onClose: () => void;
}

export const WatchlistsModal: React.FC<WatchlistsModalProps> = ({
  visible,
  onClose,
}) => {
  const [selectedWatchlist, setSelectedWatchlist] = useState<WatchlistType>('gainers');
  
  // Fetch all watchlists 
  const { data: watchlistsData, isLoading: watchlistsLoading } = useWatchlists();

  // Navigates to selected ticker
  const { toTicker } = useBaseNavigation();
  
  // Determine which data to show based on selected watchlist
  const getWatchlistData = () => {
    // If still loading or no data, return loading state
    if (watchlistsLoading || !watchlistsData?.watchlists) {
      return {
        stocks: [],
        isLoading: watchlistsLoading,
      };
    }

    switch (selectedWatchlist) {
      case 'gainers':
        return {
          stocks: watchlistsData.watchlists.gainers?.data || [],
          isLoading: false,
        };
      case 'trending':
        return {
          stocks: watchlistsData.watchlists.trending?.data || [],
          isLoading: false,
        };
      case 'most_active':
        return {
          stocks: watchlistsData.watchlists.most_active?.data || [],
          isLoading: false,
        };
      // These watchlist types are not yet implemented in the API
      case 'insider':
      case 'congress':
      case 'top_gainers':
      case 'top_losers':
      case 'favorites':
        return {
          stocks: [],
          isLoading: false,
        };
      default:
        return {
          stocks: [],
          isLoading: false,
        };
    }
  };

  // Navigation handler using the navigation service
  const handleNavigation = (ticker: string) => {
    toTicker(ticker);
    onClose(); // Close modal when navigating to ticker
  };

  const { stocks, isLoading } = getWatchlistData();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-black">
        <StatusBar barStyle="light-content" />
        
        {/* Subtle background gradient matching feed screen */}
        <View className="absolute inset-0 bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/10" />

        {/* Header */}
        <View className="px-6 py-4 border-b border-gray-800 flex-row items-center justify-between">
          <Text className="text-white text-3xl font-bold">Watchlists</Text>
          <TouchableOpacity
            onPress={onClose}
            className="w-10 h-10 items-center justify-center"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Watchlist Selector */}
        <WatchlistSelector
          selectedWatchlist={selectedWatchlist}
          onSelectWatchlist={setSelectedWatchlist}
        />

        {/* Stock Table */}
        <View className="flex-1">
          {/* Show table for implemented watchlist types */}
          {['gainers', 'trending', 'most_active', 'favorites'].includes(selectedWatchlist) ? (
            <StockTable stocks={stocks} isLoading={isLoading} onPress={handleNavigation} />
          ) : (
            <View className="flex-1 justify-center items-center px-6">
              <Text className="text-gray-400 text-center">
                {WATCHLIST_LABELS[selectedWatchlist]} coming soon...
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

