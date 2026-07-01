import React, { useMemo } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { usePerformanceReview } from '@/hooks/queries/review/usePerformanceReviews';
import type { ReviewTrade } from '@/common/types/review';

interface Props {
  date: string | null;
  visible: boolean;
  onClose: () => void;
}

const EXIT_COLORS: Record<string, string> = {
  TP1: '#10B981',
  TP2: '#10B981',
  RUNNER_TRAIL_STOP: '#3B82F6',
  BREAKEVEN_STOP: '#F59E0B',
  CASCADE_EXIT: '#F59E0B',
  HARD_STOP: '#EF4444',
  EOD_CLOSE: '#8B5CF6',
  EOD_HARD_CLOSE: '#EF4444',
};

function pnlColor(pnl: number, colors: ReturnType<typeof useThemeColors>) {
  if (pnl > 0) return colors.success;
  if (pnl < 0) return colors.error;
  return colors.textSecondary;
}

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  const t = iso.replace('T', ' ').slice(11, 16);
  return t + ' ET';
}

function fmtPnl(n: number) {
  return `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(0)}`;
}

// ── Parse AI markdown into display sections ───────────────────────────────────
function parseMarkdown(md: string): Array<{ type: 'h1' | 'h2' | 'text' | 'divider'; content: string }> {
  const sections: Array<{ type: 'h1' | 'h2' | 'text' | 'divider'; content: string }> = [];
  for (const line of md.split('\n')) {
    if (line.startsWith('# ')) {
      sections.push({ type: 'h1', content: line.slice(2).trim() });
    } else if (line.startsWith('## ')) {
      sections.push({ type: 'h2', content: line.slice(3).trim() });
    } else if (line.trim() === '---') {
      sections.push({ type: 'divider', content: '' });
    } else {
      // Merge consecutive text lines
      const last = sections[sections.length - 1];
      if (last?.type === 'text') {
        last.content += '\n' + line;
      } else {
        sections.push({ type: 'text', content: line });
      }
    }
  }
  // Trim whitespace from text blocks
  return sections.map(s => ({ ...s, content: s.content.trim() })).filter(s => s.type !== 'text' || s.content.length > 0);
}

// ── Trade card ────────────────────────────────────────────────────────────────
function TradeCard({ trade, colors }: { trade: ReviewTrade; colors: ReturnType<typeof useThemeColors> }) {
  const dirColor = trade.direction === 'CALL' ? '#10B981' : '#EF4444';
  const exitColor = EXIT_COLORS[trade.exit_reason] ?? colors.textSecondary;
  const profit = (trade.pnl ?? 0) >= 0;

  return (
    <View style={{
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: profit ? colors.success + '33' : colors.error + '33',
      borderLeftWidth: 3,
      borderLeftColor: profit ? colors.success : colors.error,
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ backgroundColor: dirColor + '22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginRight: 8 }}>
          <Text style={{ color: dirColor, fontSize: 11, fontWeight: '700' }}>{trade.direction}</Text>
        </View>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 }}>{trade.ticker}</Text>
        <Text style={{ color: pnlColor(trade.pnl ?? 0, colors), fontSize: 17, fontWeight: '800' }}>
          {fmtPnl(trade.pnl ?? 0)}
        </Text>
      </View>

      {/* Contract + profile */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1 }}>{trade.contract_symbol}</Text>
        <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600' }}>{trade.profile.replace('_', ' ')}</Text>
        </View>
        {trade.paper_mode && (
          <View style={{ backgroundColor: '#FF9F0A22', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: '#FF9F0A', fontSize: 10, fontWeight: '600' }}>PAPER</Text>
          </View>
        )}
      </View>

      {/* Stats grid */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <MiniStat label="Entry" value={`$${(trade.entry_premium ?? 0).toFixed(2)}`} colors={colors} />
        <MiniStat label="Exit" value={trade.exit_premium != null ? `$${trade.exit_premium.toFixed(2)}` : '—'} colors={colors} />
        <MiniStat label="Qty" value={`${trade.qty_entered}`} colors={colors} />
        <MiniStat label="P&L %" value={`${(trade.pnl_pct ?? 0) >= 0 ? '+' : ''}${(trade.pnl_pct ?? 0).toFixed(1)}%`} colors={colors} accent />
      </View>

      {/* Times + ORB levels */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
          In {fmtTime(trade.entry_time)} · Out {fmtTime(trade.exit_time)}
        </Text>
      </View>
      {(trade.orh != null || trade.orl != null) && (
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>
          ORH ${(trade.orh ?? 0).toFixed(2)} · ORL ${(trade.orl ?? 0).toFixed(2)}
          {trade.vix_at_entry != null ? `  VIX ${trade.vix_at_entry.toFixed(1)}` : ''}
        </Text>
      )}

      {/* Exit reason */}
      <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ backgroundColor: exitColor + '22', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ color: exitColor, fontSize: 11, fontWeight: '700' }}>{trade.exit_reason}</Text>
        </View>
        {trade.exit_stages && trade.exit_stages.length > 1 && (
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            {trade.exit_stages.map(s => `${s.reason} ${s.qty}×$${s.premium.toFixed(2)}`).join(' → ')}
          </Text>
        )}
      </View>
    </View>
  );
}

