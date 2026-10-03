import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
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
  /** Absolute worst-case floor price — shown alongside the countdown while
   *  the grace window is active, so "this sells no matter what at $X.XX"
   *  is visible in the moment, not just after the fact in the trade log.
   *  Null/undefined when this trade's profile has no floor, or omitted
   *  entirely when sl_floor_enabled is false. */
  sl_outer_floor?: number | null;
  sl_floor_enabled?: boolean;
  /** Post-TP1 breakeven grace countdown (see ExitManager): while active,
   *  a breakeven-stop breach is waiting for recovery before selling. */
  be_grace_active?: boolean;
  be_grace_deadline?: string | null;
  be_grace_seconds?: number | null;
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
export function SlGraceBadge({ live, colors, onCancelBeGrace, cancellingBeGrace }: {
  live: SlGraceInfo;
  colors: any;
  /** Edit sheet only — shows a Cancel button on the running breakeven
   *  timer (hold the position; the breakeven stop stays armed). */
  onCancelBeGrace?: () => void;
  cancellingBeGrace?: boolean;
}) {
  const [, forceTick] = useState(0);
  const active = !!live.sl_grace_active && !!live.sl_grace_deadline;
  const beActive = !!live.be_grace_active && !!live.be_grace_deadline;

  useEffect(() => {
    if (!active && !beActive) return;
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [active, beActive]);

  // Post-TP1 breakeven grace — honest about which timer is running: this is
  // the breakeven stop's short grace, not the SL timer (which never applies
  // after TP1).
  if (beActive) {
    const left = Math.max(0, Math.round((new Date(live.be_grace_deadline!).getTime() - Date.now()) / 1000));
    return (
      <View style={[styles.slGraceBanner, { backgroundColor: '#FF9F0A16' }]}>
        <Ionicons name="timer-outline" size={13} color="#FF9F0A" />
        <Text style={[styles.slGraceBannerText, { color: '#FF9F0A' }]}>
          Breakeven check in {left}s — sells if still below
        </Text>
        <Text style={[styles.slGraceSubText, { color: colors.textSecondary }]}>
          below the original stop sells immediately
        </Text>
        {onCancelBeGrace && (
          <Pressable
            onPress={onCancelBeGrace}
            disabled={cancellingBeGrace}
            hitSlop={8}
            style={[styles.cancelBtn, { borderColor: '#FF9F0A66', opacity: cancellingBeGrace ? 0.5 : 1 }]}
          >
            <Text style={styles.cancelBtnText}>{cancellingBeGrace ? 'Cancelling…' : 'Cancel timer'}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!active) {
    if (live.tp1_hit) {
      // After TP1 the SL timer no longer applies — say what does.
      if (!live.be_grace_seconds) return null;
      return (
        <View style={styles.slGraceRow}>
          <Ionicons name="shield-checkmark-outline" size={12} color={colors.textTertiary} />
          <Text style={[styles.slGraceText, { color: colors.textTertiary }]}>
            Breakeven stop has {live.be_grace_seconds}s grace
          </Text>
        </View>
      );
    }
    if (!live.sl_grace_enabled || live.sl_grace_minutes == null) return null;
    return (
      <View style={styles.slGraceRow}>
        <Ionicons name="shield-checkmark-outline" size={12} color={colors.textTertiary} />
        <Text style={[styles.slGraceText, { color: colors.textTertiary }]}>
          Initial stop has {live.sl_grace_minutes}m grace (until TP1)
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
  const showFloor = live.sl_floor_enabled !== false && live.sl_outer_floor != null;

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
      {showFloor && (
        <Text style={[styles.slGraceSubText, { color: colors.textSecondary }]}>
          floor ${live.sl_outer_floor!.toFixed(2)} — sells no matter what
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
  cancelBtn: { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  cancelBtnText: { color: '#FF9F0A', fontSize: 12, fontWeight: '700' },
  slGraceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  slGraceText: { fontSize: 11, fontWeight: '600' },

  slGraceBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10,
  },
  slGraceBannerText: { fontSize: 12, fontWeight: '700' },
  slGraceSubText:    { fontSize: 10 },
});
