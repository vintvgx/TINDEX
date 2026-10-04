import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useBriefConfig, useBriefReview } from '@/hooks/queries/brief/useBriefReview';
import { useUpdateBriefConfig } from '@/hooks/mutations/brief/useUpdateBriefConfig';
import type { PaperSignal, SignalPath, SignalStats } from '@/common/types/morningBrief';

const PATH_LABEL: Record<SignalPath, string> = { A: 'A · Level break (brief)', B: 'B · ORB breakout' };

const RANGES = [
  { key: 'this', label: 'This week' },
  { key: 'last', label: 'Last week' },
  { key: '4w', label: '4 weeks' },
] as const;
type RangeKey = typeof RANGES[number]['key'];

/** Today in New York as YYYY-MM-DD → [start, end] for the range. */
function rangeDates(key: RangeKey): [string, string] {
  const todayEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const today = new Date(`${todayEt}T12:00:00Z`);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (d: Date, days: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + days); return x; };
  if (key === 'this') return [iso(monday), todayEt];
  if (key === 'last') return [iso(shift(monday, -7)), iso(shift(monday, -3))];
  return [iso(shift(monday, -21)), todayEt];
}

const SETTING_META: Record<string, { label: string; hint: string; pct?: boolean }> = {
  min_setup_score:        { label: 'Min setup score',        hint: 'plays below this are cut at the 9:28 lock' },
  min_trigger_zone_score: { label: 'Min trigger-zone score', hint: '0 = off; blocks setups on weak zones' },
  trigger_volume_mult:    { label: 'Trigger volume ×',       hint: '1m volume vs the baseline' },
  stale_pct:              { label: 'No-chase band',          hint: 'stand down / cancel past this distance', pct: true },
  limit_timeout_seconds:  { label: 'Limit timeout (s)',      hint: 'unfilled limit buys cancel after this' },
  confirm_ttl_seconds:    { label: 'Confirm window (s)',     hint: 'confirm-first plays expire after this' },
  max_losses_per_day:     { label: 'Kill switch (losses)',   hint: 'brief losses that end the day' },
  max_open_trades:        { label: 'Max open brief trades',  hint: 'extra triggers wait and re-check' },
  earnings_block_days:    { label: 'Earnings block (days)',  hint: 'no setups this close to earnings' },
};

interface Props { visible: boolean; onClose: () => void }

/**
 * Paper-testing weekly review (TODO 8 part 3): path A (brief level breaks)
 * vs path B (ORB breakouts), win rate / avg return / setup outcomes by
 * zone-score and setup-score bucket, the week's signals, and the brief's
 * thresholds — tuned here from this data instead of in code.
 */
export function BriefReviewModal({ visible, onClose }: Props) {
  const colors = useThemeColors();
  const [range, setRange] = useState<RangeKey>('this');
  const [paperOnly, setPaperOnly] = useState(true);
  const [start, end] = useMemo(() => rangeDates(range), [range]);
  const { data, isLoading, error } = useBriefReview(start, end, paperOnly, visible);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Paper-testing review</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.controls}>
            <View style={[styles.segment, { borderColor: colors.border }]}>
              {RANGES.map(r => (
                <TouchableOpacity key={r.key} onPress={() => setRange(r.key)}
                  style={[styles.segmentBtn, range === r.key && { backgroundColor: colors.accent }]}>
                  <Text style={[styles.segmentText, { color: range === r.key ? '#000' : colors.textSecondary }]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.paperRow}>
              <Text style={[styles.small, { color: colors.textSecondary }]}>Paper only</Text>
              <Switch value={paperOnly} onValueChange={setPaperOnly} />
            </View>
          </View>
          <Text style={[styles.small, { color: colors.textTertiary }]}>{start} → {end} · outcomes resolve at 4:15 PM ET</Text>

          {isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} /> : error ? (
            <Text style={[styles.small, { color: colors.error }]}>{(error as Error).message}</Text>
          ) : data && data.overall.signals === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="flask-outline" size={30} color={colors.tabBarInactive} />
              <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>
                No signals in this range yet. Brief triggers (path A) and ORB breakout entries (path B) land here.
              </Text>
            </View>
          ) : data ? (
            <>
              <View style={styles.pathRow}>
                {(['A', 'B'] as const).map(p => (
                  <PathCard key={p} path={p} stats={data.by_path[p]} colors={colors} />
                ))}
              </View>

              <Section title="By zone score" colors={colors}>
                <BucketTable rows={data.by_zone_score.map(r => ({ ...r, label: `${r.bucket} · ${r.path}` }))} colors={colors} />
              </Section>

              {data.by_setup_score.length > 0 && (
                <Section title="By setup score (path A)" colors={colors}>
                  <BucketTable rows={data.by_setup_score.map(r => ({ ...r, label: r.bucket }))} colors={colors} />
                </Section>
              )}

              <Section title={`Signals (${data.signals.length})`} colors={colors}>
                {data.signals.slice(0, 40).map(s => <SignalRow key={s.id} s={s} colors={colors} />)}
              </Section>
            </>
          ) : null}

          <ThresholdsEditor colors={colors} enabled={visible} />
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(0)}%`);
const signedPct = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const money = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}`;

