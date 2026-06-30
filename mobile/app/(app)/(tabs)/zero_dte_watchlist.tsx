import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useZeroDTEWatchlist } from '@/hooks/queries/zero_dte/useZeroDTEWatchlist';
import { useRunZeroDTEScan } from '@/hooks/mutations/zero_dte/useRunZeroDTEScan';
import { useEnterZeroDTEPosition } from '@/hooks/mutations/zero_dte/useEnterZeroDTEPosition';
import { ZeroDTECard } from '@/common/components/zero_dte/ZeroDTECard';
import { ZeroDTEEnterModal } from '@/common/components/zero_dte/ZeroDTEEnterModal';
import { TIER_CONFIG } from '@/common/types/zero_dte';
import type { ZeroDTEOpportunity } from '@/common/types/zero_dte';

const SCAN_WINDOWS = ['9:45', '10:30', '11:30', '12:30', '1:30'];

export default function ZeroDTEWatchlistScreen() {
  const { authState: { user } } = useAuth();
  const { data: items = [], isLoading, refetch, isFetching } = useZeroDTEWatchlist();
  const scanMutation   = useRunZeroDTEScan();
  const enterMutation  = useEnterZeroDTEPosition();
  const [enterItem, setEnterItem] = useState<ZeroDTEOpportunity | null>(null);

  const tierCounts = useMemo(() => ({
    FIRE:  items.filter(i => i.tier === 'FIRE').length,
    SET:   items.filter(i => i.tier === 'SET').length,
    WATCH: items.filter(i => i.tier === 'WATCH').length,
  }), [items]);

  const lastScanLabel = useMemo(() => {
    if (!items.length) return null;
    const t = new Date(items[0].scan_time);
    return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [items]);

  const minutesLeft = useMemo(() => {
    if (!items.length) return null;
    return items[0].minutes_remaining;
  }, [items]);

  const handleEnterSubmit = (payload: Parameters<typeof enterMutation.mutate>[0]) => {
    enterMutation.mutate(payload, {
      onSuccess: () => {
        setEnterItem(null);
        Alert.alert(
          'Position opened',
          `${payload.mode === 'live' ? 'Live' : 'Paper'} ${payload.contract_type.toUpperCase()} entered for ${payload.ticker}.`,
        );
      },
      onError: (e) => Alert.alert('Error', (e as Error).message),
    });
  };

  const renderItem = ({ item, index }: { item: ZeroDTEOpportunity; index: number }) => (
    <ZeroDTECard item={item} rank={index + 1} onPress={setEnterItem} />
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>0DTE Watchlist</Text>
          <Text style={styles.subtitle}>
            Scan windows: {SCAN_WINDOWS.join(' · ')} ET
          </Text>
        </View>
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
        >
          {scanMutation.isPending
            ? <ActivityIndicator size="small" color="#F97316" />
            : <Ionicons name="refresh" size={20} color="#F97316" />
          }
        </TouchableOpacity>
      </View>

      {(lastScanLabel || minutesLeft !== null) && (
        <View style={styles.statusBar}>
          {lastScanLabel && (
            <View style={styles.statusChip}>
              <Ionicons name="time-outline" size={12} color="#64748B" />
              <Text style={styles.statusText}>Last scan {lastScanLabel}</Text>
            </View>
          )}
          {minutesLeft !== null && (
            <View style={[styles.statusChip, minutesLeft < 60 && styles.statusChipWarn]}>
              <Ionicons
                name="hourglass-outline"
                size={12}
                color={minutesLeft < 60 ? '#F97316' : '#64748B'}
              />
              <Text style={[styles.statusText, minutesLeft < 60 && styles.statusTextWarn]}>
                {minutesLeft}m to close
              </Text>
            </View>
          )}
        </View>
      )}

      {items.length > 0 && (
        <View style={styles.tierSummary}>
          {(['FIRE', 'SET', 'WATCH'] as const).map(tier => {
            const cfg = TIER_CONFIG[tier];
            return (
              <View key={tier} style={[styles.tierChip, { backgroundColor: cfg.bg }]}>
                <Text style={styles.tierEmoji}>{cfg.emoji}</Text>
                <Text style={[styles.tierCount, { color: cfg.color }]}>{tierCounts[tier]}</Text>
                <Text style={[styles.tierName, { color: cfg.color }]}>{tier}</Text>
              </View>
            );
          })}
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F97316" />
          <Text style={styles.loadingText}>Fetching scan results...</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No opportunities yet</Text>
          <Text style={styles.emptyBody}>
            Scans run at {SCAN_WINDOWS.join(', ')} ET.{'\n'}
            Tap the refresh button to run a manual scan.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, i) => `${item.ticker}-${item.strike}-${i}`}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor="#F97316"
            />
          }
        />
      )}

      <ZeroDTEEnterModal
        item={enterItem}
        visible={!!enterItem}
        onClose={() => setEnterItem(null)}
        onSubmit={handleEnterSubmit}
        isLoading={enterMutation.isPending}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: '#020817' },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title:          { color: '#F1F5F9', fontSize: 22, fontWeight: '700' },
  subtitle:       { color: '#475569', fontSize: 12, marginTop: 2 },
  scanBtn:        { backgroundColor: '#1E293B', borderRadius: 10, padding: 10, justifyContent: 'center', alignItems: 'center' },
  statusBar:      { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  statusChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1E293B', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  statusChipWarn: { borderWidth: 1, borderColor: '#431407' },
  statusText:     { color: '#64748B', fontSize: 11 },
  statusTextWarn: { color: '#F97316' },
  tierSummary:    { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tierChip:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  tierEmoji:      { fontSize: 14 },
  tierCount:      { fontSize: 18, fontWeight: '700' },
  tierName:       { fontSize: 11, fontWeight: '600' },
  listContent:    { paddingHorizontal: 16, paddingBottom: 32 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  loadingText:    { color: '#64748B', marginTop: 12 },
  emptyIcon:      { fontSize: 48, marginBottom: 16 },
  emptyTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyBody:      { color: '#64748B', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
