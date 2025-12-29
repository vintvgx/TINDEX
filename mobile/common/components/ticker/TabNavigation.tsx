/**
 * Handler used to switch between tabs within [ticker].tsx
 */

import type React from "react";
import { View, Text, Pressable } from "react-native";

type TabType = "Summary" | "Analytics" | "Financials" | "Options" | "Updates";

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
}) => {
  const tabs: TabType[] = ["Summary", "Analytics", "Financials", "Options", "Updates"];

  const renderTabButton = (tab: TabType) => (
    <Pressable
      key={tab}
      onPress={() => onTabChange(tab)}
      className={`px-4 py-2 ${activeTab === tab ? "border-b-2 border-blue-400" : ""}`}>
      <Text
        className={`text-lg font-medium ${activeTab === tab ? "text-white" : "text-gray-400"}`}>
        {tab}
      </Text>
    </Pressable>
  );

  return (
    <View className="flex-row justify-around border-b border-gray-700/50">
      {tabs.map(renderTabButton)}
    </View>
  );
};
