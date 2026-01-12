import { View, Text, SafeAreaView, TextInput, FlatList, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { useState, useEffect, useCallback } from "react";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";
import * as SecureStore from 'expo-secure-store';
import { useTickerSearch } from "@/hooks/queries/ticker/useTickerSearch";
import { SearchHistoryItem } from "@/common/types/blogPosts/ticker";

const HISTORY_KEY = 'ticker_search_history';
const MAX_HISTORY_ITEMS = 10;

const SearchScreen = () => {
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"stocks" | "users">("stocks");
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const { toTicker } = useBaseNavigation();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText.trim().toUpperCase());
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText]);

  const shouldSearch = debouncedSearch.length >= 1 && debouncedSearch.length <= 5;
  const { data: searchResult, isLoading } = useTickerSearch(
    shouldSearch ? debouncedSearch : ""
  );

  useEffect(() => {
    loadSearchHistory();
  }, []);

  const loadSearchHistory = async () => {
    try {
      const historyJson = await SecureStore.getItemAsync(HISTORY_KEY);
      if (historyJson) {
        const history = JSON.parse(historyJson);
        setSearchHistory(history);
      }
    } catch (error) {
      console.error("Error loading search history:", error);
    }
  };

  /**
   * Saves the ticker to search history and navigates to ticker view.
   * 
   * @param tickerData the data of the ticker (used to set the ticker name when navigating to ticker name)
   */
  const handleTickerPress = useCallback(async (tickerData: SearchHistoryItem) => {
        // Remove duplicates and add new item at the beginning
        const updatedHistory = [
          tickerData,
          ...searchHistory.filter(item => item.ticker !== tickerData.ticker)
        ].slice(0, MAX_HISTORY_ITEMS);
    
        try {
          await SecureStore.setItemAsync(HISTORY_KEY, JSON.stringify(updatedHistory));
          setSearchHistory(updatedHistory);
        } catch (error) {
          console.error("Error saving to history:", error);
        }
         toTicker(tickerData.ticker);
       }, [toTicker, searchHistory]);

  const renderTickerCard = ({ item }: { item: SearchHistoryItem }) => {
    const isPositive = item.price_change_percent >= 0;
    const priceChangeColor = isPositive ? '#10B981' : '#EF4444';
    
    return (
      <TouchableOpacity
        onPress={() => handleTickerPress(item)}
        className="flex-row items-center bg-gray-800/60 border border-gray-700/30 rounded-xl p-4 mb-3"
        activeOpacity={0.7}
      >
        {/* Logo */}
        <View className="w-14 h-14 rounded-xl bg-gray-800/50 items-center justify-center mr-3 overflow-hidden">
          {item.logo_url ? (
            <Image 
              source={{ uri: item.logo_url }} 
              className="w-full h-full"
              resizeMode="contain"
            />
          ) : (
            <Text className="text-2xl font-bold text-gray-400">
              {item.ticker.charAt(0)}
            </Text>
          )}
        </View>

        {/* Company Info */}
        <View className="flex-1">
          <Text className="text-gray-400 text-xs font-medium mb-0.5">
            {item.ticker}
          </Text>
          <Text className="text-white text-base font-semibold mb-1">
            {item.company_name}
          </Text>
          <Text className="text-gray-400 text-xs uppercase">
            {item.industry}
          </Text>
        </View>

        {/* Price Info */}
        <View className="items-end">
          <Text className="text-white text-xl font-bold mb-1">
          ${(item.current_price ?? 0).toFixed(2)}
          </Text>
          <View
            className="px-3 py-1 rounded-full"
            style={{ backgroundColor: priceChangeColor + '20' }}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: priceChangeColor }}
            >
              {isPositive ? "+" : ""}{item.price_change_percent.toFixed(2)}%
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const displayData: SearchHistoryItem[] = [];
  
  if (searchResult?.success && searchResult.data) {
    displayData.push({
      ticker: searchResult.data.ticker,
      company_name: searchResult.data.company_name,
      current_price: searchResult.data.current_price,
      price_change_percent: searchResult.data.price_change_percent,
      logo_url: searchResult.data.logo_url || "",
      industry: searchResult.data.industry || "Undefined",
      timestamp: Date.now(),
    });
  } else if (!debouncedSearch && searchHistory.length > 0) {
    displayData.push(...searchHistory);
  }

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Main Content Card */}
      <View className="flex-1 bg-black px-5 pt-20">
        {/* Search Input */}
        <View className="flex-row items-center bg-gray-800/60 border border-gray-700/30 rounded-full px-5 py-3.5 mb-4">
          <Text className="text-gray-400 text-lg mr-2">🔍</Text>
          <TextInput
            className="flex-1 text-white text-base"
            placeholder="Search stocks..."
            placeholderTextColor="#6B7280"
            value={searchText}
            onChangeText={setSearchText}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={5}
            returnKeyType="search"
          />
        </View>

        {/* Tabs */}
        <View className="flex-row mb-4">
          <TouchableOpacity
            onPress={() => setActiveTab("stocks")}
            className={`px-6 py-2.5 rounded-full mr-2 ${
              activeTab === "stocks" ? "bg-gray-700/50" : "bg-gray-800/30"
            }`}
          >
            <Text
              className={`font-semibold ${
                activeTab === "stocks" ? "text-white" : "text-gray-400"
              }`}
            >
              Stocks
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab("users")}
            className={`px-6 py-2.5 rounded-full ${
              activeTab === "users" ? "bg-gray-700/50" : "bg-gray-800/30"
            }`}
          >
            <Text
              className={`font-semibold ${
                activeTab === "users" ? "text-white" : "text-gray-400"
              }`}
            >
              Users
            </Text>
          </TouchableOpacity>
        </View>

        {/* Results or History */}
        {activeTab === "stocks" && (
          <View className="flex-1">
            {isLoading ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color="#10B981" />
                <Text className="text-gray-400 mt-3">Searching...</Text>
              </View>
            ) : displayData.length > 0 ? (
              <>
                {!debouncedSearch && searchHistory.length > 0 && (
                  <Text className="text-gray-400 text-sm font-medium mb-3 uppercase tracking-wide">
                    Recent Searches
                  </Text>
                )}
                <FlatList
                  data={displayData}
                  renderItem={renderTickerCard}
                  keyExtractor={(item) => `${item.ticker}-${item.timestamp}`}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 20 }}
                />
              </>
            ) : debouncedSearch && searchResult && !searchResult.success ? (
              <View className="flex-1 items-center justify-center">
                <Text className="text-gray-400 text-lg">No results found</Text>
                <Text className="text-gray-400 text-sm mt-2">
                  Try searching for a different ticker
                </Text>
              </View>
            ) : (
              <View className="flex-1 items-center justify-center">
                <Text className="text-gray-400 text-lg">Search for stocks</Text>
                <Text className="text-gray-400 text-sm mt-2">
                  Enter a ticker symbol to get started
                </Text>
              </View>
            )}
          </View>
        )}

        {activeTab === "users" && (
          <View className="flex-1 items-center justify-center">
            <Text className="text-gray-400 text-lg">User search coming soon</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

export default SearchScreen;