function PathCard({ path, stats, colors }: { path: SignalPath; stats: SignalStats; colors: any }) {
  const winColor = stats.win_rate == null ? colors.text : stats.win_rate >= 50 ? colors.success : colors.error;
  return (
    <View style={[styles.pathCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.pathTitle, { color: colors.textSecondary }]}>{PATH_LABEL[path]}</Text>
      <Text style={[styles.big, { color: winColor }]}>{pct(stats.win_rate)}</Text>
      <Text style={[styles.small, { color: colors.textTertiary }]}>win rate · {stats.traded} traded / {stats.signals} signals</Text>
      <View style={styles.kv}>
        <KV k="Avg return" v={signedPct(stats.avg_return_pct)} colors={colors} />
        <KV k="P&L" v={stats.traded ? money(stats.total_pnl) : '—'} colors={colors}
          color={stats.total_pnl > 0 ? colors.success : stats.total_pnl < 0 ? colors.error : undefined} />
        <KV k="Fill rate" v={pct(stats.fill_rate)} colors={colors} />
        <KV k="Target hit" v={pct(stats.target_hit_rate)} colors={colors} />
        <KV k="Stopped" v={pct(stats.stopped_rate)} colors={colors} />
        <KV k="Expired" v={pct(stats.expired_rate)} colors={colors} />
      </View>
    </View>
  );
}

function KV({ k, v, colors, color }: { k: string; v: string; colors: any; color?: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={[styles.small, { color: colors.textSecondary }]}>{k}</Text>
      <Text style={[styles.kvValue, { color: color ?? colors.text }]}>{v}</Text>
    </View>
  );
}

function Section({ title, colors, children }: { title: string; colors: any; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function BucketTable({ rows, colors }: { rows: (SignalStats & { label: string })[]; colors: any }) {
  return (
    <View style={[styles.table, { borderColor: colors.border }]}>
      <View style={[styles.tr, { borderBottomColor: colors.border }]}>
        {['Bucket', 'n', 'Win', 'Avg', 'Target'].map((h, i) => (
          <Text key={h} style={[styles.th, i === 0 && styles.firstCol, { color: colors.textTertiary }]}>{h}</Text>
        ))}
      </View>
      {rows.map(r => (
        <View key={r.label} style={[styles.tr, { borderBottomColor: colors.border }]}>
          <Text style={[styles.td, styles.firstCol, { color: colors.text }]}>{r.label}</Text>
          <Text style={[styles.td, { color: colors.textSecondary }]}>{r.traded}/{r.signals}</Text>
          <Text style={[styles.td, { color: r.win_rate == null ? colors.textSecondary : r.win_rate >= 50 ? colors.success : colors.error }]}>{pct(r.win_rate)}</Text>
          <Text style={[styles.td, { color: colors.text }]}>{signedPct(r.avg_return_pct)}</Text>
          <Text style={[styles.td, { color: colors.text }]}>{pct(r.target_hit_rate)}</Text>
        </View>
      ))}
    </View>
  );
}

const OUTCOME_META: Record<string, { label: string; tone: 'good' | 'bad' | 'muted' }> = {
  target_hit: { label: 'target', tone: 'good' },
  stopped: { label: 'stopped', tone: 'bad' },
  expired: { label: 'expired', tone: 'muted' },
};

function SignalRow({ s, colors }: { s: PaperSignal; colors: any }) {
  const o = s.outcome ? OUTCOME_META[s.outcome] : null;
  const oColor = o?.tone === 'good' ? colors.success : o?.tone === 'bad' ? colors.error : colors.textSecondary;
  return (
    <View style={[styles.signalRow, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.signalTitle, { color: colors.text }]}>
          {s.ticker} <Text style={{ color: s.direction === 'CALL' ? colors.success : colors.error }}>{s.direction === 'CALL' ? '↑' : '↓'}</Text>
          <Text style={{ color: colors.textTertiary }}>  {s.signal_path} · {s.signal_date.slice(5)}</Text>
        </Text>
        <Text style={[styles.small, { color: colors.textTertiary }]} numberOfLines={1}>
          zone {s.zone_score != null ? s.zone_score.toFixed(0) : '—'}
          {s.setup_score != null ? ` · setup ${s.setup_score.toFixed(0)}` : ''}
          {s.gate_agree != null ? ` · gate ${s.gate_agree}/${s.gate_total}` : ''}
          {` · ${s.trigger.toFixed(2)} → ${s.target.toFixed(2)}`}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.small, { color: oColor, fontWeight: '700' }]}>{o?.label ?? 'unresolved'}</Text>
        <Text style={[styles.small, { color: s.pnl == null ? colors.textTertiary : s.pnl >= 0 ? colors.success : colors.error }]}>
          {s.pnl != null ? `${money(s.pnl)} (${signedPct(s.pnl_pct)})` : s.fill_status}
        </Text>
      </View>
    </View>
  );
}

