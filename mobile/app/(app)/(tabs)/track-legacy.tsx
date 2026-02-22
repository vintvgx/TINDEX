import { useState } from "react";
import { View, Text, SafeAreaView, TouchableOpacity } from "react-native";
import { TrackedContractsList } from "@/common/components/track/TrackedContractsList";
import { FollowedContractsList } from "@/common/components/track/FollowedContractsList";
import { SearchContractsSection } from "@/common/components/track/SearchContractsSection";

/**
 * !DEPRECATED: FILE INCLUDES IMPLEMENTATION FOR THE PREVIOUS TRACK SCREEN (displays options + followed options)
 * Track Legacy Screen - Original tracked options implementation
 *
 * Displays options tracking with three tabs (Tracked, Followed, Search).
 * Kept for use elsewhere (e.g. deep links, profile). The main Track tab
 * now shows the calendar-based P&L view.
 */
const TrackLegacyScreen = () => {
  const [activeTab, setActiveTab] = useState<"tracked" | "followed" | "search">("tracked");

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Subtle background gradient matching other screens */}
      <View
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(17, 24, 39, 0.1)",
        }}
      />

      {/* Header */}
      <View className="px-6 py-4 border-b border-gray-800">
        <Text className="text-white text-3xl font-bold">Track (Legacy)</Text>
      </View>

      {/* Tabs */}
      <View className="flex-row px-4 py-3 border-b border-gray-800">
        <TouchableOpacity
          onPress={() => setActiveTab("tracked")}
          className={`flex-1 px-4 py-2.5 rounded-full mr-2 ${
            activeTab === "tracked" ? "bg-gray-700/50" : "bg-gray-800/30"
          }`}
        >
          <Text
            className={`text-center font-semibold ${
              activeTab === "tracked" ? "text-white" : "text-gray-400"
            }`}
          >
            Tracked
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab("followed")}
          className={`flex-1 px-4 py-2.5 rounded-full mr-2 ${
            activeTab === "followed" ? "bg-gray-700/50" : "bg-gray-800/30"
          }`}
        >
          <Text
            className={`text-center font-semibold ${
              activeTab === "followed" ? "text-white" : "text-gray-400"
            }`}
          >
            Followed
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab("search")}
          className={`flex-1 px-4 py-2.5 rounded-full ${
            activeTab === "search" ? "bg-gray-700/50" : "bg-gray-800/30"
          }`}
        >
          <Text
            className={`text-center font-semibold ${
              activeTab === "search" ? "text-white" : "text-gray-400"
            }`}
          >
            Search
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View className="flex-1">
        {activeTab === "tracked" && <TrackedContractsList />}
        {activeTab === "followed" && <FollowedContractsList />}
        {activeTab === "search" && <SearchContractsSection />}
      </View>
    </SafeAreaView>
  );
};

export default TrackLegacyScreen;
