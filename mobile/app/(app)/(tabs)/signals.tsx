import React, { useState } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useSocialSignalContracts } from '@/hooks/queries/social/useSocialSignalContracts';
import { useSocialSignalsSocket } from '@/hooks/queries/social/useSocialSignalsSocket';
import { useRemoveSocialSignalContract } from '@/hooks/mutations/social/useRemoveSocialSignalContract';
import { FollowedAccountsSection } from '@/common/components/social/FollowedAccountsSection';
import { XApiUsageBadge } from '@/common/components/social/XApiUsageBadge';
import { SignalCard } from '@/common/components/social/SignalCard';
import { SignalEnterSheet } from '@/common/components/social/SignalEnterSheet';
import type { SocialSignalContract } from '@/common/types/social';

interface Props {
  /** True when rendered as a SegmentedPager scene (ORB tab, between Strategy
   *  and Trade Log) — hides the back arrow and redundant title (the segment
   *  pill above already names it), matching StrategyScreen/TradeLogScreen. */
  embedded?: boolean;
}

export default function SignalsScreen({ embedded = false }: Props) {
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);
  const [enterContract, setEnterContract] = useState<SocialSignalContract | null>(null);

  const { data: contracts, isLoading, refetch } = useSocialSignalContracts();
  const { prices, connected } = useSocialSignalsSocket();
  const removeContract = useRemoveSocialSignalContract();

  const trackingCards = (contracts ?? []).filter(c => c.status === 'tracking');

  const handleRefresh = async () => {
    console.log('[SignalsScreen] pull-to-refresh: start');
    setRefreshing(true);
    try {
      const result = await refetch();
      console.log('[SignalsScreen] pull-to-refresh: done',
        result.isError ? `error=${result.error}` : `rows=${result.data?.length ?? 0}`);
    } catch (e) {
      console.error('[SignalsScreen] pull-to-refresh: threw', e);
    } finally {
      setRefreshing(false);
      console.log('[SignalsScreen] pull-to-refresh: refreshing=false');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {!embedded && (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Signals</Text>
          <View style={{ width: 22 }} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
      >
        <XApiUsageBadge colors={colors} />

        <FollowedAccountsSection colors={colors} />

        <View>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Tracked Contracts {trackingCards.length > 0 ? `(${trackingCards.length})` : ''}
            </Text>
            <View style={styles.liveDotRow}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: connected ? colors.success : colors.tabBarInactive }} />
              <Text style={{ color: colors.tabBarInactive, fontSize: 11 }}>{connected ? 'Live' : 'Offline'}</Text>
            </View>
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : trackingCards.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="pulse-outline" size={32} color={colors.tabBarInactive} />
              <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>
                No contracts detected yet. Follow an account above and wait for a matching tweet.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {trackingCards.map(c => (
                <SignalCard
                  key={c.id}
                  contract={c}
                  livePrice={prices[c.contract_symbol]}
                  colors={colors}
                  onEnter={() => setEnterContract(c)}
                  onRemove={() => removeContract.mutate(c.id)}
                />
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>

      <SignalEnterSheet
        contract={enterContract}
        livePrice={enterContract ? prices[enterContract.contract_symbol] : undefined}
        colors={colors}
        visible={!!enterContract}
        onClose={() => setEnterContract(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 20 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  liveDotRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 10, paddingHorizontal: 24 },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
