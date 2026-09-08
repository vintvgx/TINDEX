import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { useGenerateMarketDigest } from '@/hooks/mutations/digest/useGenerateMarketDigest';
import { useSeenMarketDigests } from '@/hooks/useSeenMarketDigests';
import { useToast } from '@/common/components/ui/Toast';
import { DigestGeneratingOverlay } from './DigestGeneratingOverlay';

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Persistent Home banner for the pre-market Market Digest — the digest
 * normally arrives via its own push notification (see
 * StrategyNotifier.notify_market_digest_ready), but this makes it reachable
 * any time without waiting for or having tapped that notification. Today's
 * digest is usually already sitting in Supabase by the time this renders
 * (cron fires ~8:30 AM ET); if it isn't (weekend testing, cron miss), tapping
 * builds it on-demand, same pattern as Daily Review's "Generate Review".
 */
export function MarketDigestCard({ onOpen }: { onOpen: (date: string) => void }) {
  const colors = useThemeColors();
  const toast = useToast();
  const today = todayISO();
  const { data, isLoading } = useMarketDigest(today);
  const generate = useGenerateMarketDigest();
  const { isSeen } = useSeenMarketDigests();
  const ready = !!data?.data;

  if (ready && isSeen(today)) return null;

  const handlePress = () => {
    if (ready) { onOpen(today); return; }
    if (generate.isPending) return;
    generate.mutate(today, {
      onSuccess: () => onOpen(today),
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.8}
        disabled={isLoading}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginHorizontal: 16, marginTop: 10, marginBottom: 4,
          paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14,
          backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        }}
      >
        <View style={{
          width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
          backgroundColor: colors.accent + '18',
        }}>
          <Ionicons name="sunny-outline" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>Today’s Market Digest</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 1 }}>
            {ready ? 'Ready — tap to view' : 'Not generated yet — tap to build'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </TouchableOpacity>
      <DigestGeneratingOverlay visible={generate.isPending} />
    </>
  );
}
