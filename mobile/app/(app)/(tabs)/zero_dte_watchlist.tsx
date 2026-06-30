import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, SafeAreaView, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useZeroDTEWatchlist } from '@/hooks/queries/zero_dte/useZeroDTEWatchlist';
import { useRunZeroDTEScan } from '@/hooks/mutations/zero_dte/useRunZeroDTEScan';
import { useEnterZeroDTEPosition } from '@/hooks/mutations/zero_dte/useEnterZeroDTEPosition';
import { ZeroDTECard } from '@/common/components/zero_dte/ZeroDTECard';
import { ZeroDTEEnterModal } from '@/common/components/zero_dte/ZeroDTEEnterModal';
import { TIER_CONFIG } from '@/common/types/zero_dte';
import type { ZeroDTEOpportunity } from '@/common/types/zero_dte';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';

const SCAN_WINDOWS = ['9:45', '10:30', '11:30', '12:30', '1:30'];

export default function ZeroDTEWatchlistScreen() {
  const colors = useThemeColors();
  const toast  = useToast();

  const { data: items = [], isLoading, refetch, isFetching } = useZeroDTEWatchlist();
  const scanMutation  = useRunZeroDTEScan();
  const enterMutation = useEnterZeroDTEPosition();
  const [enterItem, setEnterItem] = useState<ZeroDTEOpportunity | null>(null);

  // Notify when a new auto-scan result arrives (scan_time changed on the server)
  const prevScanTimeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!items.length) return;
    const newScanTime = items[0].scan_time;
    if (prevScanTimeRef.current !== null && prevScanTimeRef.current !== newScanTime) {
      const fire  = items.filter(i => i.tier === 'FIRE').length;
      const set   = items.filter(i => i.tier === 'SET').length;
      const watch = items.filter(i => i.tier === 'WATCH').length;
      toast.info(`0DTE updated — ${fire} 🔥 FIRE  ${set} ✅ SET  ${watch} 👁 WATCH`);
    }
    prevScanTimeRef.current = newScanTime;
  }, [items]);

  const tierCounts = useMemo(() => ({
    FIRE:  items.filter(i => i.tier === 'FIRE').length,
    SET:   items.filter(i => i.tier === 'SET').length,
    WATCH: items.filter(i => i.tier === 'WATCH').length,
  }), [items]);

  const lastScanLabel = useMemo(() => {
    if (!items.length) return null;
    return new Date(items[0].scan_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [items]);

  const minutesLeft = useMemo(() => {
    if (!items.length) return null;
    return items[0].minutes_remaining;
  }, [items]);

  const handleRunScan = () => {
    scanMutation.mutate(undefined, {
      onSuccess: (data) => {
        const surfaced = data?.surfaced ?? [];
        const fire  = surfaced.filter((i: ZeroDTEOpportunity) => i.tier === 'FIRE').length;
        const set   = surfaced.filter((i: ZeroDTEOpportunity) => i.tier === 'SET').length;
        const watch = surfaced.filter((i: ZeroDTEOpportunity) => i.tier === 'WATCH').length;
        if (surfaced.length > 0) {
          toast.success(`Scan complete — ${fire} 🔥 FIRE  ${set} ✅ SET  ${watch} 👁 WATCH`);
        } else {
          toast.info('Scan complete — no opportunities found');
        }
      },
      onError: (e) => toast.error(`Scan failed: ${(e as Error).message}`),
    });
  };

  const handleEnterSubmit = (payload: Parameters<typeof enterMutation.mutate>[0]) => {
    enterMutation.mutate(payload, {
      onSuccess: () => {
        setEnterItem(null);
        const mode = payload.mode === 'live' ? 'Live' : 'Paper';
        toast.success(`${mode} ${payload.contract_type.toUpperCase()} entered for ${payload.ticker}`);
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ── Header ── */}
      <View style={{
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.separator,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
      }}>
        <View>
          <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 }}>
            0DTE
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
            {SCAN_WINDOWS.join(' · ')} ET
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleRunScan}
          disabled={scanMutation.isPending}
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
          {scanMutation.isPending
            ? <ActivityIndicator size="small" color={colors.text} />
            : <Ionicons name="refresh" size={18} color={colors.text} />
          }
        </TouchableOpacity>
      </View>

      {/* ── Status bar ── */}
      {(lastScanLabel || minutesLeft !== null) && (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
          {lastScanLabel && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: colors.surface, borderRadius: 6,
              paddingHorizontal: 8, paddingVertical: 4,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <Ionicons name="time-outline" size={12} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Last scan {lastScanLabel}</Text>
            </View>
          )}
          {minutesLeft !== null && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: colors.surface, borderRadius: 6,
              paddingHorizontal: 8, paddingVertical: 4,
              borderWidth: 1,
              borderColor: minutesLeft < 60 ? '#F97316' + '44' : colors.border,
            }}>
              <Ionicons name="hourglass-outline" size={12} color={minutesLeft < 60 ? '#F97316' : colors.textTertiary} />
              <Text style={{ color: minutesLeft < 60 ? '#F97316' : colors.textSecondary, fontSize: 11 }}>
                {minutesLeft}m to close
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Tier summary ── */}
      {items.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
          {(['FIRE', 'SET', 'WATCH'] as const).map(tier => {
            const cfg = TIER_CONFIG[tier];
            return (
              <View key={tier} style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingHorizontal: 12, paddingVertical: 6,
                borderRadius: 8, backgroundColor: cfg.bg,
              }}>
                <Text style={{ fontSize: 14 }}>{cfg.emoji}</Text>
                <Text style={{ fontSize: 18, fontWeight: '700', color: cfg.color }}>{tierCounts[tier]}</Text>
                <Text style={{ fontSize: 11, fontWeight: '600', color: cfg.color }}>{tier}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>
            Fetching scan results...
          </Text>
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={{
            backgroundColor: colors.surface,
            borderRadius: 20,
            padding: 32,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: colors.border,
          }}>
            <Text style={{ fontSize: 40, marginBottom: 16 }}>📭</Text>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
              No opportunities yet
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
              Scans run at {SCAN_WINDOWS.join(', ')} ET.{'\n'}
              Tap the refresh button to run a manual scan.
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, i) => `${item.ticker}-${item.strike}-${i}`}
          renderItem={({ item, index }) => (
            <ZeroDTECard item={item} rank={index + 1} onPress={setEnterItem} />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.accent}
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
