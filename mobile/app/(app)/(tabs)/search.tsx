import { View, Text, SafeAreaView, TextInput } from "react-native";
import { useState } from "react";
import { TouchableOpacity } from "react-native";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";

const SearchScreen = () => {
  const [searchText, setSearchText] = useState("");
  const { toTicker } = useBaseNavigation();

  const isValidSearch = searchText.length >= 1 && searchText.length <= 5;

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1 justify-center items-center px-6">
        <View className="flex-row items-center w-full max-w-md">
          <TextInput
            className="flex-1 text-white px-4 py-3 rounded-lg text-5xl"
            placeholder="Enter Ticker"
            placeholderTextColor="#9CA3AF"
            value={searchText}
            onChangeText={setSearchText}
            autoCapitalize="characters"
            keyboardType="ascii-capable"
            autoCorrect={false}
            maxLength={5}
            returnKeyType="search"
            onSubmitEditing={() => isValidSearch && toTicker(searchText)}
            accessibilityLabel="Ticker search input"
          />
          {isValidSearch && (
            <TouchableOpacity
              className="ml-3 bg-blue-500 w-12 h-12 rounded-lg items-center justify-center active:bg-blue-600"
              onPress={() => toTicker(searchText)}>
              <Text className="text-white text-xl font-semibold">→</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

export default SearchScreen;
