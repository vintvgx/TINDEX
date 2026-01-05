import { View, Text, SafeAreaView, TouchableOpacity } from "react-native";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useORBMonitoringState, ORBMonitoringState } from "@/hooks/queries/orb/useORBMonitoringState";
import { ORBCardGrid } from "@/common/components/orb/ORBCardGrid";
import { ORBDetailModal } from "@/common/components/orb/ORBDetailModal";
import { WatchlistsModal } from "@/common/components/watchlist/WatchlistsModal";
import { ORBMenu } from "@/common/components/orb/ORBMenu";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";
import { useORBStatus } from "@/hooks/queries/orb/useORBStatus";
import { useStartORBMutation, useStopORBMutation } from "@/hooks/mutations/orb/useORBControl";

const ORBScreen = () => {
  const [watchlistsModalVisible, setWatchlistsModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [useMockData, setUseMockData] = useState(false);
  const [useCalculationMockData, setUseCalculationMockData] = useState(false);
  const [selectedORBData, setSelectedORBData] = useState<ORBMonitoringState | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  
  // Fetch ORB monitoring state with real-time updates
  const { data: orbData, isLoading: orbLoading } = useORBMonitoringState(useMockData, useCalculationMockData);
  
  // Fetch ORB service status
  const { data: orbStatus } = useORBStatus();
  const isORBRunning = orbStatus?.running ?? false;
  const isCalculationPhase = orbStatus?.calculation_phase ?? false;

  // Service control mutations
  const startMutation = useStartORBMutation();
  const stopMutation = useStopORBMutation();

  // Navigate to selected ticker
  const { toTicker } = useBaseNavigation();
  
  const handleCardPress = (data: ORBMonitoringState) => {
    setSelectedORBData(data);
    setDetailModalVisible(true);
  };

  const handleNavigateToTicker = (ticker: string) => {
    toTicker(ticker);
  };

  const handleToggleMockData = () => {
    setUseMockData(!useMockData);
    // Disable calculation mock data when enabling regular mock data
    if (!useMockData) {
      setUseCalculationMockData(false);
    }
  };

  const handleToggleCalculationMockData = () => {
    setUseCalculationMockData(!useCalculationMockData);
    // Disable regular mock data when enabling calculation mock data
    if (!useCalculationMockData) {
      setUseMockData(false);
    }
  };

  const handleToggleService = () => {
    if (isORBRunning) {
      stopMutation.mutate();
    } else {
      startMutation.mutate(false); // false = not debug mode
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Subtle background gradient matching feed screen */}
      <View 
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.1)',
        }}
      />

      {/* Header */}
      <View className="px-6 py-4 border-b border-gray-800 flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <Text className="text-white text-3xl font-bold">ORB</Text>
          {/* ORB Status Indicator */}
          <View className="flex-row items-center gap-2">
            <View 
              className={`w-2.5 h-2.5 rounded-full ${
                isORBRunning ? 'bg-[#10B981]' : 'bg-[#EF4444]'
              }`} 
            />
            <Text className="text-gray-400 text-xs">
              {isORBRunning 
                ? (isCalculationPhase ? 'Calculation' : 'Running')
                : 'Inactive'}
            </Text>
          </View>
        </View>
        
        {/* Menu Button */}
        <TouchableOpacity
          onPress={() => setMenuVisible(true)}
          className="w-10 h-10 items-center justify-center"
        >
          <Ionicons name="ellipsis-horizontal" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* ORB Card Grid */}
      <View className="flex-1">
        <ORBCardGrid 
          data={orbData || []} 
          isLoading={orbLoading} 
          onCardPress={handleCardPress} 
        />
      </View>

      {/* ORB Detail Modal */}
      <ORBDetailModal
        visible={detailModalVisible}
        data={selectedORBData}
        onClose={() => {
          setDetailModalVisible(false);
          setSelectedORBData(null);
        }}
        onNavigateToTicker={handleNavigateToTicker}
      />

      {/* ORB Menu */}
      <ORBMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onViewWatchlists={() => setWatchlistsModalVisible(true)}
        onToggleMockData={handleToggleMockData}
        onToggleCalculationMockData={handleToggleCalculationMockData}
        onToggleService={handleToggleService}
        isMockDataEnabled={useMockData}
        isCalculationMockDataEnabled={useCalculationMockData}
        isServiceRunning={isORBRunning}
      />

      {/* Watchlists Modal */}
      <WatchlistsModal
        visible={watchlistsModalVisible}
        onClose={() => setWatchlistsModalVisible(false)}
      />
    </SafeAreaView>
  );
};

export default ORBScreen;

