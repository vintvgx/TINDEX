import { View, Text, SafeAreaView } from "react-native";

const SearchScreen = () => {
  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1 justify-center items-center">
        <Text className="text-white text-2xl font-bold">Search</Text>
        <Text className="text-gray-400 text-center mt-4 px-6">
          Search functionality coming soon...
        </Text>
      </View>
    </SafeAreaView>
  );
};

export default SearchScreen; 