import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, cancelAnimation, runOnJS, Easing } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMorningBrief } from '@/hooks/queries/brief/useMorningBrief';
import { useConfirmBriefPlay, useSkipBriefPlay } from '@/hooks/mutations/brief/useBriefPlayActions';
import type { BriefPlay, BriefContractCandidate } from '@/common/types/morningBrief';
import type { EnteredInfo } from './EnteredCard';

/**
 * Confirm-entry stack: one card per play awaiting confirmation (confirm
 * card v3). The stack persists until every card gets a decision (Confirm /
 * Skip) — deciding removes it from `awaiting_confirmation` server-side, so
 * the card drops off naturally on the next poll.
 *
 * Per card: score pill + countdown (5 min, capped at 10:00 ET server-side),
 * a contract picker with the top pick highlighted, ONE Paper button that
 * toggles to LIVE (card turns red), and Confirm — a tap on paper, a 1s
 * press-and-hold on live (it places a real order).
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

const HOLD_MS = 1000;

/** "AMZN261005C00252500" → "252.5C" (best-effort). */
function contractLabel(symbol: string): string {
  const m = symbol.match(/(\d{6})([CP])(\d{8})$/);
  if (!m) return symbol;
  const strike = (Number(m[3]) / 1000).toFixed(2).replace(/\.?0+$/, '');
  return `${strike}${m[2]}`;
}

function ScorePill({ score, colors }: { score: number; colors: ReturnType<typeof useThemeColors> }) {
  const c = score >= 90 ? colors.success : score >= 80 ? colors.accent : colors.warning;
  return (
    <View style={[styles.badge, { backgroundColor: c + '22', borderColor: c + '66' }]}>
      <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: c }]}>SCORE {score.toFixed(0)}</Text>
    </View>
  );
}

function ContractRow({ c, selected, onPress, live, colors }: {
  c: BriefContractCandidate; selected: boolean; onPress: () => void; live: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const accent = live ? '#fff' : colors.accent;
  const price = c.limit ?? c.ask;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.contractRow,
        {
          borderColor: selected ? accent : (live ? '#ffffff33' : colors.border),
          backgroundColor: selected ? accent + (live ? '22' : '14') : 'transparent',
        },
      ]}
      accessibilityLabel={`${contractLabel(c.symbol)}${c.top_pick ? ', top pick' : ''}`}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={16}
        color={selected ? accent : (live ? '#ffffffaa' : colors.textTertiary)}
      />
      <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: live ? '#fff' : colors.text }]}>
        {contractLabel(c.symbol)}
      </Text>
      {c.top_pick && (
        <View style={[styles.badge, { paddingVertical: 1, backgroundColor: accent + '22', borderColor: accent + '66' }]}>
          <Text style={[styles.mono, { fontSize: 8.5, fontWeight: '800', color: accent }]}>TOP PICK</Text>
        </View>
      )}
      <View style={{ flex: 1 }} />
      <Text style={[styles.mono, { fontSize: 11, color: live ? '#ffffffcc' : colors.textSecondary }]}>
        {c.qty}× ${price.toFixed(2)} = ${(c.qty * price * 100).toFixed(0)}
      </Text>
    </TouchableOpacity>
  );
}

