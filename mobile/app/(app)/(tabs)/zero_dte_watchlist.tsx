import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, SafeAreaView, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useZeroDTEWatchlist } from '@/hooks/queries/zero_dte/useZeroDTEWatchlist';
import { useZeroDTEPositions } from '@/hooks/queries/zero_dte/useZeroDTEPositions';
import { useZeroDTESpotPrices } from '@/hooks/queries/zero_dte/useZeroDTESpotPrices';
import { useRunZeroDTEScan } from '@/hooks/mutations/zero_dte/useRunZeroDTEScan';
import { useEnterZeroDTEPosition } from '@/hooks/mutations/zero_dte/useEnterZeroDTEPosition';
import { useUpdateZeroDTEExits } from '@/hooks/mutations/zero_dte/useUpdateZeroDTEExits';
import { ZeroDTECard } from '@/common/components/zero_dte/ZeroDTECard';
import { ZeroDTEEnterModal } from '@/common/components/zero_dte/ZeroDTEEnterModal';
import { ZeroDTEEditExitsModal } from '@/common/components/zero_dte/ZeroDTEEditExitsModal';
import { TIER_CONFIG } from '@/common/types/zero_dte';
import type { ZeroDTEOpportunity, ZeroDTEPosition } from '@/common/types/zero_dte';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';

const SCAN_WINDOWS = ['9:45', '10:30', '11:30', '12:30', '1:30'];

