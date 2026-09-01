import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';

/** Subset of LivePriceData the SL-breach grace/countdown display needs — kept
 *  narrow (rather than importing LivePriceData directly) so PositionInfoModal's
 *  own, separately-shaped data prop can satisfy it too without either file
 *  importing the other (avoids a LivePositionPanel <-> PositionInfoModal
 *  circular import — both already need this badge). */
export interface SlGraceInfo {
  sl_grace_active?: boolean;
  sl_grace_deadline?: string | null;
  sl_recovery_deadline?: string | null;
  sl_grace_enabled?: boolean;
  sl_grace_minutes?: number | null;
  tp1_hit?: boolean;
}

/**
 * SL grace indicator — two states:
 *  - Idle: a persistent, low-key line showing this position's PRE-TP1 stop
 *    has a confirmation window at all (e.g. REVERSAL's default 5-min/3-bar
 *    grace — see profiles.py). Hidden once tp1_hit: grace only ever applies
 *    to the pre-TP1 hard stop (see ExitManager.evaluate() — "not self.
 *    be_stop_active"), so showing this after TP1 would claim protection the
 *    post-TP1 breakeven stop doesn't actually have.
 *  - Active: countdown for an in-progress grace window. Never runs its own
 *    independent clock — every render recomputes `deadline - Date.now()` off
 *    the backend's absolute timestamp (sl_grace_deadline), so this can't
 *    drift from the engine actually deciding when to force-sell. The
 *    setInterval here only forces a re-render each second; it holds no
 *    state of its own.
 *
 * Shared by LivePositionPanel's card AND PositionInfoModal's full sheet so
 * the SL-breach countdown reads identically wherever a user sees it.
 */
export function SlGraceBadge({ live, colors }: { live: SlGraceInfo; colors: any }) {
  const [, forceTick] = useState(0);
  const active = !!live.sl_grace_active && !!live.sl_grace_deadline;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) {
    if (!live.sl_grace_enabled || live.sl_grace_minutes == null || live.tp1_hit) return null;
    return (
      <View style={styles.slGraceRow}>
        <Ionicons name="shield-checkmark-outline" size={12} color={colors.textTertiary} />
        <Text style={[styles.slGraceText, { color: colors.textTertiary }]}>
          Stop has {live.sl_grace_minutes}m grace
        </Text>
      </View>
    );
  }

  const remainingSec = Math.max(0, Math.round((new Date(live.sl_grace_deadline!).getTime() - Date.now()) / 1000));
  const mm = Math.floor(remainingSec / 60);
  const ss = remainingSec % 60;
  const urgent = remainingSec <= 60;
  const color  = urgent ? colors.error : '#FF9F0A';

  const recovering  = !!live.sl_recovery_deadline;
  const recoverSec  = recovering
    ? Math.max(0, Math.round((new Date(live.sl_recovery_deadline!).getTime() - Date.now()) / 1000))
    : 0;

  return (
    <View style={[styles.slGraceBanner, { backgroundColor: color + '16' }]}>
      <Ionicons name="timer-outline" size={13} color={color} />
      <Text style={[styles.slGraceBannerText, { color }]}>
        SL breach — selling in {mm}:{String(ss).padStart(2, '0')}
      </Text>
      {recovering && (
        <Text style={[styles.slGraceSubText, { color: colors.textSecondary }]}>
          recovering, {recoverSec}s to cancel
        </Text>
      )}
    </View>
  );
}

/**
 * Slow opacity pulse (not a hard blink) — applied to the SL price wherever
 * it's shown (card chip, modal stop-loss value) while a grace/breach
 * countdown is actively running (`sl_grace_active`), so a breached stop
 * stays visibly "alive" even if the countdown banner text itself goes
 * unnoticed. ~1.8s full cycle — "slowly flash", not an urgent strobe.
 */
export function useSlGracePulse(active: boolean) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (active) {
      opacity.value = withRepeat(
        withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [active, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

const styles = StyleSheet.create({
  slGraceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  slGraceText: { fontSize: 11, fontWeight: '600' },

  slGraceBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10,
  },
  slGraceBannerText: { fontSize: 12, fontWeight: '700' },
  slGraceSubText:    { fontSize: 10 },
});
