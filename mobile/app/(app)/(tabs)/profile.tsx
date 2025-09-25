import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { SafeAreaView, Text, View } from "react-native";

const ProfileScreen = () => {
  const { authState: { user } } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1 justify-center items-center">
        <Text className="text-white text-2xl font-bold">Profile</Text>
        <Text className="text-gray-400 text-center mt-4 px-6">
          Welcome, {user?.email || "User"}!
        </Text>
        <Text className="text-gray-500 text-center mt-2 px-6">
          Profile functionality coming soon...
        </Text>
      </View>
    </SafeAreaView>
  );
};

export default ProfileScreen; 