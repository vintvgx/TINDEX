import React from 'react';
import { SafeAreaView, ScrollView, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useSellStatus } from '@/hooks/useSellStatus';
import { useSendTestPush } from '@/hooks/mutations/strategy/useSendTestPush';

interface SimRow {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sub: string;
  onPress: () => void;
  busy?: boolean;
}

/**
 * Profile > Simulator — test actions for verifying app behavior without a
 * real trade. Nothing here places a real order or touches a live/paper
 * position. Distinct from the existing "Run Simulation" screen (a specific
 * 10-tick ORB-breakout chart simulator, reused here as one row rather than
 * duplicated) — this is a broader test-action hub added alongside it.
 */
export function SimulatorScreen({ onClose }: { onClose: () => void }) {
  const colors = useThemeColors();
  const toast = useToast();
  const { startSelling, markSold } = useSellStatus();
  const sendTestPush = useSendTestPush();

  // Client-only — never calls the backend. Exercises exactly the pieces
  // built for the 2026-08-09 ticker-tape fix: useSellStatus's 'selling' →
  // 'sold' → auto-clear lifecycle and TickerTape's takeover render. A fake
  // strategyId means SellStatusLine's useStrategyLivePrice WS simply fails
  // to connect (already-handled fallback — no live-price suffix shown),
  // same as it would for any stream hiccup on a real sell.
  const simulateSell = () => {
    const id = `sim-sell-${Date.now()}`;
    startSelling({ id, strategyId: 'sim-fake-strategy', ticker: 'IWM', contractLabel: 'IWM 300C', qty: 2, paperMode: true });
    toast.info('Simulated sell started — watch the ticker tape');
    setTimeout(() => markSold(id, 1.42, 2, 44), 3000);
  };

  const rows: SimRow[] = [
    {
      key: 'entry',
      icon: 'flash-outline',
      label: 'Simulate Trade Entry',
      sub: 'Opens the existing 10-tick ORB simulator (live WS ticks, real push unless suppressed)',
      onPress: () => router.push('/(app)/(tabs)/simulation' as any),
    },
    {
      key: 'sell',
      icon: 'exit-outline',
      label: 'Simulate Contract Sell',
      sub: 'Fakes the ticker tape "Selling…" → "Sold…" flow — no backend call, self-clears after 20s',
      onPress: simulateSell,
    },
    {
      key: 'push',
      icon: 'notifications-outline',
      label: 'Send Test Push',
      sub: 'Fires a real push through the same queue every trade alert uses',
      busy: sendTestPush.isPending,
      onPress: () => sendTestPush.mutate(
        {},
        {
          onSuccess: () => toast.success('Test push queued — check your device'),
          onError: (e) => toast.error(e.message || 'Failed to send test push'),
        },
      ),
    },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
        <TouchableOpacity onPress={onClose} hitSlop={10} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Simulator</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17, marginBottom: 20 }}>
          Test actions for verifying app behavior without a real trade. Nothing here places an order or touches a live/paper position.
        </Text>

        <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          {rows.map((row, index) => (
            <TouchableOpacity
              key={row.key}
              onPress={row.onPress}
              disabled={row.busy}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
                borderBottomWidth: index < rows.length - 1 ? 1 : 0, borderBottomColor: colors.separator,
              }}
            >
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.iconButton, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Ionicons name={row.icon} size={17} color={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }}>{row.label}</Text>
                <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>{row.sub}</Text>
              </View>
              {row.busy ? (
                <ActivityIndicator size="small" color={colors.textTertiary} />
              ) : (
                <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
