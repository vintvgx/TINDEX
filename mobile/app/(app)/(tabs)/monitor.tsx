import React, { Component, useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, SafeAreaView, TouchableOpacity, ScrollView } from 'react-native';
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

class ORBErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <ScrollView style={{ flex: 1, backgroundColor: '#0a0a0a', padding: 20 }}>
          <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700', marginTop: 60 }}>ORB Crash Caught</Text>
          <Text style={{ color: '#f1f5f9', fontSize: 13, marginTop: 12, fontFamily: 'monospace' }}>{err.message}</Text>
          <Text style={{ color: '#94a3b8', fontSize: 10, marginTop: 12, fontFamily: 'monospace' }}>{err.stack}</Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const ORB_GRID_LAYOUT_KEY = '@alethia/orb_grid_layout';

const ORBScreen = () => {
  console.log('[ORB] render start');

  console.log('[ORB] calling useThemeColors');
  const colors = useThemeColors();
  console.log('[ORB] useThemeColors OK');

  console.log('[ORB] calling useState x6');
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
  console.log('[ORB] useState OK');

  console.log('[ORB] calling useToast');
  const toast = useToast();
  console.log('[ORB] useToast OK');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(ORB_GRID_LAYOUT_KEY);
        if (mounted && (saved === '2x2' || saved === '1x1')) setGridLayout(saved);
      } catch (e) {
        console.error('[ORB] SecureStore read error:', e);
      }
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

  console.log('[ORB] calling useORBMonitoringState');
  const { data: orbData, isLoading: orbLoading } = useORBMonitoringState(useMockData, useCalculationMockData);
  console.log('[ORB] useORBMonitoringState OK — orbData length:', orbData?.length ?? 'undefined');

  console.log('[ORB] calling useORBRanges');
  const { rangesByTicker } = useORBRanges(useMockData || useCalculationMockData);
  console.log('[ORB] useORBRanges OK');

  console.log('[ORB] calling useServicesStatus');
  const { data: servicesStatus } = useServicesStatus();
  console.log('[ORB] useServicesStatus OK');
  const isORBRunning       = servicesStatus?.orb?.running ?? false;
  const isContractsRunning = servicesStatus?.contracts?.running ?? false;
  const anyServiceRunning    = isORBRunning || isContractsRunning;

  const orbTickers = useMemo(
    () => (orbData ?? []).map(item => item.ticker),
    [orbData],
  );

  console.log('[ORB] calling useMarketStream, tickers:', orbTickers.length);
  const { livePrices, vix, spy, sentiment, connected } = useMarketStream(orbTickers);
  console.log('[ORB] useMarketStream OK');

  console.log('[ORB] calling useORBFlowSummaries');
  const flowSummaries = useORBFlowSummaries(orbTickers);
  console.log('[ORB] useORBFlowSummaries OK');

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

  console.log('[ORB] calling useStartServices / useStopServices');
  const startServices = useStartServices();
  const stopServices  = useStopServices();
  console.log('[ORB] services mutations OK');

  console.log('[ORB] calling useBaseNavigation');
  const { toTicker }  = useBaseNavigation();
  console.log('[ORB] useBaseNavigation OK');

  console.log('[ORB] hooks complete — entering render');

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
      {/* No page title here — the "Monitor" segment pill above already names
          this page (see orb.tsx's SegmentedPager). Keep the overflow menu. */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
        }}
      >
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

export default function ORBScreenWithBoundary() {
  return (
    <ORBErrorBoundary>
      <ORBScreen />
    </ORBErrorBoundary>
  );
}
