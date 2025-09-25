import { View, Text, SafeAreaView } from "react-native";

const WatchlistsScreen = () => {
  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1 justify-center items-center">
        <Text className="text-white text-2xl font-bold">Watchlists</Text>
        <Text className="text-gray-400 text-center mt-4 px-6">
          Watchlists functionality coming soon...
        </Text>
      </View>
    </SafeAreaView>
  );
};

export default WatchlistsScreen; 