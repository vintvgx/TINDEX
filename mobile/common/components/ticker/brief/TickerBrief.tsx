import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { Skeleton } from '@/common/components/ui/Skeleton';
import { formatMarketCap } from '@/common/utils/format/marketCap';
import { AUTO_ZONE_RESISTANCE_COLOR as AUTO_RES, AUTO_ZONE_SUPPORT_COLOR as AUTO_SUP } from '@/common/components/ticker/autoZoneColors';
import { useEntryCheck, type EntryCheck, type EntryVerdict } from '@/hooks/queries/technicals/useEntryCheck';
import {
  useBriefSection, useGateExplanation,
  type BriefEnvelope, type BriefZone, type GateForExplain,
} from '@/hooks/queries/ticker/useTickerBrief';

/**
 * The ticker sheet's trading brief, below the chart: Snapshot → Bottom Line
 * → Trade Levels → Options Positioning → Analysts → Institutional → Linked
 * Companies → Catalysts/Momentum.
 *
 * Every section fetches on its own (see useTickerBrief) and owns its state:
 * skeleton while loading, data when it lands, an inline muted "unavailable"
 * row if it fails. No section ever waits on another, and nothing here is a
 * screen-level error. Values the backend couldn't verify render as
 * "unavailable", never guessed.
 */
