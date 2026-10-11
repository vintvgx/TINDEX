import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useTickerFundamentals, type TickerFundamentals } from '@/hooks/queries/ticker/useTickerFundamentals';
import { useThesis, useRequestThesis, thesisStaleReason } from '@/hooks/queries/ticker/useThesis';
import { formatMarketCap } from '@/common/utils/format/marketCap';
import { RevenueChart } from './RevenueChart';
import { ThesisSheet } from './ThesisSheet';

/**
 * Ticker sheet → Invest tab (handoff spec 6 / invest-tab-thesis-mock,
 * 2026-10-11). Investing-horizon view of the company, in the mock's order:
 * Generate Thesis → Valuation → Profitability → Growth → Risk → Revenue
 * (actual + estimates) → 52-week range → Analyst consensus → About.
 *
 * Replaces the never-mounted FinancialsTab. Every card hides when its value
 * is missing — a thin ETF or a fresh IPO renders what it has, never crashes.
 *
 * The thesis itself is written by Bandit, not generated here: the button
 * only queues a request (see useThesis).
 */

type Colors = ReturnType<typeof useThemeColors>;
type Tone = 'good' | 'bad' | 'warn' | undefined;

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

// ── Plain-English notes (mock copy) ──────────────────────────────────────────

const PE_NOTE = 'S&P avg ~26';
function pbNote(pb: number): { text: string; tone: Tone } | null {
  if (pb > 10) return { text: 'Pricey on book', tone: 'warn' };
  if (pb < 1.5) return { text: 'Near book value', tone: 'good' };
  return null;
}
function marginNote(m: number): { text: string; tone: Tone } {
  if (m >= 30) return { text: 'Elite', tone: 'good' };
  if (m >= 15) return { text: 'Healthy', tone: 'good' };
  if (m >= 0) return { text: 'Thin', tone: 'warn' };
  return { text: 'Losing money', tone: 'bad' };
}
function betaNote(b: number): { text: string; tone: Tone } {
  if (b >= 1.3) return { text: `~${Math.round(b * 2) / 2}× market swings`, tone: 'warn' };
  if (b <= 0.7) return { text: 'Calmer than the market', tone: 'good' };
  return { text: 'Moves with the market', tone: undefined };
}
// yfinance debtToEquity is a percent (17.0 = 0.17×).
function deNote(de: number): { text: string; tone: Tone } {
  if (de < 50) return { text: 'Light leverage', tone: 'good' };
  if (de < 150) return { text: 'Moderate leverage', tone: undefined };
  return { text: 'Heavy leverage', tone: 'bad' };
}

export function InvestTab({ ticker, livePrice, openThesisOnMount = false }: {
  ticker: string;
  /** The sheet's live price (fresher than the fundamentals cache). */
  livePrice?: number | null;
  /** Push tap "Your NVDA thesis is ready" lands straight on the sheet. */
  openThesisOnMount?: boolean;
}) {
  const colors = useThemeColors();
  const { authState: { user } } = useAuth();
  const { data: env, isLoading } = useTickerFundamentals(ticker);
  const f = env?.data ?? null;
  const price = livePrice ?? f?.price ?? null;

  const { data: thesis } = useThesis(ticker, user?.id);
  const requestThesis = useRequestThesis(ticker, user?.id);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (openThesisOnMount && thesis?.status === 'complete') setSheetOpen(true);
  }, [openThesisOnMount, thesis?.status]);

  const pending = thesis?.status === 'pending' || requestThesis.isPending;
  const hasThesis = !!thesis?.thesis;
  const stale = thesisStaleReason(thesis, price);

  const onThesis = () => {
    if (hasThesis && !pending) setSheetOpen(true);
    else if (!pending) requestThesis.mutate();
  };

  if (isLoading) {
    return <ActivityIndicator color={colors.accent} style={{ marginTop: 28 }} />;
  }

  return (
    <View>
      {(f?.sector || f?.industry) && (
        <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 2 }}>
          {[f?.sector, f?.industry].filter(Boolean).join(' · ')}
        </Text>
      )}

      {/* Generate Thesis — copy exactly per spec */}
      <Pressable onPress={onThesis} disabled={!user?.id} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginTop: 10 })}>
        <LinearGradient colors={['#7c5cff', '#4a9eff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.thesisBtn}>
          {pending ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={s.thesisTitle}>Bandit is writing…</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles" size={16} color="#fff" />
              <Text style={s.thesisTitle}>Generate Thesis</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>
      <Text style={{ textAlign: 'center', fontSize: 12, color: colors.textTertiary, marginTop: 5 }}>
        {pending
          ? "We'll notify you when it's ready"
          : thesis?.status === 'failed'
            ? "Couldn't write this one — tap to try again"
            : '*powered by Muse'}
      </Text>
      {hasThesis && !pending && (
        <Pressable onPress={() => requestThesis.mutate()} hitSlop={8} style={{ alignSelf: 'center', marginTop: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: stale ? colors.warning : colors.accent }}>
            {stale ? `⚠ Your thesis may be stale — ${stale.toLowerCase()} · Refresh` : 'Refresh thesis'}
          </Text>
        </Pressable>
      )}
      {requestThesis.isError && (
        <Text style={{ textAlign: 'center', fontSize: 12, color: colors.error, marginTop: 6 }}>
          Couldn&apos;t queue the thesis — try again.
        </Text>
      )}

      {!f ? (
        <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 20, textAlign: 'center' }}>
          Fundamentals unavailable for {ticker}.
        </Text>
      ) : (
        <Sections f={f} price={price} colors={colors} />
      )}

      {thesis?.thesis && (
        <ThesisSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          ticker={ticker}
          thesis={thesis.thesis}
          generatedAt={thesis.generated_at}
          staleReason={stale}
        />
      )}
    </View>
  );
}