export default function ZeroDTEWatchlistScreen() {
  const colors = useThemeColors();
  const toast  = useToast();

  const { data: items = [], isLoading, refetch, isFetching } = useZeroDTEWatchlist();
  const { data: openPositions = [] } = useZeroDTEPositions('open');
  const scanMutation    = useRunZeroDTEScan();
  const enterMutation   = useEnterZeroDTEPosition();
  const updateExitsMut  = useUpdateZeroDTEExits();
  const [enterItem, setEnterItem] = useState<ZeroDTEOpportunity | null>(null);
  const [editPosition, setEditPosition] = useState<ZeroDTEPosition | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ZeroDTEOpportunity[]>([]);

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

  const uniqueTickers = useMemo(() => {
    const all = [...items, ...scanCandidates].map(i => i.ticker);
    return [...new Set(all)].slice(0, 5);
  }, [items, scanCandidates]);

  const { data: spotPrices } = useZeroDTESpotPrices(uniqueTickers);

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
        const surfaced: ZeroDTEOpportunity[] = data?.surfaced ?? [];
        const allCandidates: ZeroDTEOpportunity[] = data?.candidates ?? [];
        setScanCandidates(allCandidates);
        const fire  = surfaced.filter((i) => i.tier === 'FIRE').length;
        const set   = surfaced.filter((i) => i.tier === 'SET').length;
        const watch = surfaced.filter((i) => i.tier === 'WATCH').length;
        if (surfaced.length > 0) {
          toast.success(`Scan complete — ${fire} 🔥 FIRE  ${set} ✅ SET  ${watch} 👁 WATCH`);
        } else {
          toast.info(`Scan complete — 0 surfaced, ${allCandidates.length} reviewed`);
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

  const handleUpdateExits = (
    positionId: string,
    stopPrice: number,
    tpLadder: ZeroDTEPosition['tp_ladder'],
  ) => {
    updateExitsMut.mutate(
      { positionId, stop_price: stopPrice, tp_ladder: tpLadder },
      {
        onSuccess: () => {
          setEditPosition(null);
          toast.success('Exit levels updated');
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
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

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          {/* Fetch latest from Supabase */}
          <TouchableOpacity
            onPress={() => refetch()}
            disabled={isFetching}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.iconButton,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.iconButtonBorder,
            }}
          >
            {isFetching && !isLoading
              ? <ActivityIndicator size="small" color={colors.text} />
              : <Ionicons name="cloud-download-outline" size={18} color={colors.text} />
            }
          </TouchableOpacity>

          {/* Run a new scan */}
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
            }}
          >
            {scanMutation.isPending
              ? <ActivityIndicator size="small" color={colors.text} />
              : <Ionicons name="refresh" size={18} color={colors.text} />
            }
          </TouchableOpacity>
        </View>
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

      {/* ── Live spot prices ── */}
      {uniqueTickers.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
          {uniqueTickers.map(ticker => {
            const spot = spotPrices?.[ticker];
            const up   = spot ? spot.change_pct >= 0 : null;
            const clr  = up === null ? colors.textTertiary : up ? '#10B981' : '#EF4444';
            return (
              <View
                key={ticker}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: colors.surface,
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderWidth: 1,
                  borderColor: spot ? clr + '44' : colors.border,
                }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{ticker}</Text>
                {spot ? (
                  <>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>
                      ${spot.price.toFixed(2)}
                    </Text>
                    <Text style={{ color: clr, fontSize: 11, fontWeight: '600' }}>
                      {up ? '+' : ''}{spot.change_pct.toFixed(2)}%
                    </Text>
                    <View style={{
                      backgroundColor: spot.above_vwap ? '#10B981' + '22' : '#EF4444' + '22',
                      borderRadius: 4,
                      paddingHorizontal: 4,
                      paddingVertical: 1,
                    }}>
                      <Text style={{ color: spot.above_vwap ? '#10B981' : '#EF4444', fontSize: 9, fontWeight: '700' }}>
                        {spot.above_vwap ? '▲ VWAP' : '▼ VWAP'}
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text style={{ color: colors.textTertiary, fontSize: 12 }}>—</Text>
                )}
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
      ) : (
        <FlatList
          data={[]}
          keyExtractor={() => ''}
          renderItem={() => null}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={() => (
            <View>
              {/* Open positions */}
              {openPositions.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 }}>
                    OPEN POSITIONS ({openPositions.length})
                  </Text>
                  {openPositions.map((pos) => {
                    const isCall  = pos.contract_type === 'call';
                    const sideClr = isCall ? '#10B981' : '#EF4444';
                    const tp1     = pos.tp_ladder[0];
                    const tp1Price = tp1 ? pos.entry_price * (1 + tp1.pct) : null;
                    return (
                      <View
                        key={pos.id}
                        style={{
                          backgroundColor: colors.surface,
                          borderRadius: 14,
                          padding: 14,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderLeftWidth: 3,
                          borderLeftColor: sideClr,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800', flex: 1 }}>
                            {pos.ticker}
                          </Text>
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <View style={{ backgroundColor: sideClr + '22', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
                              <Text style={{ color: sideClr, fontSize: 11, fontWeight: '700' }}>
                                {isCall ? '▲' : '▼'} {pos.contract_type.toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ backgroundColor: pos.mode === 'live' ? '#EF4444' + '22' : '#8B5CF6' + '22', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
                              <Text style={{ color: pos.mode === 'live' ? '#EF4444' : '#8B5CF6', fontSize: 11, fontWeight: '700' }}>
                                {pos.mode.toUpperCase()}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 10 }}>
                          <View>
                            <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Entry</Text>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>${pos.entry_price.toFixed(2)}</Text>
                          </View>
                          <View>
                            <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Stop</Text>
                            <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '600' }}>${pos.stop_price.toFixed(2)}</Text>
                          </View>
                          {tp1Price !== null && (
                            <View>
                              <Text style={{ color: colors.textTertiary, fontSize: 10 }}>TP1</Text>
                              <Text style={{ color: '#10B981', fontSize: 13, fontWeight: '600' }}>${tp1Price.toFixed(2)}</Text>
                            </View>
                          )}
                          <View>
                            <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Qty</Text>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{pos.qty_remaining}/{pos.qty}</Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          onPress={() => setEditPosition(pos)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            backgroundColor: '#3B82F6' + '22',
                            borderRadius: 8,
                            paddingVertical: 8,
                            borderWidth: 1,
                            borderColor: '#3B82F6' + '44',
                          }}
                        >
                          <Ionicons name="pencil-outline" size={14} color="#3B82F6" />
                          <Text style={{ color: '#3B82F6', fontSize: 13, fontWeight: '600' }}>Edit Exits</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Surfaced opportunities */}
              {items.length > 0 && (
                <>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 }}>
                    OPPORTUNITIES
                  </Text>
                  {items.map((item, index) => (
                    <ZeroDTECard key={`${item.ticker}-${item.strike}-${index}`} item={item} rank={index + 1} onPress={setEnterItem} />
                  ))}
                </>
              )}

              {/* Candidates from last scan (below threshold) */}
              {scanCandidates.filter(c => c.tier === 'CANDIDATE').length > 0 && (
                <View style={{ marginTop: items.length > 0 ? 12 : 0 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 }}>
                    CANDIDATES — BELOW THRESHOLD ({scanCandidates.filter(c => c.tier === 'CANDIDATE').length})
                  </Text>
                  {scanCandidates
                    .filter(c => c.tier === 'CANDIDATE')
                    .map((item, index) => (
                      <ZeroDTECard key={`cand-${item.ticker}-${item.strike}-${index}`} item={item} rank={index + 1} onPress={setEnterItem} />
                    ))
                  }
                </View>
              )}

              {/* Empty state */}
              {items.length === 0 && scanCandidates.length === 0 && (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingTop: 60 }}>
                  <View style={{
                    backgroundColor: colors.surface,
                    borderRadius: 20,
                    padding: 32,
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: colors.border,
                    width: '100%',
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
              )}
            </View>
          )}
          ListEmptyComponent={null}
        />
      )}

      <ZeroDTEEnterModal
        item={enterItem}
        visible={!!enterItem}
        onClose={() => setEnterItem(null)}
        onSubmit={handleEnterSubmit}
        isLoading={enterMutation.isPending}
      />

      <ZeroDTEEditExitsModal
        position={editPosition}
        visible={!!editPosition}
        onClose={() => setEditPosition(null)}
        onSubmit={handleUpdateExits}
        isLoading={updateExitsMut.isPending}
      />
    </SafeAreaView>
  );
}