function ThresholdsEditor({ colors, enabled }: { colors: any; enabled: boolean }) {
  const toast = useToast();
  const { data } = useBriefConfig(enabled);
  const update = useUpdateBriefConfig();
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(Object.entries(data.settings).map(([k, v]) => [
      k, SETTING_META[k]?.pct ? String(+(v * 100).toFixed(2)) : String(v),
    ])));
  }, [data]);

  if (!data) return null;

  const toValue = (k: string, raw: string) => {
    const n = Number(raw);
    return SETTING_META[k]?.pct ? n / 100 : n;
  };
  const changed = Object.keys(draft).filter(k => toValue(k, draft[k]) !== data.settings[k]);

  const save = () => {
    const patch: Record<string, number> = {};
    for (const k of changed) patch[k] = toValue(k, draft[k]);
    update.mutate(patch, {
      onSuccess: () => toast.success('Brief thresholds saved — apply from the next brief'),
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <Section title="Thresholds" colors={colors}>
      <View style={[styles.table, { borderColor: colors.border }]}>
        {Object.keys(SETTING_META).filter(k => k in data.settings).map(k => {
          const b = data.bounds[k];
          const meta = SETTING_META[k];
          const fmt = (v: number) => (meta.pct ? `${+(v * 100).toFixed(2)}%` : String(v));
          return (
            <View key={k} style={[styles.settingRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>{meta.label}</Text>
                <Text style={[styles.small, { color: colors.textTertiary }]}>
                  {meta.hint} · {fmt(b.min)}–{fmt(b.max)} (default {fmt(b.default)})
                </Text>
              </View>
              <TextInput
                value={draft[k] ?? ''}
                onChangeText={(t) => setDraft(d => ({ ...d, [k]: t }))}
                keyboardType="decimal-pad"
                style={[styles.input, {
                  color: colors.text, borderColor: changed.includes(k) ? colors.accent : colors.border,
                  backgroundColor: colors.background,
                }]}
              />
            </View>
          );
        })}
      </View>
      <TouchableOpacity
        disabled={changed.length === 0 || update.isPending}
        onPress={save}
        style={[styles.saveBtn, { backgroundColor: colors.accent, opacity: changed.length === 0 ? 0.4 : 1 }]}
      >
        {update.isPending ? <ActivityIndicator color="#000" /> : (
          <Text style={styles.saveText}>{changed.length ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'No changes'}</Text>
        )}
      </TouchableOpacity>
    </Section>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 18, fontWeight: '700' },
  content: { padding: 16, gap: 16 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, padding: 2 },
  segmentBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  segmentText: { fontSize: 12, fontWeight: '700' },
  paperRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  small: { fontSize: 11 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 30, paddingHorizontal: 20 },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  pathRow: { flexDirection: 'row', gap: 10 },
  pathCard: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  pathTitle: { fontSize: 11, fontWeight: '700' },
  big: { fontSize: 26, fontWeight: '800', marginTop: 4 },
  kv: { marginTop: 8, gap: 3 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between' },
  kvValue: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  table: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  tr: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  th: { flex: 1, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', textAlign: 'right' },
  td: { flex: 1, fontSize: 12, fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] },
  firstCol: { flex: 1.6, textAlign: 'left' },
  signalRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  signalTitle: { fontSize: 13, fontWeight: '700' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  settingLabel: { fontSize: 13, fontWeight: '600' },
  input: { width: 70, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, textAlign: 'right' },
  saveBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: '#000', fontWeight: '800', fontSize: 14 },
});
