import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  SafeAreaView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type ORBGridLayout = "2x2" | "1x1";

interface ORBMenuProps {
  visible: boolean;
  onClose: () => void;
  gridLayout: ORBGridLayout;
  onGridLayoutChange: (layout: ORBGridLayout) => void;
  onAddTicker: () => void;
  onViewWatchlists: () => void;
  onViewLogs: () => void;
  onToggleMockData: () => void;
  onToggleCalculationMockData: () => void;
  onToggleService: () => void;
  isMockDataEnabled: boolean;
  isCalculationMockDataEnabled: boolean;
  isServiceRunning: boolean;
}

export const ORBMenu: React.FC<ORBMenuProps> = ({
  visible,
  onClose,
  gridLayout,
  onGridLayoutChange,
  onAddTicker,
  onViewWatchlists,
  onViewLogs,
  onToggleMockData,
  onToggleCalculationMockData,
  onToggleService,
  isMockDataEnabled,
  isCalculationMockDataEnabled,
  isServiceRunning,
}) => {
  const menuItems = [
    {
      id: 'addTicker',
      label: 'Add Ticker to ORB',
      icon: 'add-circle-outline' as const,
      onPress: () => {
        onAddTicker();
        onClose();
      },
      showDivider: true,
    },
    {
      id: 'watchlists',
      label: 'View Watchlists',
      icon: 'layers-outline' as const,
      onPress: () => {
        onViewWatchlists();
        onClose();
      },
      showDivider: true,
    },
    {
      id: 'logs',
      label: 'View Logs',
      icon: 'document-text-outline' as const,
      onPress: () => {
        onViewLogs();
        onClose();
      },
      showDivider: true,
    },
    {
      id: 'mockData',
      label: isMockDataEnabled ? 'Hide Mock Data' : 'Show Mock Data',
      icon: isMockDataEnabled ? 'eye-off-outline' : 'eye-outline' as const,
      onPress: () => {
        onToggleMockData();
        onClose();
      },
      showDivider: true,
    },
    {
      id: 'calculationMockData',
      label: isCalculationMockDataEnabled ? 'Hide Calculation Mock Data' : 'Show Calculation Mock Data',
      icon: isCalculationMockDataEnabled ? 'calculator-outline' : 'calculator' as const,
      onPress: () => {
        onToggleCalculationMockData();
        onClose();
      },
      showDivider: true,
    },
    {
      id: 'service',
      label: isServiceRunning ? 'Stop Service' : 'Start Service',
      icon: isServiceRunning ? 'stop-circle-outline' : 'play-circle-outline' as const,
      onPress: () => {
        onToggleService();
        onClose();
      },
      showDivider: false,
      danger: isServiceRunning,
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        className="flex-1 bg-black/50 justify-end"
      >
        <View
          className="bg-gray-900 rounded-t-3xl border-t border-gray-800"
          style={{ paddingBottom: 40 }}
        >
          <SafeAreaView>
            {/* Handle Bar */}
            <View className="items-center py-3">
              <View className="w-12 h-1 bg-gray-600 rounded-full" />
            </View>

            {/* Quick settings: Card layout */}
            <View className="px-4 mb-2">
              <Text className="text-gray-400 text-xs font-medium uppercase tracking-wider px-2 py-2">
                Card layout
              </Text>
              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={() => {
                    onGridLayoutChange("2x2");
                  }}
                  className="flex-1 flex-row items-center py-3 px-4 rounded-xl bg-gray-800/50 border border-gray-700/50 active:opacity-80"
                  style={{ borderColor: gridLayout === "2x2" ? "#10B981" : undefined }}
                >
                  <Ionicons
                    name="grid-outline"
                    size={20}
                    color={gridLayout === "2x2" ? "#10B981" : "#9CA3AF"}
                  />
                  <Text
                    className={`ml-2 text-sm font-medium ${
                      gridLayout === "2x2" ? "text-green-400" : "text-gray-400"
                    }`}
                  >
                    2×2
                  </Text>
                  {gridLayout === "2x2" && (
                    <View style={{ marginLeft: "auto" }}>
                      <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    onGridLayoutChange("1x1");
                  }}
                  className="flex-1 flex-row items-center py-3 px-4 rounded-xl bg-gray-800/50 border border-gray-700/50 active:opacity-80"
                  style={{ borderColor: gridLayout === "1x1" ? "#10B981" : undefined }}
                >
                  <Ionicons
                    name="list-outline"
                    size={20}
                    color={gridLayout === "1x1" ? "#10B981" : "#9CA3AF"}
                  />
                  <Text
                    className={`ml-2 text-sm font-medium ${
                      gridLayout === "1x1" ? "text-green-400" : "text-gray-400"
                    }`}
                  >
                    1×1
                  </Text>
                  {gridLayout === "1x1" && (
                    <View style={{ marginLeft: "auto" }}>
                      <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Menu Items */}
            <View className="px-4">
              {menuItems.map((item, index) => (
                <View key={item.id}>
                  <TouchableOpacity
                    onPress={item.onPress}
                    className="flex-row items-center py-4 active:opacity-70"
                  >
                    <View
                      className={`w-10 h-10 rounded-full items-center justify-center mr-4 ${
                        item.danger
                          ? 'bg-red-500/20'
                          : 'bg-gray-800/50'
                      }`}
                    >
                      <Ionicons
                        //@ts-ignore
                        name={item.icon}
                        size={22}
                        color={item.danger ? '#EF4444' : '#FFFFFF'}
                      />
                    </View>
                    <Text
                      className={`text-base font-medium flex-1 ${
                        item.danger ? 'text-red-400' : 'text-white'
                      }`}
                    >
                      {item.label}
                    </Text>
                    {item.id === 'mockData' && (
                      <View
                        className={`w-5 h-5 rounded-full border-2 mr-2 ${
                          isMockDataEnabled
                            ? 'bg-green-500 border-green-500'
                            : 'border-gray-600'
                        }`}
                      >
                        {isMockDataEnabled && (
                          <View className="w-full h-full items-center justify-center">
                            <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                          </View>
                        )}
                      </View>
                    )}
                    {item.id === 'calculationMockData' && (
                      <View
                        className={`w-5 h-5 rounded-full border-2 mr-2 ${
                          isCalculationMockDataEnabled
                            ? 'bg-green-500 border-green-500'
                            : 'border-gray-600'
                        }`}
                      >
                        {isCalculationMockDataEnabled && (
                          <View className="w-full h-full items-center justify-center">
                            <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                          </View>
                        )}
                      </View>
                    )}
                    {item.id === 'service' && (
                      <View className="flex-row items-center mr-2">
                        <View
                          className={`w-2 h-2 rounded-full mr-2 ${
                            isServiceRunning ? 'bg-green-500' : 'bg-gray-600'
                          }`}
                        />
                        <Text className="text-gray-400 text-sm">
                          {isServiceRunning ? 'Running' : 'Stopped'}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  {item.showDivider && (
                    <View className="h-px bg-gray-800 ml-14" />
                  )}
                </View>
              ))}
            </View>

            {/* Cancel Button */}
            <TouchableOpacity
              onPress={onClose}
              className="mx-4 mt-4 py-4 bg-gray-800/50 rounded-xl items-center active:opacity-70"
            >
              <Text className="text-white text-base font-semibold">Cancel</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

