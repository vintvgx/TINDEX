import { useState } from "react";
import { View, Text, SafeAreaView, Modal, StatusBar } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import SearchScreen from "./search";

/**
 * Track Screen - Displays tracked options data
 * 
 * This screen shows options tracking information and provides access to search
 * functionality via a modal. The search modal displays the full SearchScreen
 * component for ticker discovery.
 */
const TrackScreen = () => {
  const [searchModalVisible, setSearchModalVisible] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Subtle background gradient matching other screens */}
      <View 
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.1)',
        }}
      />

      {/* Header */}
      <View className="px-6 py-4 border-b border-gray-800 flex-row items-center justify-between">
        <Text className="text-white text-3xl font-bold">Track</Text>
        
        {/* Search Button */}
        <TouchableOpacity
          onPress={() => setSearchModalVisible(true)}
          className="w-10 h-10 items-center justify-center"
        >
          <Ionicons name="search" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-gray-400 text-lg text-center">
          Tracked Options will be displayed here
        </Text>
      </View>

      {/* Search Modal */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSearchModalVisible(false)}

      >
        <StatusBar barStyle="light-content" />
        <View className="flex-1 bg-black">
          {/* Close button overlay - positioned absolutely on top */}
          <SafeAreaView className="absolute top-0 left-0 right-0 z-10">
            <View className="px-4 py-2 flex-row items-center justify-end">
              <TouchableOpacity
                onPress={() => setSearchModalVisible(false)}
                className="w-10 h-10 items-center justify-center bg-black/50 rounded-full"
              >
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
          <SearchScreen />
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default TrackScreen;
