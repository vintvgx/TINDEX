import { View, Text, SafeAreaView } from "react-native";

const StackScreen = () => {
  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1 justify-center items-center">
        <Text className="text-white text-2xl font-bold">Stack</Text>
        <Text className="text-gray-400 text-center mt-4 px-6">
          Stack functionality coming soon...
        </Text>
      </View>
    </SafeAreaView>
  );
};

export default StackScreen;
