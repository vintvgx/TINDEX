import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMorningBrief } from '@/hooks/queries/brief/useMorningBrief';
import { useConfirmBriefPlay, useSkipBriefPlay } from '@/hooks/mutations/brief/useBriefPlayActions';
import type { BriefPlay } from '@/common/types/morningBrief';

/**
 * Confirm-entry stack: one card per play awaiting confirmation. The stack
 * persists until every card gets a decision (Confirm Entry / Skip) —
 * deciding removes it from `awaiting_confirmation` server-side, so the
 * card drops off naturally on the next poll.
 */

function Countdown({ expiresAt, colors }: { expiresAt?: string; colors: ReturnType<typeof useThemeColors> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!expiresAt) return null;
  const secs = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  const urgent = secs < 60;
  return (
    <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', color: urgent ? colors.error : colors.textTertiary }]}>
      {mm}:{ss}
    </Text>
  );
}

function ConfirmCard({ play }: { play: BriefPlay }) {
  const colors = useThemeColors();
  const confirm = useConfirmBriefPlay();
  const skip = useSkipBriefPlay();
  const dirUp = play.direction === 'CALL';
  const dirColor = dirUp ? colors.success : colors.error;
  const busy = confirm.isPending || skip.isPending;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: dirColor + '66' },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="alert-circle" size={18} color={colors.warning} />
        <Text style={[styles.mono, { fontSize: 15, fontWeight: '800', color: colors.text }]}>
          {play.ticker}
        </Text>
        <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
          <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: dirColor }]}>
            {play.direction}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Countdown expiresAt={play.confirm_expires_at} colors={colors} />
      </View>

      <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 8, lineHeight: 18 }}>
        Triggered at <Text style={[styles.mono, { color: colors.text, fontWeight: '700' }]}>${play.trigger.toFixed(2)}</Text>
        {' '}· score <Text style={[styles.mono, { color: colors.text, fontWeight: '700' }]}>{play.score.toFixed(0)}</Text>
        {play.live_price != null && (
          <> · now <Text style={[styles.mono, { color: colors.text, fontWeight: '700' }]}>${play.live_price.toFixed(2)}</Text></>
        )}
      </Text>
      {play.status_reason ? (
        <Text style={{ fontSize: 11.5, color: colors.textTertiary, marginTop: 4 }} numberOfLines={2}>
          {play.status_reason}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <TouchableOpacity
          onPress={() => skip.mutate(play.ticker)}
          disabled={busy}
          activeOpacity={0.8}
          style={[styles.btn, { flex: 1, backgroundColor: colors.surfaceSecondary, opacity: busy ? 0.5 : 1 }]}
        >
          <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: colors.textSecondary }]}>
            SKIP
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => confirm.mutate(play.ticker)}
          disabled={busy}
          activeOpacity={0.8}
          style={[styles.btn, { flex: 2, backgroundColor: colors.success, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: '#fff' }]}>
            {confirm.isPending ? 'ENTERING…' : 'CONFIRM ENTRY'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function usePendingConfirmations(): BriefPlay[] {
  const { data: brief } = useMorningBrief();
  return (brief?.plays ?? []).filter((p) => p.status === 'awaiting_confirmation');
}

export function ConfirmStackCard() {
  const pending = usePendingConfirmations();
  if (pending.length === 0) return null;
  return (
    <View style={{ gap: 8, padding: 14 }}>
      {pending.map((p) => (
        <ConfirmCard key={p.ticker} play={p} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  btn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