function Sections({ f, price, colors }: { f: TickerFundamentals; price: number | null; colors: Colors }) {
  const [aboutOpen, setAboutOpen] = useState(false);

  const valuation: CardProps[] = [];
  if (num(f.market_cap)) valuation.push({ label: 'Market Cap', value: formatMarketCap(f.market_cap) });
  if (num(f.pe_trailing)) valuation.push({ label: 'P/E (trailing)', value: f.pe_trailing.toFixed(1), note: PE_NOTE });
  if (num(f.price_to_book)) {
    const n = pbNote(f.price_to_book);
    valuation.push({ label: 'P/B', value: f.price_to_book.toFixed(1), note: n?.text, tone: n?.tone });
  }
  if (num(f.dividend_yield_pct) && f.dividend_yield_pct > 0) {
    valuation.push({ label: 'Dividend yield', value: f.dividend_yield_pct.toFixed(2), unit: '%' });
  }
  // Phase 2 fields from the payload expansion — shown when present.
  if (num(f.pe_forward)) valuation.push({ label: 'P/E (forward)', value: f.pe_forward.toFixed(1) });
  if (num(f.peg)) valuation.push({ label: 'PEG', value: f.peg.toFixed(2), note: f.peg < 1 ? 'Growth-adjusted cheap' : undefined, tone: f.peg < 1 ? 'good' : undefined });
  if (num(f.ev_to_ebitda)) valuation.push({ label: 'EV / EBITDA', value: f.ev_to_ebitda.toFixed(1) });

  const profitability: CardProps[] = [];
  if (num(f.profit_margin_pct)) {
    const n = marginNote(f.profit_margin_pct);
    profitability.push({ label: 'Profit margin', value: `${f.profit_margin_pct.toFixed(1)}%`, note: n.text, tone: n.tone, valueTone: n.tone });
  }
  if (num(f.roe_pct)) profitability.push({ label: 'Return on equity', value: `${f.roe_pct.toFixed(0)}%`, valueTone: f.roe_pct >= 15 ? 'good' : f.roe_pct < 0 ? 'bad' : undefined });

  const growth: CardProps[] = [];
  if (num(f.revenue_growth_pct)) growth.push({ label: 'Revenue growth (YoY)', value: signedPct(f.revenue_growth_pct), valueTone: f.revenue_growth_pct >= 0 ? 'good' : 'bad' });
  if (num(f.earnings_growth_pct)) growth.push({ label: 'Earnings growth (YoY)', value: signedPct(f.earnings_growth_pct), valueTone: f.earnings_growth_pct >= 0 ? 'good' : 'bad' });

  const risk: CardProps[] = [];
  if (num(f.beta)) {
    const n = betaNote(f.beta);
    risk.push({ label: 'Beta', value: f.beta.toFixed(2), note: n.text, tone: n.tone });
  }
  if (num(f.debt_to_equity)) {
    const n = deNote(f.debt_to_equity);
    risk.push({ label: 'Debt / Equity', value: f.debt_to_equity.toFixed(1), note: n.text, tone: n.tone });
  }

  const showRange = num(f.year_low) && num(f.year_high) && num(price) && f.year_high > f.year_low;
  const c = f.consensus;
  const showConsensus = !!c || num(f.target_mean);

  return (
    <>
      <Grid title="VALUATION" cards={valuation} colors={colors} />
      <Grid title="PROFITABILITY" cards={profitability} colors={colors} />
      <Grid title="GROWTH" cards={growth} colors={colors} />
      <Grid title="RISK" cards={risk} colors={colors} />

      {f.revenue && f.revenue.bars.length > 0 && (
        <>
          <SectionTitle colors={colors}>REVENUE: ACTUAL + ESTIMATES</SectionTitle>
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <RevenueChart bars={f.revenue.bars} colors={colors} />
            <Text style={{ fontSize: 11, color: colors.textTertiary, marginTop: 10, lineHeight: 16 }}>
              {f.revenue.has_estimates
                ? `Solid = reported · Dashed = analyst consensus, whiskers = low–high${
                    f.revenue.analysts ? ` (${f.revenue.analysts} analysts on ${f.revenue.bars[f.revenue.bars.length - 1].label})` : ''
                  }. Not a guarantee.`
                : 'Reported revenue only — no analyst revenue estimates for this ticker.'}
            </Text>
          </View>
        </>
      )}

      {showRange && (
        <>
          <SectionTitle colors={colors}>52-WEEK RANGE</SectionTitle>
          <RangeCard low={f.year_low!} high={f.year_high!} price={price!} colors={colors} />
        </>
      )}

      {showConsensus && (
        <>
          <SectionTitle colors={colors}>
            ANALYST CONSENSUS
            {num(f.analyst_count) ? <Text style={{ letterSpacing: 0 }}>{`  · ${f.analyst_count} analysts`}</Text> : null}
          </SectionTitle>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {c && (
              <>
                <Pill n={String(c.buy)} label="BUY" color={colors.success} colors={colors} />
                <Pill n={String(c.hold)} label="HOLD" color={colors.warning} colors={colors} />
                <Pill n={String(c.sell)} label="SELL" color={colors.error} colors={colors} />
              </>
            )}
            {num(f.target_mean) && (
              <Pill n={`$${f.target_mean >= 1000 ? f.target_mean.toFixed(0) : f.target_mean.toFixed(f.target_mean >= 100 ? 0 : 2)}`} label="AVG TARGET" colors={colors} />
            )}
          </View>
        </>
      )}

      {!!f.about && (
        <>
          <SectionTitle colors={colors}>ABOUT</SectionTitle>
          <Pressable
            onPress={() => setAboutOpen((v) => !v)}
            style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text numberOfLines={aboutOpen ? undefined : 4} style={{ fontSize: 13, lineHeight: 21, color: colors.textSecondary }}>
              {f.about}
            </Text>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.accent, marginTop: 6 }}>
              {aboutOpen ? 'Show less' : 'Read more'}
            </Text>
          </Pressable>
        </>
      )}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