function ConfirmCard({ play, onEntered }: { play: BriefPlay; onEntered?: (info: EnteredInfo) => void }) {
  const colors = useThemeColors();
  const confirm = useConfirmBriefPlay();
  const skip = useSkipBriefPlay();
  const dirUp = play.direction === 'CALL';
  const dirColor = dirUp ? colors.success : colors.error;
  const busy = confirm.isPending || skip.isPending;

  const candidates = play.contract_candidates ?? [];
  const topPick = candidates.find((c) => c.top_pick) ?? candidates[0];
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = candidates.find((c) => c.symbol === selected) ?? topPick ?? null;
  const [live, setLive] = useState(false);

  const fg = live ? '#fff' : colors.text;
  const fg2 = live ? '#ffffffcc' : colors.textSecondary;

  const doConfirm = () => {
    if (busy) return;
    confirm.mutate(
      { ticker: play.ticker, contractSymbol: chosen?.symbol ?? null, paperMode: !live },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          onEntered?.({
            ticker: play.ticker,
            direction: play.direction,
            contractLabel: chosen ? contractLabel(chosen.symbol) : null,
            qty: chosen?.qty ?? null,
            limit: chosen ? (chosen.limit ?? chosen.ask) : null,
            paper: !live,
          });
        },
      },
    );
  };

  // Live = press-and-hold: a fill bar runs for HOLD_MS; letting go early
  // cancels. Paper confirms on a tap.
  const hold = useSharedValue(0);
  const holdStyle = useAnimatedStyle(() => ({ width: `${hold.value * 100}%` }));
  const startHold = () => {
    if (!live || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    hold.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear }, (done) => {
      if (done) runOnJS(doConfirm)();
    });
  };
  const endHold = () => {
    if (!live) return;
    cancelAnimation(hold);
    hold.value = withTiming(0, { duration: 150 });
  };

  return (
    <View
      style={[
        styles.card,
        live
          ? { backgroundColor: '#B3261E', borderColor: '#FF6B6B' }
          : { backgroundColor: colors.card, borderColor: dirColor + '66' },
      ]}
    >
      {/* header: ticker · direction · score ............ countdown */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="alert-circle" size={18} color={live ? '#fff' : colors.warning} />
        <Text style={[styles.mono, { fontSize: 15, fontWeight: '800', color: fg }]}>{play.ticker}</Text>
        <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
          <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: live ? '#fff' : dirColor }]}>
            {play.direction}
          </Text>
        </View>
        <ScorePill score={play.score} colors={colors} />
        <View style={{ flex: 1 }} />
        <Countdown expiresAt={play.confirm_expires_at} colors={colors} />
      </View>

      <Text style={{ fontSize: 13, color: fg2, marginTop: 8, lineHeight: 18 }}>
        Triggered at <Text style={[styles.mono, { color: fg, fontWeight: '700' }]}>${play.trigger.toFixed(2)}</Text>
        {play.live_price != null && (
          <> · now <Text style={[styles.mono, { color: fg, fontWeight: '700' }]}>${play.live_price.toFixed(2)}</Text></>
        )}
        {' '}· target <Text style={[styles.mono, { color: fg, fontWeight: '700' }]}>${play.target.toFixed(2)}</Text>
      </Text>

      {/* contract picker */}
      <View style={{ marginTop: 10, gap: 6 }}>
        {candidates.length > 0 ? (
          candidates.map((c) => (
            <ContractRow
              key={c.symbol}
              c={c}
              selected={chosen?.symbol === c.symbol}
              onPress={() => setSelected(c.symbol)}
              live={live}
              colors={colors}
            />
          ))
        ) : (
          <Text style={{ fontSize: 11.5, color: fg2 }}>
            Finding contracts… (confirming now auto-picks the best fit at entry)
          </Text>
        )}
      </View>

      {/* Paper/Live · Skip · Confirm */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setLive((v) => !v);
          }}
          disabled={busy}
          activeOpacity={0.8}
          accessibilityLabel={live ? 'Live — tap for paper' : 'Paper — tap for live'}
          style={[
            styles.btn,
            { paddingHorizontal: 14 },
            live
              ? { backgroundColor: '#fff' }
              : { backgroundColor: colors.warning + '1E', borderWidth: 1, borderColor: colors.warning + '66' },
          ]}
        >
          <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: live ? '#B3261E' : colors.warning }]}>
            {live ? 'LIVE' : 'PAPER'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => skip.mutate(play.ticker)}
          disabled={busy}
          activeOpacity={0.8}
          style={[styles.btn, { flex: 1, backgroundColor: live ? '#ffffff22' : colors.surfaceSecondary, opacity: busy ? 0.5 : 1 }]}
        >
          <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: fg2 }]}>SKIP</Text>
        </TouchableOpacity>
        <Pressable
          onPress={live ? undefined : doConfirm}
          onPressIn={startHold}
          onPressOut={endHold}
          disabled={busy}
          accessibilityLabel={live ? 'Press and hold to place a live order' : 'Confirm paper entry'}
          style={[
            styles.btn,
            { flex: 2, overflow: 'hidden', opacity: busy ? 0.6 : 1 },
            live ? { backgroundColor: '#7A1712' } : { backgroundColor: colors.success },
          ]}
        >
          {live && <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#fff3' }, holdStyle]} />}
          <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: '#fff' }]}>
            {confirm.isPending ? 'ENTERING…' : live ? 'HOLD TO ENTER LIVE' : 'CONFIRM PAPER'}
          </Text>
        </Pressable>
      </View>
      {confirm.isError && (
        <Text style={{ fontSize: 11.5, color: live ? '#fff' : colors.error, marginTop: 8 }} numberOfLines={2}>
          {(confirm.error as Error)?.message ?? 'Confirm failed'}
        </Text>
      )}
    </View>
  );
}

