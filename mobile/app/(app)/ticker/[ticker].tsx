import type React from 'react';
import { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StatusBar,
  ActivityIndicator,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { SummaryTab } from '@/common/components/ticker/SummaryTab';
import { AnalyticsTab } from '@/common/components/ticker/AnalyticsTab';
import { FinancialsTab } from '@/common/components/ticker/FinancialsTab';
import { StockInfoHeader } from '@/common/components/ticker/StockInfoHeader';
import { TabNavigation } from '@/common/components/ticker/TabNavigation';
import { OptionsList } from '@/common/components/ticker/OptionsList';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { UpdatesTab } from '@/common/components/ticker/UpdatesTab';
import { useIsFollowingORB, useToggleORBFollow } from '@/hooks/mutations/ticker/tickerORB';
import { useGenerateTickerUpdateMutation } from '@/hooks/mutations/ticker/useGenerateTickerUpdateMutation';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useThemeColors } from '@/lib/useColorScheme';

export default function TickerScreen() {
  const colors = useThemeColors();
  const { ticker } = useLocalSearchParams<{ ticker: string }>();

  const { data: tickerResponse, isLoading, error, refetch, isRefetching } = useTickerQuery(ticker || '');
  const { data: isFollowingORB, isLoading: isfollowORBLoading } = useIsFollowingORB(ticker);
  const followORB = useToggleORBFollow(ticker);

  const [activeTab, setActiveTab] = useState<'Summary' | 'Analytics' | 'Financials' | 'Options' | 'Updates'>('Summary');
  const [selectedPeriod, setSelectedPeriod] = useState('1D');

  const { authState: { user } } = useAuth();
  const generateTickerUpdate = useGenerateTickerUpdateMutation();
  const { data: trackedContracts = [] } = useTrackedContracts();
  const trackContract = useTrackContract();

  const trackedContractSymbols = useMemo(() => new Set(trackedContracts.map((c) => c.contract_symbol)), [trackedContracts]);

  const stockData = tickerResponse?.data;
  const { navigateBack } = useBaseNavigation();

  const handleORBState = () => followORB.mutate(!isFollowingORB?.orb_enabled);

  const handleGenerateTweet = () => {
    if (!user?.id || !ticker) return;
    generateTickerUpdate.mutate({ ticker, userId: user.id, targetLength: 500 });
  };

  const handleTrackContract = async (contract: any) => {
    if (!user?.id) { Alert.alert('Error', 'User must be authenticated to track contracts'); return; }
    try {
      await trackContract.mutateAsync({
        userId: user.id,
        ticker: ticker || '',
        contractSymbol: contract.contractSymbol,
        optionType: contract.optionType,
        strike: contract.strike,
        expirationDate: contract.expirationDate,
        trackingSnapshot: contract,
        trackedFromSource: 'manual',
      });
    } catch (error) {
      setTimeout(() => Alert.alert('Error', error instanceof Error ? error.message : 'Failed to track contract'), 100);
    }
  };

  const iconButtonStyle = {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.iconButton,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.iconButtonBorder,
  };

  if (isLoading || isRefetching) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ marginTop: 12, fontSize: 15, color: colors.textSecondary, fontWeight: '500' }}>
            Loading {ticker}…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !stockData) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={{ marginTop: 16, fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 8 }}>
            Error Loading Ticker
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24 }}>
            {error instanceof Error ? error.message : 'Something went wrong'}
          </Text>
          <Pressable
            onPress={navigateBack}
            style={{ backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const renderSummaryTab = () => (
    <ScrollView style={{ flex: 1, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24, paddingTop: 20 }}>
      <SummaryTab stockData={stockData} selectedPeriod={selectedPeriod} onPeriodChange={setSelectedPeriod} />
    </ScrollView>
  );

  const renderAnalyticsTab = () => (
    <ScrollView style={{ flex: 1, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24, paddingTop: 20 }}>
      <AnalyticsTab stockData={stockData} />
    </ScrollView>
  );

  const renderFinancialsTab = () => (
    <ScrollView style={{ flex: 1, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24, paddingTop: 20 }}>
      <FinancialsTab stockData={stockData} />
    </ScrollView>
  );

  const renderOptionsTab = () => {
    const optionsData = stockData?.options_analysis;
    if (!optionsData?.has_opportunities || !optionsData?.opportunities?.length) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
            <Ionicons name="analytics-outline" size={40} color={colors.textTertiary} />
            <Text style={{ marginTop: 14, fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 8 }}>No Options Available</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
              {stockData?.has_options === false ? 'This ticker does not have options trading available.' : 'No options opportunities found at this time.'}
            </Text>
          </View>
        </View>
      );
    }
    return (
      <View style={{ flex: 1 }}>
        <OptionsList
          opportunities={optionsData.opportunities}
          ticker={ticker || ''}
          currentPrice={stockData?.current_price || 0}
          trackedContractSymbols={trackedContractSymbols}
          onTrackContract={handleTrackContract}
          isTracking={trackContract.isPending}
        />
      </View>
    );
  };

  const renderTweetsTab = () => {
    if (!ticker) return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: colors.textSecondary }}>No ticker selected</Text>
      </View>
    );
    return <UpdatesTab ticker={ticker} />;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle={colors.background === '#FFFFFF' ? 'dark-content' : 'light-content'} />

      {/* Header */}
      <View
        style={{
          backgroundColor: colors.background,
          paddingTop: 8,
          paddingBottom: 12,
          paddingHorizontal: 20,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          {/* Back button */}
          <Pressable onPress={navigateBack} style={iconButtonStyle}>
            <Ionicons name="arrow-back" size={18} color={colors.text} />
          </Pressable>

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {activeTab === 'Updates' && (
              <Pressable
                style={iconButtonStyle}
                onPress={handleGenerateTweet}
                disabled={generateTickerUpdate.isPending || !user?.id}
              >
                {generateTickerUpdate.isPending ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons name="create-outline" size={18} color={!user?.id ? colors.textTertiary : colors.accent} />
                )}
              </Pressable>
            )}
            <Pressable style={iconButtonStyle} onPress={() => refetch()} disabled={isLoading}>
              <Ionicons name="refresh-outline" size={18} color={isLoading ? colors.textTertiary : colors.accent} />
            </Pressable>
            <Pressable style={iconButtonStyle} onPress={handleORBState} disabled={isfollowORBLoading}>
              <Ionicons
                name={isFollowingORB?.orb_enabled ? 'remove-circle-outline' : 'add-circle-outline'}
                size={18}
                color={isFollowingORB?.orb_enabled ? colors.error : colors.success}
              />
            </Pressable>
          </View>
        </View>

        <StockInfoHeader stockData={stockData} />
        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'Summary' && renderSummaryTab()}
        {activeTab === 'Analytics' && renderAnalyticsTab()}
        {activeTab === 'Financials' && renderFinancialsTab()}
        {activeTab === 'Options' && renderOptionsTab()}
        {activeTab === 'Updates' && renderTweetsTab()}
      </View>
    </SafeAreaView>
  );
}
