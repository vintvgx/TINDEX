import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EditExitsButton } from '@/common/components/shared/EditExitsButton';
import { formatContractSymbolShort, getTradeHorizon } from '@/lib/formatContract';
import { isMarketHours } from '@/lib/marketHours';
import { useCardTintDarkMode } from '@/hooks/useCardTintDarkMode';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { PROFILE_EMOJI } from '@/common/components/strategy/PositionCard';
import { ProfileGuideModal } from '@/common/components/strategy/ProfileGuideModal';
import type { ProfileKey } from '@/common/types/strategy';
import { RUNNER_MODE_LABEL } from '@/common/utils/strategy/runnerModeLabel';

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
  runner_mode?: 'trail' | 'be_hold' | 'none';
  runner_trail?: number;
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
  paperMode?: boolean;
  onExitPress: () => void;
  /** Opens the add-to-position (average down/up) modal. Omit to hide the button
   *  entirely — used by surfaces that don't yet support adding to a position. */
  onAddPress?: () => void;
  /** Drives the "No Stop Loss" display treatment (hides numeric Stop/TP1/TP2
   *  — none of them can ever fire for that profile — in favor of a plain
   *  "hold until you manually sell" badge) and, together with `use_tp2`,
   *  whether TP2 is shown at all. */
  profile?: string;
  colors: any;
  /** Merges a submitted stop/TP edit straight into the WS `live` snapshot so
   *  it's reflected immediately instead of waiting on the next price tick. */
  patchData?: (patch: Partial<LivePriceData>) => void;
  /** Stable per-trade key for the client-only hide feature — see
   *  lib/positionHideKey.ts. Passed straight through to EditExitsButton. */
  hideKey: string;
}

/**
 * The same live-position display used for an active trade within a saved
 * Strategy (originally built inline in strategy.tsx's StrategyCard/
 * ImmediatePositionCard) — extracted here so the Live Positions page
 * (position.tsx) can show positions identically instead of the older,
 * static PositionCard. strategy.tsx is untouched; this is a fresh copy of
 * that same visual pattern so porting it carries no risk to the working
 * Strategy screen.
 */
