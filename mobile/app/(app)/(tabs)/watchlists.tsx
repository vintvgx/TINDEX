import { View, Text, SafeAreaView } from "react-native";
import { useMemo, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { WatchlistType } from "@/common/types";
import { useWatchlists } from "@/hooks/queries/watchlist/useWatchlist";
import { WatchlistSelector } from "@/common/components/watchlist/WatchlistSelector";
import { StockTable } from "@/common/components/watchlist/StockTable";
import { WATCHLIST_LABELS, WatchlistStock } from "@/common/types/watchlist";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";
import { useMarketStream } from "@/hooks/useMarketStream";

// Watchlist types backed by real ticker lists worth live-streaming (the rest
// render a "coming soon" placeholder with no stocks to stream).
const STREAMABLE_WATCHLISTS: WatchlistType[] = ['gainers', 'trending', 'most_active'];

const WatchlistsScreen = () => {
  const [selectedWatchlist, setSelectedWatchlist] = useState<WatchlistType>('gainers');

  // Only true while this tab is the focused/active screen — gates the live
  // price stream below so it never runs while the user is elsewhere in the app.
  const isFocused = useIsFocused();

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
  };

  const { stocks, isLoading } = getWatchlistData();

  // Stream only the tickers actually shown in the active list, and only while
  // that list's tab is selected AND the screen is in view. Switching tabs or
  // navigating away flips `enabled` to false, which closes the socket and
  // unsubscribes these tickers server-side (see useMarketStream).
  const streamTickers = useMemo(() => stocks.map(s => s.ticker), [stocks]);
  const streamEnabled = isFocused
    && STREAMABLE_WATCHLISTS.includes(selectedWatchlist)
    && streamTickers.length > 0;
  const { livePrices } = useMarketStream(streamTickers, { enabled: streamEnabled });

  // Overlay live prices onto the REST snapshot so rows update in real time
  // without waiting on the 5-minute watchlist refetch. `change`/`change_percent`
  // are re-derived off the previous close implied by the snapshot.
  const liveStocks = useMemo<WatchlistStock[]>(() => {
    if (!streamEnabled || Object.keys(livePrices).length === 0) return stocks;
    return stocks.map(s => {
      const live = livePrices[s.ticker];
      if (live == null || s.price == null) return s;
      const prevClose = s.price - (s.change ?? 0);
      const change = live - prevClose;
      const change_percent = prevClose !== 0 ? (change / prevClose) * 100 : s.change_percent;
      return { ...s, price: live, change, change_percent };
    });
  }, [stocks, livePrices, streamEnabled]);

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Subtle background gradient matching feed screen */}
      <View 
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.1)',
        }}
      />

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
        {['gainers', 'trending', 'most_active', 'favorites'].includes(selectedWatchlist) ? (
          <StockTable stocks={liveStocks} isLoading={isLoading} onPress={handleNavigation} />
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