function MiniStat({ label, value, colors, accent = false }: { label: string; value: string; colors: ReturnType<typeof useThemeColors>; accent?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: accent ? colors.accent : colors.text, fontSize: 14, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 10, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

// ── AI Review section ─────────────────────────────────────────────────────────
function MarkdownSection({ parsed, colors }: {
  parsed: ReturnType<typeof parseMarkdown>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View>
      {parsed.map((block, i) => {
        if (block.type === 'h1') {
          return null; // skip h1 — it's the date header we already show
        }
        if (block.type === 'h2') {
          return (
            <Text key={i} style={{ color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 20, marginBottom: 6, letterSpacing: 0.3 }}>
              {block.content}
            </Text>
          );
        }
        if (block.type === 'divider') {
          return (
            <View key={i} style={{ height: 1, backgroundColor: colors.separator, marginVertical: 14 }} />
          );
        }
        // Text block — render markdown table rows specially
        const lines = block.content.split('\n').filter(l => l.trim());
        return (
          <View key={i}>
            {lines.map((line, j) => {
              const trimmed = line.trim();
              // Table separator
              if (/^\|[-\s|]+\|$/.test(trimmed)) return null;
              // Table row
              if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
                return (
                  <View key={j} style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.separator + '55' }}>
                    {cells.map((cell, ci) => (
                      <Text key={ci} style={{ flex: 1, color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>
                        {cell}
                      </Text>
                    ))}
                  </View>
                );
              }
              // Bold **text**
              const boldParts = trimmed.split(/(\*\*[^*]+\*\*)/g);
              const hasFormatting = boldParts.length > 1;
              return (
                <Text key={j} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 2 }}>
                  {hasFormatting ? boldParts.map((part, pi) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                      return <Text key={pi} style={{ fontWeight: '700', color: colors.text }}>{part.slice(2, -2)}</Text>;
                    }
                    return part;
                  }) : trimmed}
                </Text>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export function ReviewDetailModal({ date, visible, onClose }: Props) {
  const colors = useThemeColors();
  const { data, isLoading, error } = usePerformanceReview(date);
  const review = data?.data;

  const parsedMd = useMemo(
    () => review?.markdown ? parseMarkdown(review.markdown) : [],
    [review?.markdown],
  );

  const trades: ReviewTrade[] = useMemo(() => {
    if (!review?.trades_json) return [];
    if (Array.isArray(review.trades_json)) return review.trades_json as ReviewTrade[];
    return [];
  }, [review?.trades_json]);

  const paperTrades = trades.filter(t => t.paper_mode);
  const liveTrades = trades.filter(t => !t.paper_mode);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 14 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>Daily Review</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{date ?? '—'}</Text>
          </View>
          {review && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: pnlColor(review.net_pnl, colors), fontSize: 22, fontWeight: '800' }}>
                {fmtPnl(review.net_pnl)}
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Net P&L</Text>
            </View>
          )}
        </View>

        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={{ color: colors.textSecondary, marginTop: 12 }}>Generating review…</Text>
          </View>
        ) : error ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
            <Text style={{ color: colors.error, marginTop: 12, textAlign: 'center' }}>
              {(error as Error).message}
            </Text>
          </View>
        ) : review ? (
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
            {/* Summary stats */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
              <StatBox label="Trades" value={String(review.trade_count)} colors={colors} />
              <StatBox label="Winners" value={String(review.winners)} colors={colors} color={colors.success} />
              <StatBox label="Losers" value={String(review.losers)} colors={colors} color={colors.error} />
              <StatBox label="Win %" value={`${review.win_rate.toFixed(0)}%`} colors={colors} color={colors.accent} />
            </View>

            {/* Paper trades */}
            {paperTrades.length > 0 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ backgroundColor: '#FF9F0A22', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
                    <Text style={{ color: '#FF9F0A', fontSize: 11, fontWeight: '700' }}>PAPER</Text>
                  </View>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8 }}>
                    {paperTrades.length} TRADE{paperTrades.length !== 1 ? 'S' : ''}
                  </Text>
                  <Text style={{ color: pnlColor(paperTrades.reduce((s, t) => s + (t.pnl ?? 0), 0), colors), fontSize: 13, fontWeight: '700', marginLeft: 'auto' }}>
                    {fmtPnl(paperTrades.reduce((s, t) => s + (t.pnl ?? 0), 0))}
                  </Text>
                </View>
                {paperTrades.map((t, i) => <TradeCard key={`paper-${i}`} trade={t} colors={colors} />)}
              </>
            )}

            {/* Live trades */}
            {liveTrades.length > 0 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: paperTrades.length > 0 ? 8 : 0, marginBottom: 10 }}>
                  <View style={{ backgroundColor: colors.success + '22', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
                    <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>LIVE</Text>
                  </View>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8 }}>
                    {liveTrades.length} TRADE{liveTrades.length !== 1 ? 'S' : ''}
                  </Text>
                  <Text style={{ color: pnlColor(liveTrades.reduce((s, t) => s + (t.pnl ?? 0), 0), colors), fontSize: 13, fontWeight: '700', marginLeft: 'auto' }}>
                    {fmtPnl(liveTrades.reduce((s, t) => s + (t.pnl ?? 0), 0))}
                  </Text>
                </View>
                {liveTrades.map((t, i) => <TradeCard key={`live-${i}`} trade={t} colors={colors} />)}
              </>
            )}

            {/* AI analysis */}
            {parsedMd.length > 0 && (
              <>
                <View style={{ height: 1, backgroundColor: colors.separator, marginVertical: 20 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Ionicons name="sparkles" size={14} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 }}>AI ANALYSIS</Text>
                </View>
                <MarkdownSection parsed={parsedMd} colors={colors} />
              </>
            )}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function StatBox({ label, value, colors, color }: {
  label: string; value: string;
  colors: ReturnType<typeof useThemeColors>;
  color?: string;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: color ?? colors.text, fontSize: 18, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 10, marginTop: 2 }}>{label}</Text>
    </View>
  );
}