interface CardProps {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  tone?: Tone;
  valueTone?: Tone;
}

const toneColor = (t: Tone, colors: Colors, fallback: string) =>
  t === 'good' ? colors.success : t === 'bad' ? colors.error : t === 'warn' ? colors.warning : fallback;

function SectionTitle({ children, colors }: { children: React.ReactNode; colors: Colors }) {
  return <Text style={[s.sec, { color: colors.textSecondary }]}>{children}</Text>;
}

function Grid({ title, cards, colors }: { title: string; cards: CardProps[]; colors: Colors }) {
  if (!cards.length) return null;
  return (
    <>
      <SectionTitle colors={colors}>{title}</SectionTitle>
      <View style={s.grid}>
        {cards.map((c) => (
          <View key={c.label} style={[s.card, s.gridCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>{c.label}</Text>
            <Text style={[s.value, { color: toneColor(c.valueTone, colors, colors.text) }]}>
              {c.value}
              {c.unit ? <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}> {c.unit}</Text> : null}
            </Text>
            {!!c.note && (
              <Text style={{ fontSize: 11, marginTop: 3, color: toneColor(c.tone, colors, colors.textSecondary) }}>{c.note}</Text>
            )}
          </View>
        ))}
      </View>
    </>
  );
}

/** FiftyTwoWeekRangeBar's language (track + current-price marker + range
 *  ends), on the mock's red→amber→green gradient with a percentile label. */
function RangeCard({ low, high, price, colors }: { low: number; high: number; price: number; colors: Colors }) {
  const ratio = Math.min(1, Math.max(0, (price - low) / (high - low)));
  const pct = Math.round(ratio * 100);
  const ord = pct % 100 >= 11 && pct % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[pct % 10] ?? 'th';
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 14 }]}>
      <View style={{ marginTop: 10, marginHorizontal: 4 }}>
        <LinearGradient colors={['#ff6b6b', '#ffb020', '#4ade80']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 8, borderRadius: 5 }} />
        <View style={[s.rangeDot, { left: `${ratio * 100}%`, borderColor: colors.card }]} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
        <Text style={[s.tab, { fontSize: 12, color: colors.textSecondary }]}>${low.toFixed(2)}</Text>
        <Text style={[s.tab, { fontSize: 12, color: colors.text, fontWeight: '700' }]}>
          ${price.toFixed(2)}
          <Text style={{ color: colors.textSecondary, fontWeight: '500' }}>{` · ${pct}${ord} pct`}</Text>
        </Text>
        <Text style={[s.tab, { fontSize: 12, color: colors.textSecondary }]}>${high.toFixed(2)}</Text>
      </View>
    </View>
  );
}

function Pill({ n, label, color, colors }: { n: string; label: string; color?: string; colors: Colors }) {
  return (
    <View style={[s.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[s.tab, { fontSize: 20, fontWeight: '800', color: color ?? colors.text }]}>{n}</Text>
      <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  tab: { fontVariant: ['tabular-nums'] },
  thesisBtn: {
    borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  thesisTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  sec: { fontSize: 11, letterSpacing: 2, marginTop: 20, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14 },
  gridCard: { width: '48.5%' },
  value: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rangeDot: {
    position: 'absolute', top: -5, width: 18, height: 18, borderRadius: 9, marginLeft: -9,
    backgroundColor: '#fff', borderWidth: 3,
  },
  pill: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1 },
});