export function TickerBrief({ ticker }: { ticker: string }) {
  return (
    <View style={{ gap: 18 }}>
      <SnapshotSection ticker={ticker} />
      <BottomLineSection ticker={ticker} />
      <LevelsSection ticker={ticker} />
      <PositioningSection ticker={ticker} />
      <AnalystsSection ticker={ticker} />
      <InstitutionalSection ticker={ticker} />
      <LinkedSection ticker={ticker} />
      <CatalystsSection ticker={ticker} />
    </View>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────

type Colors = ReturnType<typeof useThemeColors>;

const money = (n: number | null | undefined) => (n == null ? null : `$${n.toFixed(2)}`);
const pct = (n: number | null | undefined, signed = false) =>
  n == null ? null : `${signed && n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const intFmt = (n: number | null | undefined) => (n == null ? null : n.toLocaleString('en-US'));
const band = (z: { low: number; high: number }) => `${money(z.low)}–${money(z.high)}`;

function formatDay(iso: string | null | undefined) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAsOf(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Section({ title, caption, children }: { title: string; caption?: string | null; children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <View>
      <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>{title}</Text>
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.cardBorder ?? colors.border }]}>
        {children}
      </View>
      {caption ? <Text style={[s.caption, { color: colors.textTertiary }]}>{caption}</Text> : null}
    </View>
  );
}

/** A label/value row; `value` null renders "unavailable". */
function Row({ label, value, sub, valueColor, last }: {
  label: string; value: React.ReactNode | null; sub?: string | null; valueColor?: string; last?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator }]}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={[s.rowLabel, { color: colors.text }]}>{label}</Text>
        {sub ? <Text style={[s.rowSub, { color: colors.textTertiary }]}>{sub}</Text> : null}
      </View>
      {value == null ? (
        <Unavailable />
      ) : typeof value === 'string' ? (
        <Text style={[s.rowValue, { color: valueColor ?? colors.text }]}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

function Unavailable({ text = 'unavailable' }: { text?: string }) {
  const colors = useThemeColors();
  return <Text style={[s.unavailable, { color: colors.textTertiary }]}>{text}</Text>;
}

function UnavailableRow() {
  return (
    <View style={s.row}>
      <Unavailable text="Unavailable right now" />
    </View>
  );
}

function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <View style={{ paddingVertical: 6, gap: 12 }}>
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} width={i % 2 ? '70%' : '100%'} height={14} />
      ))}
    </View>
  );
}

/** Loading → skeleton; no data → unavailable row; else render. */
function SectionBody<T>({ q, rows = 3, children }: {
  q: { data?: BriefEnvelope<T>; isLoading: boolean };
  rows?: number;
  children: (data: T, env: BriefEnvelope<T>) => React.ReactNode;
}) {
  if (q.isLoading && !q.data) return <SkeletonRows n={rows} />;
  const env = q.data;
  if (!env || env.data == null) return <UnavailableRow />;
  return <>{children(env.data, env)}</>;
}

// ── Snapshot ────────────────────────────────────────────────────────────────

function SnapshotSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  const q = useBriefSection(ticker, 'snapshot');
  const [expanded, setExpanded] = useState(false);
  return (
    <Section title="Snapshot">
      <SectionBody q={q} rows={4}>
        {d => (
          <>
            <Row label="Market cap" value={d.market_cap != null ? formatMarketCap(d.market_cap) : null} />
            <Row label="Sector" value={d.sector} sub={d.industry} last={!d.summary} />
            {d.summary ? (
              <Pressable onPress={() => setExpanded(v => !v)} style={{ paddingTop: 10 }}>
                <Text style={[s.body, { color: colors.textSecondary }]} numberOfLines={expanded ? undefined : 3}>
                  {d.summary}
                </Text>
                <Text style={[s.link, { color: colors.accent }]}>{expanded ? 'Less' : 'More'}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </SectionBody>
    </Section>
  );
}

// ── Bottom Line (Technicals Gate only) ──────────────────────────────────────

const DECISION_LABEL: Record<string, string> = { ENTER: 'ENTER', WAIT: 'WAIT', DONT_ENTER: "DON'T ENTER" };

function decisionColor(decision: string | undefined, colors: Colors) {
  return decision === 'ENTER' ? colors.success : decision === 'WAIT' ? colors.warning : colors.error;
}

function BottomLineSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  // The gate is the one source of truth here. Newer API deploys return both
  // directions' verdicts on one call; older ones need a second PUT request.
  const callQ = useEntryCheck(ticker, 'CALL');
  const needsPut = !!callQ.data && !callQ.data.verdicts;
  const putQ = useEntryCheck(ticker, 'PUT', needsPut);

  const gate = useMemo(() => {
    const c = callQ.data;
    if (!c) return null;
    const call: EntryVerdict | undefined = c.verdicts?.CALL ?? c.verdict;
    const put: EntryVerdict | undefined = c.verdicts?.PUT ?? putQ.data?.verdict;
    if (!call || !put) return null;
    return { check: c as EntryCheck, call, put };
  }, [callQ.data, putQ.data]);

  // "No setup" when the gate says neither side has one — never a guess.
  const noSetup = gate
    ? gate.check.signal
      ? gate.check.signal === 'NA'
      : gate.call.decision === 'DONT_ENTER' && gate.put.decision === 'DONT_ENTER'
    : false;

  const payload: GateForExplain | null = gate
    ? {
        ticker, signal: gate.check.signal ?? null, price: gate.check.price ?? null,
        rows: gate.check.rows, verdicts: { CALL: gate.call, PUT: gate.put },
      }
    : null;
  const signature = gate
    ? [gate.check.signal, gate.call.decision, gate.call.reason, gate.put.decision, gate.put.reason].join('|')
    : null;
  const explainQ = useGateExplanation(ticker, payload, signature);
  const explanation = explainQ.data?.data?.text ?? null;

  const loading = callQ.isLoading || (needsPut && putQ.isLoading);
  const failed = !gate && !loading;

  return (
    <Section
      title="Bottom Line"
      caption={explanation ? `Technicals Gate verdict · explanation is AI-written from the gate's output${explainQ.data?.asOf ? ` · cached ${formatAsOf(explainQ.data.asOf)}` : ''}` : 'Technicals Gate verdict'}
    >
      {loading && !gate ? (
        <SkeletonRows n={3} />
      ) : failed || !gate ? (
        <UnavailableRow />
      ) : (
        <>
          {noSetup ? (
            <Text style={[s.headline, { color: colors.text }]}>No setup</Text>
          ) : null}
          {(['CALL', 'PUT'] as const).map((dir, i) => {
            const v = dir === 'CALL' ? gate.call : gate.put;
            const color = decisionColor(v.decision, colors);
            return (
              <View key={dir} style={[s.verdictRow, i === 0 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator }]}>
                <Text style={[s.verdictDir, { color: colors.textSecondary }]}>{dir}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowSub, { color: colors.textSecondary }]} numberOfLines={2}>{v.reason}</Text>
                </View>
                <View style={[s.pill, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
                  <Text style={[s.pillText, { color }]}>{DECISION_LABEL[v.decision] ?? v.decision}</Text>
                </View>
              </View>
            );
          })}
          {explanation ? (
            <Text style={[s.body, { color: colors.text, marginTop: 10 }]}>{explanation}</Text>
          ) : null}
        </>
      )}
    </Section>
  );
}

