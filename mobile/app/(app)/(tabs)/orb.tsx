import { View, Text, SafeAreaView, TouchableOpacity } from 'react-native';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useMarketStream } from '@/hooks/useMarketStream';
import { MarketPulseStrip } from '@/common/components/orb/MarketPulseStrip';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useORBMonitoringState, ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { useORBRanges } from '@/hooks/queries/orb/useORBRanges';
import { useORBFlowSummaries } from '@/hooks/queries/flow/useORBFlowSummaries';
import { ORBCardGrid } from '@/common/components/orb/ORBCardGrid';
import { ORBDetailModal } from '@/common/components/orb/ORBDetailModal';
import { WatchlistsModal } from '@/common/components/watchlist/WatchlistsModal';
import { ORBMenu, type ORBGridLayout } from '@/common/components/orb/ORBMenu';
import { AddORBTickerSheet } from '@/common/components/orb/AddORBTickerSheet';
import { LogViewerModal } from '@/common/components/orb/LogViewerModal';
import useBaseNavigation from '@/hooks/navigation/useBaseNavigation';
import { useServicesStatus } from '@/hooks/queries/services/useServicesStatus';
import { useStartServices, useStopServices } from '@/hooks/mutations/services/useServicesControl';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';

const ORB_GRID_LAYOUT_KEY = '@alethia/orb_grid_layout';

const ORBScreen = () => {
  const colors = useThemeColors();
  const [watchlistsModalVisible, setWatchlistsModalVisible] = useState(false);
  const [logViewerVisible, setLogViewerVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [addTickerSheetVisible, setAddTickerSheetVisible] = useState(false);
  const [useMockData, setUseMockData] = useState(false);
  const [useCalculationMockData, setUseCalculationMockData] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);
  const [gridLayout, setGridLayout] = useState<ORBGridLayout>('1x1');
  const toast = useToast();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(ORB_GRID_LAYOUT_KEY);
        if (mounted && (saved === '2x2' || saved === '1x1')) setGridLayout(saved);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  const handleGridLayoutChange = useCallback(async (layout: ORBGridLayout) => {
    setGridLayout(layout);
    try {
      await SecureStore.setItemAsync(ORB_GRID_LAYOUT_KEY, layout);
    } catch (e) {
      console.warn('Failed to save ORB grid layout:', e);
    }
  }, []);

  const { data: orbData, isLoading: orbLoading } = useORBMonitoringState(useMockData, useCalculationMockData);
  const { rangesByTicker } = useORBRanges(useMockData || useCalculationMockData);

  // Unified service status — shared cache with Options screen (React Query deduplicates)
  const { data: servicesStatus } = useServicesStatus();
  const isORBRunning       = servicesStatus?.orb?.running ?? false;
  const isContractsRunning = servicesStatus?.contracts?.running ?? false;
  const anyServiceRunning    = isORBRunning || isContractsRunning;

  // Extract tickers for live price streaming
  const orbTickers = useMemo(
    () => (orbData ?? []).map(item => item.ticker),
    [orbData],
  );

  const { livePrices, vix, spy, sentiment, connected } = useMarketStream(orbTickers);
  const flowSummaries = useORBFlowSummaries(orbTickers);

  const transformedORBData = useMemo(() => {
    if (!orbData) return [];
    const activeOnly = orbData.filter((item) => item.monitoring_active);
    if (!isORBRunning) return activeOnly.map((item) => ({ ...item, breakout_type: 'Offline' as const }));
    return activeOnly;
  }, [orbData, isORBRunning]);

  useEffect(() => {
    if (orbData !== undefined && !orbLoading) setLastFetchTime(new Date());
  }, [orbData, orbLoading]);

  const selectedORBData = useMemo(() => {
    if (!selectedTicker || !transformedORBData) return null;
    return transformedORBData.find((item) => item.ticker === selectedTicker) || null;
  }, [selectedTicker, transformedORBData]);

  const startServices = useStartServices();
  const stopServices  = useStopServices();
  const { toTicker }  = useBaseNavigation();

  const handleCardPress = (data: ORBMonitoringState) => {
    setSelectedTicker(data.ticker);
    setDetailModalVisible(true);
  };

  const handleNavigateToTicker = (ticker: string) => toTicker(ticker);

  const handleToggleMockData = () => {
    setUseMockData(!useMockData);
    if (!useMockData) setUseCalculationMockData(false);
  };

  const handleToggleCalculationMockData = () => {
    setUseCalculationMockData(!useCalculationMockData);
    if (!useCalculationMockData) setUseMockData(false);
  };

  // Start or stop ALL registered services together
  const handleToggleService = useCallback(() => {
    if (anyServiceRunning) {
      stopServices.mutate({}, {
        onSuccess: () => toast.success('All services stopped'),
        onError: (err: Error) => toast.error(`Stop failed: ${err.message}`),
      });
    } else {
      startServices.mutate({}, {
        onSuccess: () => toast.success('All services started'),
        onError: (err: Error) => toast.error(`Start failed: ${err.message}`),
      });
    }
  }, [anyServiceRunning, startServices, stopServices, toast]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ── Header ── */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 }}>
          ORB
        </Text>

        <TouchableOpacity
          onPress={() => setMenuVisible(true)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.iconButton,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors.iconButtonBorder,
            marginBottom: 2,
          }}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* ── Market Pulse: VIX · Sentiment · Flow ── */}
      <MarketPulseStrip
        vix={vix}
        spy={spy}
        sentiment={sentiment}
        orbData={transformedORBData}
        livePrices={livePrices}
        connected={connected}
      />

      {/* ── ORB Card Grid ── */}
      <View style={{ flex: 1 }}>
        <ORBCardGrid
          data={transformedORBData || []}
          isLoading={orbLoading}
          onCardPress={handleCardPress}
          lastFetchTime={lastFetchTime}
          rangesByTicker={rangesByTicker}
          gridLayout={gridLayout}
          livePrices={livePrices}
          flowSummaries={flowSummaries}
        />
      </View>

      <ORBDetailModal
        visible={detailModalVisible}
        data={selectedORBData}
        onClose={() => { setDetailModalVisible(false); setSelectedTicker(null); }}
        onNavigateToTicker={handleNavigateToTicker}
        gapTrendContext={selectedTicker ? rangesByTicker[selectedTicker] : null}
      />

      <ORBMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        gridLayout={gridLayout}
        onGridLayoutChange={handleGridLayoutChange}
        onAddTicker={() => setAddTickerSheetVisible(true)}
        onViewWatchlists={() => setWatchlistsModalVisible(true)}
        onViewLogs={() => setLogViewerVisible(true)}
        onToggleMockData={handleToggleMockData}
        onToggleCalculationMockData={handleToggleCalculationMockData}
        onToggleService={handleToggleService}
        isMockDataEnabled={useMockData}
        isCalculationMockDataEnabled={useCalculationMockData}
        isORBRunning={isORBRunning}
        isContractsRunning={isContractsRunning}
        isServiceRunning={anyServiceRunning}
      />

      <AddORBTickerSheet
        visible={addTickerSheetVisible}
        onClose={() => setAddTickerSheetVisible(false)}
      />

      <WatchlistsModal
        visible={watchlistsModalVisible}
        onClose={() => setWatchlistsModalVisible(false)}
      />

      <LogViewerModal
        visible={logViewerVisible}
        onClose={() => setLogViewerVisible(false)}
      />
    </SafeAreaView>
  );
};

export default ORBScreen;
