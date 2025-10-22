import { View, Text, SafeAreaView } from "react-native";
import { useState } from "react";
import { WatchlistType } from "@/common/types";
import { useWatchlists } from "@/hooks/queries/watchlist/useWatchlist";
import { WatchlistSelector } from "@/common/components/watchlist/WatchlistSelector";
import { StockTable } from "@/common/components/watchlist/StockTable";
import { WATCHLIST_LABELS, WatchlistStock } from "@/common/types/watchlist";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";

const WatchlistsScreen = () => {
  const [selectedWatchlist, setSelectedWatchlist] = useState<WatchlistType>('biggest-gainers');
  
  // Fetch all watchlists in a single API call
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
      case 'biggest-gainers':
        console.log("Biggest gainers len", watchlistsData.watchlists.gainers.count)
        return {
          stocks: watchlistsData.watchlists.gainers?.data || [],
          isLoading: false,
        };
      case 'trending':
        return {
          stocks: watchlistsData.watchlists.trending?.data || [],
          isLoading: false,
        };
      case 'most-active':
        console.log("Most Act len", watchlistsData.watchlists.most_active.count)

        return {
          stocks: watchlistsData.watchlists.most_active?.data || [],
          isLoading: false,
        };
      // These watchlist types are not yet implemented in the API
      case 'insider_buying':
      case 'congress_trading':
      case 'top_gainers':
      case 'top_losers':
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
  };

  const { stocks, isLoading } = getWatchlistData();

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Subtle background gradient matching feed screen */}
      <View className="absolute inset-0 bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/10" />

      {/* Header */}
      <View className="px-6 py-4 border-b border-gray-800">
        <Text className="text-white text-3xl font-bold">Watchlists</Text>
      </View>

      {/* Watchlist Selector */}
      <WatchlistSelector
        selectedWatchlist={selectedWatchlist}
        onSelectWatchlist={setSelectedWatchlist}
      />

      {/* Stock Table */}
      <View className="flex-1">
        {/* Show table for implemented watchlist types */}
        {['biggest-gainers', 'trending', 'most-active'].includes(selectedWatchlist) ? (
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
  );
};

export default WatchlistsScreen;