// ── Trade levels (zone engine) ──────────────────────────────────────────────

function ZoneLine({ z, colors, last }: { z: BriefZone; colors: Colors; last?: boolean }) {
  return (
    <Row
      label={band(z)}
      sub={`${z.touches} touch${z.touches === 1 ? '' : 'es'}`}
      value={<Text style={[s.rowValue, { color: colors.text }]}>{Math.round(z.score)}<Text style={{ color: colors.textTertiary, fontSize: 12 }}>/100</Text></Text>}
      last={last}
    />
  );
}

function LevelsSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  const q = useBriefSection(ticker, 'levels');
  return (
    <Section title="Trade Levels" caption="Zone engine support/resistance · score 0–100 · refreshes every 90s">
      <SectionBody q={q} rows={5}>
        {d => (
          <>
            {d.inside ? (
              <Row label="Price is inside" value={band(d.inside)} sub={`${d.inside.type} zone`} />
            ) : null}
            <Row
              label="Nearest above"
              value={d.above ? band(d.above) : null}
              sub={d.above?.distance_pct != null ? `${pct(d.above.distance_pct)} away · ${d.above.type}` : null}
            />
            <Row
              label="Nearest below"
              value={d.below ? band(d.below) : null}
              sub={d.below?.distance_pct != null ? `${pct(d.below.distance_pct)} away · ${d.below.type}` : null}
              last={!d.resistance.length && !d.support.length}
            />
            {d.resistance.length > 0 && <Text style={[s.subhead, { color: AUTO_RES }]}>Resistance</Text>}
            {d.resistance.map((z, i) => <ZoneLine key={`r${i}`} z={z} colors={colors} />)}
            {d.support.length > 0 && <Text style={[s.subhead, { color: AUTO_SUP }]}>Support</Text>}
            {d.support.map((z, i) => <ZoneLine key={`s${i}`} z={z} colors={colors} last={i === d.support.length - 1} />)}
          </>
        )}
      </SectionBody>
    </Section>
  );
}

// ── Options positioning (OI-based) ──────────────────────────────────────────

function PositioningSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  const q = useBriefSection(ticker, 'flow');
  return (
    <Section title="Options Positioning" caption="Chain stats ~15 min delayed — not a live flow feed.">
      <Text style={[s.estimate, { color: colors.textTertiary }]}>OI-based positioning estimate — not a live flow feed.</Text>
      <SectionBody q={q} rows={6}>
        {(d, env) => (
          <>
            <Row label="Put/Call volume" value={d.pc_volume != null ? d.pc_volume.toFixed(2) : null}
              sub={`${intFmt(d.put_volume)} puts · ${intFmt(d.call_volume)} calls`} />
            <Row label="Put/Call open interest" value={d.pc_oi != null ? d.pc_oi.toFixed(2) : null}
              sub={`${intFmt(d.put_oi)} puts · ${intFmt(d.call_oi)} calls`} />
            <Row label="Front-expiry ATM IV" value={d.atm_iv_pct != null ? `≈ ${d.atm_iv_pct.toFixed(1)}%` : null}
              sub="Mean IV of contracts within ±5% of spot" />
            <Row label="Max pain" value={money(d.max_pain)} sub={d.expiries[0] ? `Front expiry ${formatDay(d.expiries[0])}` : null} />
            <Row label="Call wall (OI)" value={d.call_wall.length ? d.call_wall.map(w => `$${w.strike}`).join(' · ') : null}
              sub="Top strikes by call open interest" />
            <Row label="Put wall (OI)" value={d.put_wall.length ? d.put_wall.map(w => `$${w.strike}`).join(' · ') : null}
              sub="Top strikes by put open interest" last={!d.unusual.length} />
            {d.unusual.length > 0 && (
              <>
                <Text style={[s.subhead, { color: colors.textSecondary }]}>Unusual contracts</Text>
                <Text style={[s.rowSub, { color: colors.textTertiary, marginBottom: 4 }]}>
                  Volume far exceeding open interest — possible opening or speculative flow.
                </Text>
                {d.unusual.map((u, i) => (
                  <View key={`${u.type}${u.strike}${u.expiry}`} style={[s.unusualRow, i < d.unusual.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator }]}>
                    <Text style={[s.unusualMain, { color: u.type === 'call' ? colors.success : colors.error }]}>
                      ${u.strike} {u.type === 'call' ? 'C' : 'P'}
                    </Text>
                    <Text style={[s.unusualCell, { color: colors.textSecondary }]}>{formatDay(u.expiry)?.replace(/, \d{4}$/, '')}</Text>
                    <Text style={[s.unusualCell, { color: colors.textSecondary }]}>{intFmt(u.volume)} / {intFmt(u.open_interest)}</Text>
                    <Text style={[s.unusualRatio, { color: colors.text }]}>{u.vol_oi.toFixed(1)}×</Text>
                  </View>
                ))}
              </>
            )}
            {env.stale ? <Text style={[s.caption, { color: colors.warning }]}>Showing the last good read — refresh failed.</Text> : null}
          </>
        )}
      </SectionBody>
    </Section>
  );
}

// ── Analysts ────────────────────────────────────────────────────────────────

function AnalystsSection({ ticker }: { ticker: string }) {
  const q = useBriefSection(ticker, 'analysts');
  const snap = useBriefSection(ticker, 'snapshot');
  const price = snap.data?.data?.price ?? null;
  return (
    <Section title="Analysts">
      <SectionBody q={q} rows={4}>
        {d => {
          const upside = d.target_mean != null && price ? ((d.target_mean - price) / price) * 100 : null;
          const changes = d.recent_changes ?? [];
          return (
            <>
              <Row label="Consensus" value={d.recommendation}
                sub={d.analyst_count != null ? `${d.analyst_count} analysts` : null} />
              <Row label="Mean price target" value={money(d.target_mean)}
                sub={upside != null ? `${pct(upside, true)} vs current price` : null} last={!changes.length} />
              {changes.map((c, i) => (
                <Row key={`${c.date}${c.firm}`} label={c.firm ?? 'unavailable'}
                  sub={[formatDay(c.date), c.action].filter(Boolean).join(' · ')}
                  value={c.grade} last={i === changes.length - 1} />
              ))}
              {d.recent_changes == null ? <Unavailable text="Recent rating changes unavailable" /> : null}
            </>
          );
        }}
      </SectionBody>
    </Section>
  );
}

// ── Institutional ───────────────────────────────────────────────────────────

function InstitutionalSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  const q = useBriefSection(ticker, 'institutional');
  return (
    <Section title="Institutional" caption="13F data is 45+ days delayed.">
      <SectionBody q={q} rows={4}>
        {d => (
          <>
            <Row label="Held by institutions" value={pct(d.institutions_pct_held)} />
            <Row
              label="Top holders' combined position"
              value={d.trend ? pct(d.trend.top_holders_change_pct, true) : null}
              valueColor={d.trend ? (d.trend.top_holders_change_pct >= 0 ? colors.success : colors.error) : undefined}
              sub={d.trend ? `Latest vs prior 13F · top ${d.trend.holders_counted} holders` : null}
            />
            {d.top_holders.map((h, i) => (
              <Row key={`${h.holder}${i}`} label={h.holder ?? 'unavailable'} value={pct(h.pct_out)}
                sub={h.reported ? `% of shares out · reported ${formatDay(h.reported)}` : '% of shares out'}
                last={i === d.top_holders.length - 1} />
            ))}
          </>
        )}
      </SectionBody>
    </Section>
  );
}

