import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import {
  useConfirmBriefPlay, useSetBriefPlayMode, useSkipBriefPlay,
} from '@/hooks/mutations/brief/useBriefPlayActions';
import type { BriefPlay, BriefPlayStatus } from '@/common/types/morningBrief';

const STALE_PCT = 0.003;   // same 0.3% no-chase / drift band as entry_rules.py

interface Props {
  play: BriefPlay;
  colors: any;
  /** ms to add to Date.now() to get the server's clock */
  clockOffsetMs: number;
  onOpenChart: (play: BriefPlay) => void;
}

/**
 * One morning-brief play: the if/then setup (trigger → target, invalid),
 * its score and technicals, the per-play Confirm/Auto toggle, and — once
 * the play triggers — the confirm card (3-min countdown, Confirm/Skip) or
 * the limit-order tracking card (limit, elapsed wait, auto-cancel countdown,
 * underlying vs trigger). Tapping the setup opens the chart.
 */
export function BriefPlayCard({ play, colors, clockOffsetMs, onOpenChart }: Props) {
  const isLong = play.direction === 'CALL';
  const dirColor = isLong ? colors.success : colors.error;
  const live = ['checking', 'awaiting_confirmation', 'working'].includes(play.status);
  const ended = TERMINAL.has(play.status);

  return (
    <View style={[
      styles.card,
      { backgroundColor: colors.surface, borderColor: live ? '#F59E0B88' : colors.border, opacity: ended && play.status !== 'filled' ? 0.72 : 1 },
    ]}>
      <TouchableOpacity activeOpacity={0.8} onPress={() => onOpenChart(play)}>
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <Text style={[styles.ticker, { color: colors.text }]}>{play.ticker}</Text>
            <Badge label={isLong ? 'LONG · CALL' : 'SHORT · PUT'} color={dirColor} />
            <Badge label="PAPER · 0DTE" color="#FF9F0A" />
          </View>
          <ScorePill score={play.score} colors={colors} />
        </View>

        <View style={styles.levels}>
          <LevelRow
            label="Trigger"
            value={play.trigger}
            note={`1m close ${isLong ? 'above' : 'below'} on ≥1.2× vol`}
            color={colors.text}
            colors={colors}
          />
          <LevelRow label="Target" value={play.target} note={`+$${play.expected_move.toFixed(2)} move · ${play.reward_risk.toFixed(1)}R`} color={colors.success} colors={colors} />
          <LevelRow label="Invalid" value={play.invalidation} note="hard kill level" color={colors.error} colors={colors} />
        </View>

        <View style={styles.techRow}>
          <TechChip label="Trend" value={play.technicals.trend ?? '—'} colors={colors}
            good={play.technicals.trend === (isLong ? 'Bullish' : 'Bearish')} />
          <TechChip label="RSI" value={play.technicals.rsi != null ? play.technicals.rsi.toFixed(0) : '—'} colors={colors} />
          <TechChip label="Gap" value={`${play.gap_pct >= 0 ? '+' : ''}${play.gap_pct.toFixed(2)}%`} colors={colors}
            good={isLong ? play.gap_pct > 0.3 : play.gap_pct < -0.3} />
          {play.technicals.sector ? <TechChip label="" value={play.technicals.sector} colors={colors} /> : null}
          <Ionicons name="stats-chart-outline" size={14} color={colors.textTertiary} style={{ marginLeft: 'auto' }} />
        </View>
      </TouchableOpacity>

      <StatusLine play={play} colors={colors} />

      {play.status === 'awaiting_confirmation' && (
        <ConfirmCard play={play} colors={colors} clockOffsetMs={clockOffsetMs} />
      )}
      {(play.status === 'working' || play.status === 'checking') && (
        <LimitOrderTracker play={play} colors={colors} clockOffsetMs={clockOffsetMs} />
      )}
      {play.order && ['filled', 'cancelled', 'scratch'].includes(play.status) && (
        <OrderResult play={play} colors={colors} />
      )}

      <ModeToggle play={play} colors={colors} />
    </View>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────

const TERMINAL = new Set<BriefPlayStatus>(['cut', 'stood_down', 'filled', 'cancelled', 'skipped', 'scratch', 'expired', 'error']);

const STATUS_META: Record<BriefPlayStatus, { label: string; icon: keyof typeof Ionicons.glyphMap; tone: 'muted' | 'live' | 'good' | 'bad' }> = {
  watching:              { label: 'Watching — locks at 9:28',      icon: 'eye-outline',              tone: 'muted' },
  armed:                 { label: 'Armed — waiting for trigger',   icon: 'radio-button-on-outline',  tone: 'live' },
  checking:              { label: 'Triggered — checking gate',     icon: 'hourglass-outline',        tone: 'live' },
  awaiting_confirmation: { label: 'Triggered — confirm entry',     icon: 'alert-circle-outline',     tone: 'live' },
  working:               { label: 'Limit order working',           icon: 'time-outline',             tone: 'live' },
  filled:                { label: 'Filled',                        icon: 'checkmark-circle',         tone: 'good' },
  cancelled:             { label: 'Order cancelled',               icon: 'close-circle-outline',     tone: 'bad' },
  scratch:               { label: 'Scratched (partial flattened)', icon: 'return-down-back-outline', tone: 'bad' },
  skipped:               { label: 'Skipped',                       icon: 'play-skip-forward-outline', tone: 'muted' },
  expired:               { label: 'Confirmation expired',          icon: 'timer-outline',            tone: 'muted' },
  stood_down:            { label: 'Stood down',                    icon: 'hand-left-outline',        tone: 'muted' },
  cut:                   { label: 'Cut at 9:28 lock',              icon: 'cut-outline',              tone: 'muted' },
  error:                 { label: 'Entry failed',                  icon: 'warning-outline',          tone: 'bad' },
};

function StatusLine({ play, colors }: { play: BriefPlay; colors: any }) {
  const meta = STATUS_META[play.status] ?? STATUS_META.watching;
  const color = meta.tone === 'good' ? colors.success : meta.tone === 'bad' ? colors.error
    : meta.tone === 'live' ? '#F59E0B' : colors.textSecondary;
  return (
    <View style={[styles.statusBox, { borderTopColor: colors.border }]}>
      <View style={styles.statusRow}>
        <Ionicons name={meta.icon} size={14} color={color} />
        <Text style={[styles.statusLabel, { color }]}>{meta.label}</Text>
      </View>
      {play.status_reason ? (
        <Text style={[styles.statusReason, { color: colors.textSecondary }]}>{play.status_reason}</Text>
      ) : null}
    </View>
  );
}

// ── Confirm card ───────────────────────────────────────────────────────────

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function ConfirmCard({ play, colors, clockOffsetMs }: { play: BriefPlay; colors: any; clockOffsetMs: number }) {
  const toast = useToast();
  const now = useNow() + clockOffsetMs;
  const confirm = useConfirmBriefPlay();
  const skip = useSkipBriefPlay();
  const busy = confirm.isPending || skip.isPending;
  const msLeft = play.confirm_expires_at ? new Date(play.confirm_expires_at).getTime() - now : 0;
  const total = 3 * 60 * 1000;

  return (
    <View style={[styles.subCard, { backgroundColor: '#F59E0B12', borderColor: '#F59E0B55' }]}>
      <View style={styles.subHeader}>
        <Text style={[styles.subTitle, { color: '#F59E0B' }]}>Gate ENTER · enter this play?</Text>
        <Text style={[styles.countdown, { color: msLeft < 30000 ? colors.error : '#F59E0B' }]}>
          {msLeft > 0 ? mmss(msLeft) : 'expiring…'}
        </Text>
      </View>
      <ProgressBar fraction={msLeft / total} color={msLeft < 30000 ? colors.error : '#F59E0B'} colors={colors} />
      <Text style={[styles.subNote, { color: colors.textSecondary }]}>
        Paper · 0DTE {play.direction === 'CALL' ? 'call' : 'put'} near the ${play.target.toFixed(2)} target · size by premium
        (≤$1.00 ×3, ≤$1.50 ×2, ≤$2.50 ×1) · limit order, auto-cancels in 75s
      </Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          disabled={busy}
          onPress={() => skip.mutate(play.ticker, {
            onSuccess: () => toast.info(`${play.ticker} skipped`),
            onError: (e) => toast.error(e.message),
          })}
          style={[styles.btn, { borderColor: colors.error + '55', backgroundColor: colors.error + '14' }]}
        >
          {skip.isPending ? <ActivityIndicator size="small" color={colors.error} /> : (
            <><Ionicons name="close-circle-outline" size={16} color={colors.error} />
              <Text style={[styles.btnText, { color: colors.error }]}>Skip</Text></>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          disabled={busy || msLeft <= 0}
          onPress={() => confirm.mutate(play.ticker, {
            onSuccess: () => toast.success(`${play.ticker} confirmed — placing limit order`),
            onError: (e) => toast.error(e.message),
          })}
          style={[styles.btn, { borderColor: colors.success + '55', backgroundColor: colors.success + '14', opacity: msLeft <= 0 ? 0.5 : 1 }]}
        >
          {confirm.isPending ? <ActivityIndicator size="small" color={colors.success} /> : (
            <><Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={[styles.btnText, { color: colors.success }]}>Confirm entry</Text></>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Limit-order tracking card ──────────────────────────────────────────────

function LimitOrderTracker({ play, colors, clockOffsetMs }: { play: BriefPlay; colors: any; clockOffsetMs: number }) {
  const now = (useNow(500) + clockOffsetMs) / 1000;
  const o = play.order;
  const working = o?.state === 'WORKING' && o.started_at != null;
  const timeout = o?.timeout ?? 75;
  const elapsed = working ? Math.max(0, now - (o!.started_at as number)) : 0;
  const left = Math.max(0, timeout - elapsed);

  const px = play.live_price;
  const distPct = px != null ? (px - play.trigger) / play.trigger : null;
  const nearDrift = distPct != null && Math.abs(distPct) > STALE_PCT * 0.75;

  return (
    <View style={[styles.subCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.subHeader}>
        <Text style={[styles.subTitle, { color: colors.text }]}>
          {play.status === 'checking' ? 'Checking guards + Technicals Gate…'
            : working ? 'Limit buy working' : 'Selecting contract…'}
        </Text>
        {working && (
          <Text style={[styles.countdown, { color: left < 15 ? colors.error : colors.text }]}>
            cancels in {Math.ceil(left)}s
          </Text>
        )}
      </View>

      {o?.symbol ? (
        <Text style={[styles.contractLine, { color: colors.textSecondary }]} numberOfLines={1}>
          {o.symbol} · ${o.strike} · ×{o.qty} · {o.profile?.replace(/_/g, ' ')}
        </Text>
      ) : null}

      {working && <ProgressBar fraction={left / timeout} color={left < 15 ? colors.error : colors.accent} colors={colors} />}

      <View style={styles.grid}>
        <Stat label="Limit" value={o?.limit != null ? `$${o.limit.toFixed(2)}` : '—'}
          sub={o?.limit_basis ? `at ${o.limit_basis}${o.spread_pct != null ? ` · ${o.spread_pct.toFixed(0)}% spread` : ''}` : undefined}
          colors={colors} />
        <Stat label="Waiting" value={working ? `${Math.floor(elapsed)}s` : '—'} sub={`of ${timeout}s`} colors={colors} />
        <Stat
          label="vs trigger"
          value={distPct != null ? `${distPct >= 0 ? '+' : ''}${(distPct * 100).toFixed(2)}%` : '—'}
          sub={px != null ? `$${px.toFixed(2)} / $${play.trigger.toFixed(2)}` : undefined}
          valueColor={nearDrift ? colors.error : undefined}
          colors={colors}
        />
      </View>
      <Text style={[styles.subNote, { color: colors.textTertiary }]}>
        Auto-cancels if unfilled at {timeout}s or if price moves more than 0.3% from the trigger.
        A partial fill is sold right away.
      </Text>
    </View>
  );
}

function OrderResult({ play, colors }: { play: BriefPlay; colors: any }) {
  const o = play.order!;
  const filled = play.status === 'filled';
  return (
    <View style={[styles.resultRow, { backgroundColor: (filled ? colors.success : colors.error) + '12' }]}>
      <Text style={[styles.resultText, { color: filled ? colors.success : colors.error }]} numberOfLines={2}>
        {filled
          ? `${o.symbol ?? ''} ×${o.filled_qty ?? o.qty} @ $${(o.avg_price ?? 0).toFixed(2)} · ${o.profile?.replace(/_/g, ' ') ?? ''} — managing exits`
          : `${o.symbol ?? 'Order'}${o.limit != null ? ` limit $${o.limit.toFixed(2)}` : ''} — ${o.reason ?? play.status_reason ?? ''}`}
      </Text>
    </View>
  );
}

// ── Mode toggle ────────────────────────────────────────────────────────────

function ModeToggle({ play, colors }: { play: BriefPlay; colors: any }) {
  const toast = useToast();
  const setMode = useSetBriefPlayMode();
  const editable = play.status === 'watching' || play.status === 'armed';
  if (!editable) return null;

  const choose = (mode: 'confirm' | 'auto') => {
    if (mode === play.mode || setMode.isPending) return;
    setMode.mutate({ ticker: play.ticker, mode }, {
      onSuccess: () => toast.info(mode === 'auto'
        ? `${play.ticker}: auto-enter on trigger (paper)`
        : `${play.ticker}: ask before entering`),
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <View style={styles.modeRow}>
      <Text style={[styles.modeLabel, { color: colors.textSecondary }]}>On trigger</Text>
      <View style={[styles.segment, { borderColor: colors.border, backgroundColor: colors.background }]}>
        {(['confirm', 'auto'] as const).map(m => {
          const active = play.mode === m;
          return (
            <TouchableOpacity
              key={m}
              onPress={() => choose(m)}
              style={[styles.segmentBtn, active && { backgroundColor: m === 'auto' ? '#F59E0B' : colors.accent }]}
            >
              <Text style={[styles.segmentText, { color: active ? '#000' : colors.textSecondary }]}>
                {m === 'confirm' ? 'Confirm first' : 'Auto-enter'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {setMode.isPending && <ActivityIndicator size="small" color={colors.accent} />}
    </View>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────────

const Badge = ({ label, color }: { label: string; color: string }) => (
  <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
    <Text style={[styles.badgeText, { color }]}>{label}</Text>
  </View>
);

function ScorePill({ score, colors }: { score: number; colors: any }) {
  const color = score >= 80 ? colors.success : score >= 65 ? '#F59E0B' : colors.textSecondary;
  return (
    <View style={[styles.scorePill, { borderColor: color + '66', backgroundColor: color + '18' }]}>
      <Text style={[styles.scoreValue, { color }]}>{Math.round(score)}</Text>
      <Text style={[styles.scoreUnit, { color }]}>/100</Text>
    </View>
  );
}

function LevelRow({ label, value, note, color, colors }: { label: string; value: number; note: string; color: string; colors: any }) {
  return (
    <View style={styles.levelRow}>
      <Text style={[styles.levelLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.levelValue, { color }]}>${value.toFixed(2)}</Text>
      <Text style={[styles.levelNote, { color: colors.textTertiary }]} numberOfLines={1}>{note}</Text>
    </View>
  );
}

function TechChip({ label, value, colors, good }: { label: string; value: string; colors: any; good?: boolean }) {
  return (
    <View style={[styles.chip, { borderColor: good ? colors.success + '55' : colors.border }]}>
      {label ? <Text style={[styles.chipLabel, { color: colors.textTertiary }]}>{label}</Text> : null}
      <Text style={[styles.chipValue, { color: good ? colors.success : colors.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Stat({ label, value, sub, colors, valueColor }: { label: string; value: string; sub?: string; colors: any; valueColor?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.statLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.statValue, { color: valueColor ?? colors.text }]}>{value}</Text>
      {sub ? <Text style={[styles.statSub, { color: colors.textTertiary }]} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

function ProgressBar({ fraction, color, colors }: { fraction: number; color: string; colors: any }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <View style={[styles.track, { backgroundColor: colors.border }]}>
      <View style={[styles.fill, { width: `${f * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 },
  ticker: { fontSize: 18, fontWeight: '800' },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  scorePill: { flexDirection: 'row', alignItems: 'baseline', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  scoreValue: { fontSize: 16, fontWeight: '800' },
  scoreUnit: { fontSize: 10, fontWeight: '600', marginLeft: 1 },
  levels: { marginTop: 12, gap: 6 },
  levelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  levelLabel: { width: 56, fontSize: 12, fontWeight: '600' },
  levelValue: { width: 84, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  levelNote: { flex: 1, fontSize: 11 },
  techRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', gap: 4, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, maxWidth: 140 },
  chipLabel: { fontSize: 10, fontWeight: '600' },
  chipValue: { fontSize: 10, fontWeight: '700' },
  statusBox: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusLabel: { fontSize: 12, fontWeight: '700' },
  statusReason: { fontSize: 11, lineHeight: 15 },
  subCard: { marginTop: 10, borderRadius: 10, borderWidth: 1, padding: 10, gap: 8 },
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subTitle: { fontSize: 13, fontWeight: '700' },
  subNote: { fontSize: 11, lineHeight: 15 },
  countdown: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  contractLine: { fontSize: 12 },
  grid: { flexDirection: 'row', gap: 10 },
  statLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  statValue: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 1 },
  statSub: { fontSize: 10, marginTop: 1 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderRadius: 8, paddingVertical: 9 },
  btnText: { fontSize: 13, fontWeight: '700' },
  resultRow: { marginTop: 10, borderRadius: 8, padding: 8 },
  resultText: { fontSize: 12, fontWeight: '600' },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  modeLabel: { fontSize: 11, fontWeight: '600' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, padding: 2 },
  segmentBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  segmentText: { fontSize: 11, fontWeight: '700' },
});
