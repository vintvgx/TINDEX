import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform, UIManager } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { formatContractSymbolShort, getTradeHorizon } from '@/lib/formatContract';
import { isMarketHours } from '@/lib/marketHours';
import { useCardTintDarkMode } from '@/hooks/useCardTintDarkMode';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { PositionInfoModal } from '@/common/components/strategy/PositionInfoModal';
import { SlGraceBadge, useSlGracePulse } from '@/common/components/strategy/SlGraceBadge';
import type { ProfileKey } from '@/common/types/strategy';

/** TP2's own accent — distinct from TP1's (colors.success) so a glance at
 *  the SL → TP1 → TP2 row tells the two targets apart at a glance, not just
 *  by position. */
const TP2_COLOR = '#0A84FF';

/** LivePriceData plus the market_value the header displays — computed via
 *  fallback (mid_price * qty_remaining * 100) since the live WS payload
 *  doesn't declare it on the type (even though some payloads do include it). */
type DisplayData = LivePriceData & { market_value?: number };

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** REST-snapshot fields to show immediately, before (or if) the live WS ever ticks. */
export interface LivePositionStaticFallback {
  contract?: string;
  entry_premium?: number;
  mid_price?: number;
  qty_remaining?: number;
  pnl?: number;
  pnl_pct?: number;
  hard_stop?: number;
  tp1?: number;
  tp2?: number;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  use_tp2?: boolean;
  sl_grace_enabled?: boolean;
  sl_grace_minutes?: number | null;
  sl_enabled?: boolean;
  tp_enabled?: boolean;
  runner_mode?: 'trail' | 'be_hold' | 'none';
  runner_trail?: number;
  cascade_enabled?: boolean;
}

interface LivePositionPanelProps {
  live: LivePriceData | null | undefined;
  /** Shown immediately (and used if the WS never connects, e.g. mock/preview mode). */
  staticFallback?: LivePositionStaticFallback;
  streaming: boolean;
  /** True for a mock/preview position with no real WS to connect to — shows "PREVIEW" instead of LIVE/CONNECTING. */
  isMock?: boolean;
  accentColor: string;
  strategyId: string;
  ticker: string;
  direction?: 'CALL' | 'PUT';
  paperMode?: boolean;
  onExitPress: () => void;
  /** Opens the add-to-position (average down/up) modal. Omit to hide the button
   *  entirely — used by surfaces that don't yet support adding to a position. */
  onAddPress?: () => void;
  /** Drives the NO_STOP_LOSS legacy display treatment — see noSL below. */
  profile?: string;
  colors: any;
  /** Merges a submitted stop/TP edit straight into the WS `live` snapshot so
   *  it's reflected immediately instead of waiting on the next price tick. */
  patchData?: (patch: Partial<LivePriceData>) => void;
  /** Stable per-trade key for the client-only hide feature — see
   *  lib/positionHideKey.ts. Passed straight through to PositionInfoModal. */
  hideKey: string;
}

/**
 * A single open position — Robinhood-inspired: one hero number (market
 * value), one colored P&L line, a muted entry→current/qty caption, nothing
 * else permanently on screen. Tapping the card opens PositionInfoModal,
 * which is now the single surface for both viewing full detail AND making
 * quick edits (stop/TP price, SL/TP on-off, qty split, runner) — this used
 * to be split across an inline "expand" section plus a separate
 * EditExitsModal; consolidating removes that duplication and the extra tap
 * to get from "view" to "edit". Exit (and Add, if offered) stay as small
 * icon buttons directly on the card since they're the two actions taken
 * without needing any other context first.
 */
