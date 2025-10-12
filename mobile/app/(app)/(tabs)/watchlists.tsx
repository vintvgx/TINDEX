import { View, Text, SafeAreaView } from "react-native";
import { useState } from "react";
import { WatchlistType } from "@/common/types";
import { useBiggestGainersVersionOne } from "@/hooks/queries/watchlist/useBiggestGainers";
import { WatchlistSelector } from "@/common/components/watchlist/WatchlistSelector";
import { StockTable } from "@/common/components/watchlist/StockTable";
import { WATCHLIST_LABELS } from "@/common/types/watchlist";

const WatchlistsScreen = () => {
  const [selectedWatchlist, setSelectedWatchlist] = useState<WatchlistType>('biggest-gainers');
  
  // Fetch data based on selected watchlist
  const { data: biggestGainersData, isLoading: biggestGainersLoading } = useBiggestGainersVersionOne();
  
  // Determine which data to show based on selected watchlist
  const getWatchlistData = () => {
    switch (selectedWatchlist) {
      case 'biggest-gainers':
        return {
          stocks: biggestGainersData?.data || [],
          isLoading: biggestGainersLoading,
        };
      // Add other cases as you implement them
      case 'trending':
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
        {selectedWatchlist === 'biggest-gainers' ? (
          <StockTable stocks={stocks} isLoading={isLoading} />
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