import { useState } from "react";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { SafeAreaView, Text, View, Pressable } from "react-native";
import { ORBAdminModal } from "@/common/components/admin/ORBAdminModal";

const ProfileScreen = () => {
  const { authState: { user } } = useAuth();
  const [adminModalVisible, setAdminModalVisible] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Header with ADMIN button */}
      <View className="flex-row justify-between items-center px-6 pt-4 pb-2">
        <Text className="text-white text-2xl font-bold">Profile</Text>
        <Pressable
          onPress={() => setAdminModalVisible(true)}
          className="bg-blue-600 px-4 py-2 rounded-lg">
          <Text className="text-white font-semibold">ADMIN</Text>
        </Pressable>
      </View>

      <View className="flex-1 justify-center items-center">
        <Text className="text-gray-400 text-center mt-4 px-6">
          Welcome, {user?.email || "User"}!
        </Text>
        <Text className="text-gray-500 text-center mt-2 px-6">
          Profile functionality coming soon...
        </Text>
      </View>

      {/* ORB Admin Modal */}
      <ORBAdminModal
        visible={adminModalVisible}
        onClose={() => setAdminModalVisible(false)}
      />
    </SafeAreaView>
  );
};

export default ProfileScreen; 