export function LivePositionPanel({
  live, staticFallback, streaming, isMock, accentColor,
  strategyId, ticker, direction, paperMode, onExitPress, onAddPress, profile,
  colors, patchData, hideKey,
}: LivePositionPanelProps) {
  const isNoStopLoss = profile === 'NO_STOP_LOSS';
  const { enabled: darkTintEnabled } = useCardTintDarkMode();
  const [infoVisible, setInfoVisible] = useState(false);

  const hasFallback =
    staticFallback?.entry_premium != null &&
    staticFallback?.hard_stop != null &&
    staticFallback?.tp1 != null;

  // Merge live over the REST snapshot — the card renders immediately with
  // whatever position.tsx already had from its poll, then upgrades in place
  // the moment the WS connects, instead of a blank spinner the whole time.
  const display: DisplayData | undefined = live ?? (hasFallback
    ? {
        contract:      staticFallback!.contract ?? '',
        entry_premium: staticFallback!.entry_premium!,
        mid_price:     staticFallback!.mid_price ?? staticFallback!.entry_premium!,
        pnl:           staticFallback!.pnl ?? 0,
        pnl_pct:       staticFallback!.pnl_pct ?? 0,
        qty_remaining: staticFallback!.qty_remaining ?? 0,
        tp1_hit:       staticFallback!.tp1_hit ?? false,
        tp2_hit:       staticFallback!.tp2_hit ?? false,
        hard_stop:     staticFallback!.hard_stop!,
        tp1:           staticFallback!.tp1!,
        tp2:           staticFallback!.tp2 ?? staticFallback!.tp1!,
        use_tp2:       staticFallback!.use_tp2,
        sl_grace_enabled: staticFallback!.sl_grace_enabled,
        sl_grace_minutes: staticFallback!.sl_grace_minutes,
        sl_enabled:    staticFallback!.sl_enabled,
        tp_enabled:    staticFallback!.tp_enabled,
        runner_mode:   staticFallback!.runner_mode,
        runner_trail:  staticFallback!.runner_trail,
        cascade_enabled: staticFallback!.cascade_enabled,
        market_value:  (staticFallback!.mid_price ?? staticFallback!.entry_premium!) * (staticFallback!.qty_remaining ?? 0) * 100,
      }
    : undefined);

  // Absent on older cached data → default to showing TP2 (matches the
  // pre-use_tp2 behavior) rather than hiding a value that might be real.
  const showTp2 = display?.use_tp2 !== false;
  // sl_enabled/tp_enabled default true when absent (older cached data,
  // pre-toggle trades). See ExitManager.to_dict().
  const slEnabled = display?.sl_enabled !== false;
  const tpEnabled = display?.tp_enabled !== false;
  const noSL = isNoStopLoss || !slEnabled;

  const showSL  = !noSL && !!display && display.hard_stop > 0;
  const showTp1 = tpEnabled && !!display && display.tp1 > 0;
  const showTp2Chip = tpEnabled && showTp2 && !!display && display.tp2 > 0 && display.tp2 !== display.tp1;
  const slPulseStyle = useSlGracePulse(!!display?.sl_grace_active);

  const pnlColor = display
    ? (display.pnl >= 0 ? colors.success : colors.error)
    : colors.tabBarInactive;

  // marketOpen must win over `streaming`: the WS is a socket to our own
  // backend, not to Alpaca's market feed directly, so it can — and does —
  // stay connected outside market hours with no real ticks flowing through
  // it. A swing/LEAPS position held overnight or over a weekend still needs
  // a non-live status dot, but never a "live" one while the market's closed.
  const marketOpen  = isMarketHours();
  const isLive = isMock ? false : marketOpen && streaming;
  const statusColor = isMock ? colors.accent : isLive ? colors.success : colors.tabBarInactive;
  const marketValue = display ? (display.market_value ?? display.mid_price * display.qty_remaining * 100) : null;

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setInfoVisible(true)}
        style={[
          styles.card,
          {
            // Light mode's plain background matched the screen exactly, so
            // the card visually disappeared — wash it with a soft tint of
            // the direction color instead. Dark mode defaults to plain
            // colors.background (already reads fine there); the same tint
            // is opt-in via the Profile "Tint Cards in Dark Mode" setting.
            // No hard border — Robinhood-style cards separate by tint +
            // spacing, not a boxed outline.
            backgroundColor: !colors.isDark || darkTintEnabled ? accentColor + '0D' : colors.surface,
          },
        ]}
      >
        {/* ── Top row: status dot · contract · flags  |  Add · Exit ── */}
        <View style={styles.topRow}>
          <View style={styles.topLeft}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            {display && (
              <Text style={[styles.contract, { color: colors.textSecondary }]} numberOfLines={1}>
                {formatContractSymbolShort(display.contract)}
              </Text>
            )}
            {display && !slEnabled && <Ionicons name="shield-outline" size={12} color={colors.error} />}
            {display && !tpEnabled && <Ionicons name="flag-outline" size={12} color="#FF9F0A" />}
          </View>
          {!isMock && (
            <View style={styles.topRight}>
              {onAddPress && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation(); onAddPress(); }}
                  hitSlop={8}
                  activeOpacity={0.7}
                  style={[styles.iconBtn, { backgroundColor: colors.text + '0F' }]}
                >
                  <Ionicons name="add" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation(); onExitPress(); }}
                hitSlop={8}
                activeOpacity={0.7}
                style={[styles.iconBtn, { backgroundColor: colors.error + '14' }]}
              >
                <Ionicons name="close" size={16} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {display ? (
          <>
            {/* ── Hero: market value, then colored P&L ── */}
            <Text style={[styles.heroValue, { color: colors.text }]}>
              {marketValue != null ? `$${marketValue.toFixed(2)}` : '—'}
            </Text>
            <View style={styles.pnlRow}>
              <Text style={[styles.pnlValue, { color: pnlColor }]}>
                {display.pnl >= 0 ? '+' : ''}${display.pnl.toFixed(2)}
              </Text>
              <View style={[styles.pnlPctPill, { backgroundColor: pnlColor + '1A' }]}>
                <Text style={[styles.pnlPctText, { color: pnlColor }]}>
                  {display.pnl_pct >= 0 ? '+' : ''}{display.pnl_pct.toFixed(1)}%
                </Text>
              </View>
            </View>

            {/* ── Caption row: entry → current · qty on the left, SL · TP1 ·
                TP2 flexed to the right — the exit levels are the more
                important read of the two, so they get the fixed (never
                truncated) side; the caption itself truncates first if the
                row runs out of room. ── */}
            <View style={styles.captionRow}>
              <Text style={[styles.caption, { color: colors.textTertiary }]} numberOfLines={1}>
                ${display.entry_premium.toFixed(2)} → ${display.mid_price.toFixed(2)}
                {'  ·  Qty '}{display.qty_remaining}
                {paperMode ? '  ·  Paper' : ''}
              </Text>

              {(showSL || showTp1 || showTp2Chip) && (
                <View style={styles.exitsRow}>
                  {showSL && (
                    <Animated.View style={[styles.exitChip, slPulseStyle]}>
                      <Text style={[styles.exitLabel, { color: colors.error }]}>SL</Text>
                      <Text style={[styles.exitPrice, { color: colors.error }]}>
                        ${display.hard_stop.toFixed(2)}
                      </Text>
                    </Animated.View>
                  )}
                  {showTp1 && (
                    <>
                      {showSL && <Text style={[styles.exitArrow, { color: colors.textTertiary }]}>→</Text>}
                      <View style={styles.exitChip}>
                        <Text style={[styles.exitLabel, { color: colors.success }]}>TP1</Text>
                        <Text style={[styles.exitPrice, { color: colors.success }]}>
                          ${display.tp1.toFixed(2)}
                        </Text>
                        {display.tp1_hit && <Ionicons name="checkmark-circle" size={10} color={colors.success} />}
                      </View>
                    </>
                  )}
                  {showTp2Chip && (
                    <>
                      <Text style={[styles.exitArrow, { color: colors.textTertiary }]}>·</Text>
                      <View style={styles.exitChip}>
                        <Text style={[styles.exitLabel, { color: TP2_COLOR }]}>TP2</Text>
                        <Text style={[styles.exitPrice, { color: TP2_COLOR }]}>
                          ${display.tp2.toFixed(2)}
                        </Text>
                        {display.tp2_hit && <Ionicons name="checkmark-circle" size={10} color={TP2_COLOR} />}
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>

            {/* SL grace-timer countdown — urgent, so it stays on the card
                instead of behind a tap into the info sheet. */}
            {!noSL && <SlGraceBadge live={display} colors={colors} />}
          </>
        ) : (
          <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 10 }} />
        )}
      </TouchableOpacity>

      {display && (
        <PositionInfoModal
          visible={infoVisible}
          onClose={() => setInfoVisible(false)}
          colors={colors}
          profile={profile as ProfileKey | undefined}
          strategyId={strategyId}
          onUpdated={patchData}
          hideKey={hideKey}
          data={{
            ticker,
            direction,
            contract: display.contract,
            paperMode,
            isSwing: getTradeHorizon(display.contract) === 'SWING',
            entry_premium: display.entry_premium,
            mid_price: display.mid_price,
            qty_remaining: display.qty_remaining,
            pnl: display.pnl,
            pnl_pct: display.pnl_pct,
            hard_stop: display.hard_stop,
            tp1: display.tp1,
            tp2: display.tp2,
            tp1_hit: display.tp1_hit,
            tp2_hit: display.tp2_hit,
            showTp2,
            slEnabled,
            tpEnabled,
            sl_grace_enabled: display.sl_grace_enabled,
            sl_grace_minutes: display.sl_grace_minutes,
            sl_grace_active: display.sl_grace_active,
            sl_grace_deadline: display.sl_grace_deadline,
            sl_recovery_deadline: display.sl_recovery_deadline,
            runner_mode: display.runner_mode,
            runner_trail: display.runner_trail,
            cascade_enabled: display.cascade_enabled,
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    marginTop: 10,
    gap: 2,
  },
  topRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  topLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  contract:  { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, flexShrink: 1 },
  iconBtn:   { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  heroValue: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  pnlRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  pnlValue:  { fontSize: 15, fontWeight: '700' },
  pnlPctPill:{ borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pnlPctText:{ fontSize: 11, fontWeight: '700' },

  captionRow: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 8, rowGap: 4, columnGap: 8,
  },
  caption: { fontSize: 12, flexShrink: 1 },

  exitsRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  exitChip:  { flexDirection: 'row', alignItems: 'center', gap: 2 },
  exitLabel: { fontSize: 9.5, fontWeight: '700', opacity: 0.8 },
  exitPrice: { fontSize: 11, fontWeight: '700' },
  exitArrow: { fontSize: 10 },
});