export function LivePositionPanel({
  live, staticFallback, streaming, isMock, accentColor,
  strategyId, ticker, paperMode, onExitPress, onAddPress, profile,
  colors, patchData, hideKey,
}: LivePositionPanelProps) {
  const isNoStopLoss = profile === 'NO_STOP_LOSS';
  const { enabled: darkTintEnabled } = useCardTintDarkMode();
  const [expanded, setExpanded] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  }, []);

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
        runner_mode:   staticFallback!.runner_mode,
        runner_trail:  staticFallback!.runner_trail,
        market_value:  (staticFallback!.mid_price ?? staticFallback!.entry_premium!) * (staticFallback!.qty_remaining ?? 0) * 100,
      }
    : undefined);

  // Absent on older cached data → default to showing TP2 (matches the
  // pre-use_tp2 behavior) rather than hiding a value that might be real.
  // NOT gated on isNoStopLoss — a NO_STOP_LOSS position's SL/TP1/TP2 are
  // real, editable numbers the moment the user sets them via Edit (see
  // EditExitsModal), so they're always shown like any other position;
  // use_tp2 alone (profile flag or the qty<=1 hard override) still governs
  // whether TP2 specifically is reachable for this trade.
  const showTp2 = display?.use_tp2 !== false;

  const pnlColor = display
    ? (display.pnl >= 0 ? colors.success : colors.error)
    : colors.tabBarInactive;

  // marketOpen must win over `streaming`: the WS is a socket to our own
  // backend, not to Alpaca's market feed directly, so it can — and does —
  // stay connected outside market hours with no real ticks flowing through
  // it. Checking `streaming` first showed "LIVE" the moment that socket
  // connected regardless of market hours, which is exactly backwards — a
  // swing/LEAPS position held overnight or over a weekend still needs
  // "CONNECTING" to resolve to something (hence the marketOpen fallback
  // below), but never to "LIVE" while the market itself is closed.
  const marketOpen  = isMarketHours();
  const statusLabel = isMock ? 'PREVIEW' : !marketOpen ? 'MARKET CLOSED' : streaming ? 'LIVE' : 'CONNECTING';
  const statusColor = isMock ? colors.accent : (marketOpen && streaming) ? colors.success : colors.tabBarInactive;

  return (
    <View
      style={[
        styles.livePnlCard,
        {
          // Light mode's card background matched the screen background
          // exactly, so the card visually disappeared — wash it with the
          // same green/red as the border instead. Dark mode defaults to
          // plain colors.background (it already read fine there); the same
          // tint is opt-in via the Profile "Tint Cards in Dark Mode" setting.
          backgroundColor: !colors.isDark || darkTintEnabled ? accentColor + '0F' : colors.background,
          borderColor: accentColor + '99',
        },
      ]}
    >
      {/* ── Header (tap anywhere to expand): status + contract | P&L | chart · chevron ── */}
      <TouchableOpacity onPress={toggleExpanded} activeOpacity={0.7} style={styles.liveHeaderRow}>
        <View style={styles.liveHeaderLeft}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.liveLabel, { color: statusColor }]}>{statusLabel}</Text>
          {/* Profile badge — tap opens the same Profile Guide used elsewhere,
              pre-jumped to this trade's profile via initialKey. */}
          {!!profile && (
            <TouchableOpacity
              onPress={() => setInfoVisible(true)}
              hitSlop={6}
              activeOpacity={0.7}
              style={styles.profileBadge}
            >
              <Text style={styles.profileEmoji}>{PROFILE_EMOJI[profile as ProfileKey] ?? '⚙️'}</Text>
              <Ionicons name="information-circle-outline" size={13} color={colors.tabBarInactive} />
            </TouchableOpacity>
          )}
          {display && (
            <Text style={[styles.liveContract, { color: colors.text }]} numberOfLines={1}>
              {formatContractSymbolShort(display.contract)}
            </Text>
          )}
          {display && getTradeHorizon(display.contract) === 'SWING' && (
            <View style={[styles.swingBadge, { backgroundColor: '#A855F722' }]}>
              <Text style={[styles.swingBadgeText, { color: '#A855F7' }]}>SWING</Text>
            </View>
          )}
        </View>
        {display && (
          <View style={styles.liveHeaderRight}>
            <Text style={[styles.livePnlValue, { color: pnlColor }]}>
              {display.pnl >= 0 ? '+' : ''}${display.pnl.toFixed(2)}
            </Text>
            <View style={[styles.pnlPctPill, { backgroundColor: pnlColor + '1A' }]}>
              <Text style={[styles.pnlPctText, { color: pnlColor }]}>
                {display.pnl_pct >= 0 ? '+' : ''}{display.pnl_pct.toFixed(1)}%
              </Text>
            </View>
          </View>
        )}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.tabBarInactive}
          style={{ marginLeft: 10 }}
        />
      </TouchableOpacity>

      {display ? (
        <>
          {/* ── Compact summary — the one always-visible line, so a screen of
              several open trades stays scannable. Everything else (stop bar,
              detail rows, action buttons) lives behind the expand. ── */}
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryText, { color: colors.textSecondary }]} numberOfLines={1}>
              ${display.entry_premium.toFixed(2)} → <Text style={{ color: colors.text, fontWeight: '700' }}>${display.mid_price.toFixed(2)}</Text>
              {'  ·  Qty '}{display.qty_remaining}
              {`  ·  Stop $${display.hard_stop.toFixed(2)}`}
              {display.tp1_hit ? '  ·  ' : ''}
              {display.tp1_hit && <Text style={{ color: colors.success, fontWeight: '700' }}>TP1 ✓</Text>}
              {showTp2 && display.tp2_hit ? '  ' : ''}
              {showTp2 && display.tp2_hit && <Text style={{ color: colors.success, fontWeight: '700' }}>TP2 ✓</Text>}
            </Text>
            <Text style={[styles.mktValText, { color: colors.textSecondary }]}>
              Mkt ${(display.market_value ?? display.mid_price * display.qty_remaining * 100).toFixed(0)}
            </Text>
          </View>

          {/* SL grace-timer countdown — urgent, so never hidden behind the
              expand (SL_5/SL_10 — see exit_manager.py) */}
          {!isNoStopLoss && <SlGraceBadge live={display} colors={colors} />}

          {expanded && (
            <>
              {/* SL/TP1/TP2 are always shown — even for NO_STOP_LOSS, whose
                  defaults are unreachable placeholders (see profiles.py)
                  until the user sets real ones via Edit, at which point
                  they're genuine, live levels like any other position. */}
              <PositionStopBar live={display} colors={colors} showTp2={showTp2} />
              <LivePositionDetail live={display} colors={colors} showTp2={showTp2} />

              {/* ── Actions: Edit | Add | Exit (chart lives in the header) ── */}
              {!isMock && (
                <View style={styles.liveActionsRow}>
                  <EditExitsButton
                    mode="orb"
                    strategy_id={strategyId}
                    ticker={ticker}
                    hard_stop={display.hard_stop}
                    tp1={display.tp1}
                    tp2={display.tp2}
                    entry_premium={display.entry_premium}
                    tp1_hit={display.tp1_hit}
                    tp2_hit={display.tp2_hit}
                    qty_remaining={display.qty_remaining}
                    use_tp2={showTp2}
                    sl_grace_enabled={display.sl_grace_enabled}
                    sl_grace_minutes={display.sl_grace_minutes}
                    runner_mode={display.runner_mode}
                    cascade_enabled={display.cascade_enabled}
                    hideKey={hideKey}
                    onUpdated={patchData}
                    style={{ flex: 1 }}
                  />
                  {onAddPress && (
                    <TouchableOpacity
                      onPress={onAddPress}
                      activeOpacity={0.8}
                      style={[styles.exitBtn, { flex: 1, marginTop: 0, borderColor: accentColor + '55', backgroundColor: accentColor + '14' }]}
                    >
                      <Ionicons name="add-circle-outline" size={16} color={accentColor} />
                      <Text style={[styles.exitBtnText, { color: accentColor }]}>Add</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={onExitPress}
                    activeOpacity={0.8}
                    style={[styles.exitBtn, { flex: 1, marginTop: 0, borderColor: colors.error + '55', backgroundColor: colors.error + '14' }]}
                  >
                    <Ionicons name="exit-outline" size={16} color={colors.error} />
                    <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </>
      ) : (
        <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
      )}

      {!!profile && (
        <ProfileGuideModal
          visible={infoVisible}
          onClose={() => setInfoVisible(false)}
          colors={colors}
          initialKey={profile as ProfileKey}
        />
      )}
    </View>
  );
}

function PositionStopBar({ live, colors, showTp2 }: { live: DisplayData; colors: any; showTp2: boolean }) {
  // Once TP1 has fired and there's no live numeric target left to hit
  // (no TP2 at all, or TP2 already hit too), whatever's left is a genuine
  // runner — governed by runner_mode (trail/be_hold/none), not a fixed
  // price. Showing a stale "TP1" readout there is misleading (that job is
  // done); relabel the slot to what's actually happening instead. No longer
  // gated on qty_remaining === 1 (2026-08-07): trail now sells one contract
  // at a time on each confirmed dip (see ExitManager.evaluate()) rather than
  // closing the whole runner at once, so 2+ contracts can be "the runner"
  // simultaneously, not just the literal last one. A fresh 1-contract ENTRY
  // (tp1_hit still false) is NOT a runner — TP1 still fully closes it the
  // moment it hits, so it keeps showing real Stop/TP1 numbers exactly like
  // any other position.
  const isRunnerPhase = live.tp1_hit && (!showTp2 || live.tp2_hit);

  // Trail mode shows its live ratcheting floor price (same "$X.XX" shape as
  // Stop/TP1/TP2) instead of just the mode label — otherwise the only way to
  // see where the trail actually sits was watching the position get sold.
  const runnerValue = live.runner_mode === 'trail' && live.runner_trail != null
    ? `Trail $${live.runner_trail.toFixed(2)}`
    : RUNNER_MODE_LABEL[live.runner_mode ?? 'trail'];

  const stages = isRunnerPhase
    ? [
        { label: 'Stop',   value: `$${live.hard_stop.toFixed(2)}`, active: true, color: colors.error },
        { label: 'Runner', value: runnerValue, active: true, color: '#A855F7' },
      ]
    : [
        { label: 'Stop', value: `$${live.hard_stop.toFixed(2)}`, active: !live.tp1_hit, color: colors.error },
        { label: 'TP1',  value: `$${live.tp1.toFixed(2)}`,       active: live.tp1_hit && !live.tp2_hit, color: '#4A9EFF' },
        ...(showTp2 ? [{ label: 'TP2', value: `$${live.tp2.toFixed(2)}`, active: live.tp2_hit, color: colors.success }] : []),
      ];
  return (
    <View style={styles.stopBar}>
      {stages.map((s, i) => (
        <View key={i} style={styles.stopStage}>
          <View style={[styles.stopDot, { backgroundColor: s.active ? s.color : colors.border }]} />
          <Text style={[styles.stopLabel, { color: s.active ? s.color : colors.textSecondary }]}>{s.label}</Text>
          <Text style={[styles.stopValue, { color: colors.textSecondary }]}>{s.value}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * SL grace indicator — two states:
 *  - Idle: a persistent, low-key badge showing this position's PRE-TP1 stop
 *    has a confirmation window at all (e.g. REVERSAL's default 5-min/3-bar
 *    grace — see profiles.py). Without this there was no way to know a
 *    position had grace protection until it was already actively breaching
 *    (the countdown below), or by opening Edit Exits — easy to mistake for
 *    "no grace configured" (2026-08-07). Hidden once tp1_hit: grace only
 *    ever applies to the pre-TP1 hard stop (see ExitManager.evaluate() —
 *    "not self.be_stop_active"), so showing this after TP1 would claim
 *    protection the post-TP1 breakeven stop doesn't actually have.
 *  - Active: countdown for an in-progress grace window. Never runs its own
 *    independent clock — every render recomputes `deadline - Date.now()` off
 *    the backend's absolute timestamp (sl_grace_deadline), so this can't
 *    drift from the engine actually deciding when to force-sell. The
 *    setInterval here only forces a re-render each second; it holds no
 *    state of its own.
 */
function SlGraceBadge({ live, colors }: { live: DisplayData; colors: any }) {
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
      <View style={[styles.slGraceBadge, { backgroundColor: colors.textTertiary + '14', borderColor: colors.textTertiary + '40' }]}>
        <Ionicons name="shield-checkmark-outline" size={12} color={colors.textSecondary} />
        <Text style={[styles.slGraceText, { color: colors.textSecondary }]}>
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
    <View style={[styles.slGraceBadge, { backgroundColor: color + '1A', borderColor: color + '55' }]}>
      <Ionicons name="timer-outline" size={13} color={color} />
      <Text style={[styles.slGraceText, { color }]}>
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

function LivePositionDetail({ live, colors, showTp2 }: { live: DisplayData; colors: any; showTp2: boolean }) {
  return (
    <View style={[styles.liveDetail, { borderTopColor: colors.border }]}>
      <LiveDetailRow label="Entry"     value={`$${live.entry_premium.toFixed(2)}`} colors={colors} />
      <LiveDetailRow label="Current"   value={`$${live.mid_price.toFixed(2)}`} valueColor={colors.text} colors={colors} />
      <LiveDetailRow label="Qty Remaining" value={String(live.qty_remaining)} colors={colors} />
      <LiveDetailRow label="Hard Stop" value={`$${live.hard_stop.toFixed(2)}`} valueColor={colors.error} colors={colors} />
      <LiveDetailRow label="TP1" value={`$${live.tp1.toFixed(2)}`} badge={live.tp1_hit ? 'Hit' : undefined} badgeColor={colors.success} colors={colors} />
      {showTp2 && (
        <LiveDetailRow label="TP2" value={`$${live.tp2.toFixed(2)}`} badge={live.tp2_hit ? 'Hit' : undefined} badgeColor={colors.success} colors={colors} />
      )}
    </View>
  );
}

function LiveDetailRow({ label, value, valueColor, badge, badgeColor, colors }: {
  label: string; value: string; valueColor?: string; badge?: string; badgeColor?: string; colors: any;
}) {
  return (
    <View style={styles.liveDetailRow}>
      <Text style={[styles.liveDetailLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.liveDetailRight}>
        <Text style={[styles.liveDetailValue, { color: valueColor ?? colors.text }]}>{value}</Text>
        {badge && (
          <View style={[styles.liveDetailBadge, { backgroundColor: (badgeColor ?? colors.accent) + '22' }]}>
            <Text style={[styles.liveDetailBadgeText, { color: badgeColor ?? colors.accent }]}>{badge}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  livePnlCard:     { borderRadius: 12, borderWidth: 1.5, padding: 12, marginTop: 10 },
  liveHeaderRow:   { flexDirection: 'row', alignItems: 'center' },
  liveHeaderLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  liveHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:       { width: 6, height: 6, borderRadius: 3 },
  liveLabel:       { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  profileBadge:    { flexDirection: 'row', alignItems: 'center', gap: 2 },
  profileEmoji:    { fontSize: 12 },
  liveContract:    { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  swingBadge:      { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  swingBadgeText:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  livePnlValue:    { fontSize: 15, fontWeight: '700' },
  pnlPctPill:      { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  pnlPctText:      { fontSize: 10, fontWeight: '700' },
  mktValText:      { fontSize: 10 },

  summaryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, marginTop: 8,
  },
  summaryText: { fontSize: 11, flexShrink: 1 },

  stopBar:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 6 },
  stopStage: { flex: 1, alignItems: 'center', gap: 2 },
  stopDot:   { width: 6, height: 6, borderRadius: 3 },
  stopLabel: { fontSize: 9, fontWeight: '700' },
  stopValue: { fontSize: 10 },

  slGraceBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginTop: 8,
  },
  slGraceText:    { fontSize: 11, fontWeight: '700' },
  slGraceSubText: { fontSize: 10 },

  liveDetail:      { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10, gap: 6 },
  liveDetailRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveDetailLabel: { fontSize: 12 },
  liveDetailRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDetailValue: { fontSize: 12, fontWeight: '600' },
  liveDetailBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  liveDetailBadgeText: { fontSize: 10, fontWeight: '700' },

  liveActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  exitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 8, paddingVertical: 9,
  },
  exitBtnText: { fontSize: 13, fontWeight: '700' },
});