// ── Linked companies (LLM + web search) ─────────────────────────────────────

function LinkedSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  const q = useBriefSection(ticker, 'linked');
  const asOf = formatAsOf(q.data?.asOf);
  return (
    <Section title="Linked Companies" caption={`news-derived · cached${asOf ? ` ${asOf}` : ''}`}>
      <SectionBody q={q} rows={4}>
        {d =>
          d.length === 0 ? (
            <View style={s.row}><Unavailable text="No linked companies found" /></View>
          ) : (
            <>
              {d.map((c, i) => (
                <View key={`${c.name}${i}`} style={[s.linkedRow, i < d.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rowLabel, { color: colors.text }]}>
                      {c.name}{c.ticker ? <Text style={{ color: colors.textTertiary }}> · {c.ticker}</Text> : null}
                    </Text>
                    {c.note ? <Text style={[s.rowSub, { color: colors.textSecondary }]}>{c.note}</Text> : null}
                  </View>
                  <View style={[s.pill, { borderColor: colors.border }]}>
                    <Text style={[s.pillText, { color: colors.textSecondary }]}>{c.relation}</Text>
                  </View>
                </View>
              ))}
            </>
          )
        }
      </SectionBody>
    </Section>
  );
}

// ── Catalysts / momentum ────────────────────────────────────────────────────

function CatalystsSection({ ticker }: { ticker: string }) {
  const colors = useThemeColors();
  const q = useBriefSection(ticker, 'catalysts');
  return (
    <Section title="Catalysts & Momentum">
      <SectionBody q={q} rows={3}>
        {d => {
          const news = d.news ?? [];
          return (
            <>
              <Row label="Next earnings" value={d.errors?.earnings ? null : (formatDay(d.next_earnings) ?? 'None scheduled')} />
              <View style={[s.row, { borderBottomWidth: news.length || d.news == null ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.separator }]}>
                {d.momentum?.line ? (
                  <Text style={[s.body, { color: colors.text, flex: 1 }]}>{d.momentum.line}</Text>
                ) : (
                  <><Text style={[s.rowLabel, { color: colors.text, flex: 1 }]}>Momentum</Text><Unavailable /></>
                )}
              </View>
              {d.news == null ? (
                <View style={s.row}><Unavailable text="News events unavailable" /></View>
              ) : news.length === 0 ? (
                <View style={s.row}><Unavailable text="No notable non-earnings events found" /></View>
              ) : (
                news.map((n, i) => (
                  <Row key={`${n.title}${i}`} label={n.title} value={formatDay(n.date) ?? 'date not stated'}
                    last={i === news.length - 1} />
                ))
              )}
              {d.news != null ? (
                <Text style={[s.caption, { color: colors.textTertiary }]}>
                  Events: news-derived · cached{formatAsOf(d.news_as_of) ? ` ${formatAsOf(d.news_as_of)}` : ''}
                </Text>
              ) : null}
            </>
          );
        }}
      </SectionBody>
    </Section>
  );
}

const s = StyleSheet.create({
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6, marginLeft: 4 },
  card: { borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 4 },
  caption: { fontSize: 11, marginTop: 6, marginLeft: 4, lineHeight: 15 },
  estimate: { fontSize: 11.5, fontStyle: 'italic', paddingTop: 8, paddingBottom: 2 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, minHeight: 42 },
  rowLabel: { fontSize: 14, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  rowValue: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1 },
  unavailable: { fontSize: 13, fontStyle: 'italic' },
  body: { fontSize: 13.5, lineHeight: 19 },
  link: { fontSize: 13, fontWeight: '600', marginTop: 4, marginBottom: 6 },
  subhead: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 12, marginBottom: 2 },

  headline: { fontSize: 20, fontWeight: '800', paddingTop: 10, paddingBottom: 4 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  verdictDir: { width: 38, fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  pillText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3 },

  unusualRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  unusualMain: { width: 78, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unusualCell: { flex: 1, fontSize: 12, fontVariant: ['tabular-nums'] },
  unusualRatio: { width: 54, textAlign: 'right', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

  linkedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
});
