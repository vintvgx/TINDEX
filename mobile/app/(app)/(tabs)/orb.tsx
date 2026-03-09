import { View, Text, SafeAreaView, TouchableOpacity } from "react-native";
import { useState, useMemo, useEffect, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import { useORBMonitoringState, ORBMonitoringState } from "@/hooks/queries/orb/useORBMonitoringState";
import { useORBRanges } from "@/hooks/queries/orb/useORBRanges";
import { ORBCardGrid } from "@/common/components/orb/ORBCardGrid";
import { ORBDetailModal } from "@/common/components/orb/ORBDetailModal";
import { WatchlistsModal } from "@/common/components/watchlist/WatchlistsModal";
import { ORBMenu, type ORBGridLayout } from "@/common/components/orb/ORBMenu";
import { LogViewerModal } from "@/common/components/orb/LogViewerModal";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";
import { useORBStatus } from "@/hooks/queries/orb/useORBStatus";
import { useStartORBMutation, useStopORBMutation } from "@/hooks/mutations/orb/useORBControl";

const ORB_GRID_LAYOUT_KEY = "@alethia/orb_grid_layout";

const ORBScreen = () => {
  const [watchlistsModalVisible, setWatchlistsModalVisible] = useState(false);
  const [logViewerVisible, setLogViewerVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [useMockData, setUseMockData] = useState(false);
  const [useCalculationMockData, setUseCalculationMockData] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);
  const [gridLayout, setGridLayout] = useState<ORBGridLayout>("1x1");

  // Load saved grid layout from device
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(ORB_GRID_LAYOUT_KEY);
        if (mounted && (saved === "2x2" || saved === "1x1")) setGridLayout(saved);
      } catch {
        // keep default 2x2
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleGridLayoutChange = useCallback(async (layout: ORBGridLayout) => {
    setGridLayout(layout);
    try {
      await SecureStore.setItemAsync(ORB_GRID_LAYOUT_KEY, layout);
    } catch (e) {
      console.warn("Failed to save ORB grid layout:", e);
    }
  }, []);
  
  // Fetch ORB monitoring state with real-time updates
  // useQuery automatically fetches on mount - no need to manually refetch
  const { data: orbData, isLoading: orbLoading } = useORBMonitoringState(useMockData, useCalculationMockData);
  // Fetch today's orb_ranges for gap/trend badges; use mock ranges with examples when mock mode is on
  const { rangesByTicker } = useORBRanges(useMockData || useCalculationMockData);
  
  // Fetch ORB service status
  const { data: orbStatus } = useORBStatus();
  const isORBRunning = orbStatus?.running ?? false;
  const isCalculationPhase = orbStatus?.calculation_phase ?? false;

  // Transform data: only show monitoring_active tickers; set breakout_type to "Offline" when service is not running
  const transformedORBData = useMemo(() => {
    if (!orbData) return [];
    const activeOnly = orbData.filter((item) => item.monitoring_active);
    if (!isORBRunning) {
      return activeOnly.map((item) => ({
        ...item,
        breakout_type: 'Offline' as const,
      }));
    }
    return activeOnly;
  }, [orbData, isORBRunning]);

  // Update last fetch time when data changes
  useEffect(() => {
    if (orbData !== undefined && !orbLoading) {
      setLastFetchTime(new Date());
    }
  }, [orbData, orbLoading]);
  
  // Get current data for selected ticker - this will update automatically when transformedORBData changes
  const selectedORBData = useMemo(() => {
    if (!selectedTicker || !transformedORBData) return null;
    return transformedORBData.find(item => item.ticker === selectedTicker) || null;
  }, [selectedTicker, transformedORBData]);

  // Service control mutations
  const startMutation = useStartORBMutation();
  const stopMutation = useStopORBMutation();

  // Navigate to selected ticker
  const { toTicker } = useBaseNavigation();
  
  const handleCardPress = (data: ORBMonitoringState) => {
    setSelectedTicker(data.ticker);
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
          data={transformedORBData || []} 
          isLoading={orbLoading} 
          onCardPress={handleCardPress}
          lastFetchTime={lastFetchTime}
          rangesByTicker={rangesByTicker}
          gridLayout={gridLayout}
        />
      </View>

      {/* ORB Detail Modal */}
      <ORBDetailModal
        visible={detailModalVisible}
        data={selectedORBData}
        onClose={() => {
          setDetailModalVisible(false);
          setSelectedTicker(null);
        }}
        onNavigateToTicker={handleNavigateToTicker}
        gapTrendContext={selectedTicker ? rangesByTicker[selectedTicker] : null}
      />

      {/* ORB Menu */}
      <ORBMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        gridLayout={gridLayout}
        onGridLayoutChange={handleGridLayoutChange}
        onViewWatchlists={() => setWatchlistsModalVisible(true)}
        onViewLogs={() => setLogViewerVisible(true)}
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

      {/* Log Viewer Modal */}
      <LogViewerModal
        visible={logViewerVisible}
        onClose={() => setLogViewerVisible(false)}
      />
    </SafeAreaView>
  );
};

export default ORBScreen;