export function usePendingConfirmations(): BriefPlay[] {
  const { data: brief } = useMorningBrief();
  return (brief?.plays ?? []).filter((p) => p.status === 'awaiting_confirmation');
}

const PEEK_OFFSET = 9;   // px each card behind sticks out below the one in front
const MAX_PEEKS = 2;

/**
 * A deck, not a list: the soonest-expiring play is the front card (fully
 * interactive); up to two more peek out behind it. ‹ › flips through without
 * deciding; confirming/skipping the front card drops it server-side, so the
 * next one comes up on its own.
 */
export function ConfirmStackCard({ onEntered }: { onEntered?: (info: EnteredInfo) => void }) {
  const colors = useThemeColors();
  const pending = usePendingConfirmations();
  const ordered = useMemo(
    () => [...pending].sort((a, b) =>
      (a.confirm_expires_at ?? '').localeCompare(b.confirm_expires_at ?? '')),
    [pending],
  );
  // Flip position — kept by ticker so a play dropping out (confirmed,
  // skipped, expired) doesn't shift you onto a different card mid-read.
  const [frontTicker, setFrontTicker] = useState<string | null>(null);
  const [frontH, setFrontH] = useState(0);
  if (ordered.length === 0) return null;

  const idx = Math.max(0, ordered.findIndex((p) => p.ticker === frontTicker));
  const n = ordered.length;
  const front = ordered[idx];
  const behind = Array.from({ length: Math.min(MAX_PEEKS, n - 1) }, (_, k) => ordered[(idx + k + 1) % n]);
  const flip = (dir: 1 | -1) => {
    Haptics.selectionAsync().catch(() => {});
    setFrontTicker(ordered[(idx + dir + n) % n].ticker);
  };

  return (
    <View style={{ padding: 14, paddingBottom: 14 + behind.length * PEEK_OFFSET }}>
      {n > 1 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={[styles.mono, { fontSize: 10, letterSpacing: 1.5, color: colors.textTertiary }]}>
            PLAY {idx + 1} OF {n} · SOONEST FIRST
          </Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => flip(-1)} hitSlop={8} style={styles.flipBtn} accessibilityLabel="Previous play">
            <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => flip(1)} hitSlop={8} style={styles.flipBtn} accessibilityLabel="Next play">
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}
      <View>
        {/* cards behind — same footprint as the front card, inset and
            nudged down so only their bottom edges show */}
        {frontH > 0 && behind.map((p, k) => {
          const depth = k + 1;
          return (
            <View
              key={p.ticker}
              pointerEvents="none"
              style={[
                styles.peek,
                {
                  top: depth * PEEK_OFFSET,
                  left: depth * 10,
                  right: depth * 10,
                  height: frontH,
                  zIndex: -depth,
                  opacity: 1 - depth * 0.25,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            />
          );
        }).reverse()}
        <View onLayout={(e) => setFrontH(e.nativeEvent.layout.height)}>
          <ConfirmCard key={front.ticker} play={front} onEntered={onEntered} />
        </View>
      </View>
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
  peek: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: 1.5,
  },
  flipBtn: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contractRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  btn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
