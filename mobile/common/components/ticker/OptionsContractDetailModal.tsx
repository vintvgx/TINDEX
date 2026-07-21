import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/lib/useColorScheme';
import type { OptionsOpportunity } from '@/common/types/blogPosts/ticker';

interface Props {
  visible: boolean;
  onClose: () => void;
  contract: OptionsOpportunity | null;
  ticker: string;
  currentPrice: number;
  isTracked?: boolean;
  onTrackContract?: () => void;
  onUntrackContract?: () => void;
  isTracking?: boolean;
  isUntracking?: boolean;
  /** Price recorded in the tracking snapshot when the contract was first added to the watchlist */
  trackedPrice?: number | null;
  /** Actual live contract price at the time the modal was opened (mirrors the card's livePrice) */
  liveContractPrice?: number | null;
  /**
   * Optional custom bottom-bar content. When provided it replaces the default
   * track/untrack action (e.g. the Immediate Trade controls). Keeps this modal
   * decoupled from the strategy domain — the caller supplies the action UI.
   */
  footer?: React.ReactNode;
  /**
   * Opens a trade-entry sheet for this exact contract (profile + qty +
   * paper/live). Shown alongside the default Track/Untrack button, not in
   * place of it — ignored entirely when `footer` is provided, since a custom
   * footer already takes full ownership of the bottom bar.
   */
  onTrade?: () => void;
  /**
   * Optional full-screen background tint (e.g. paper/live mode color from an
   * immediate-trade flow) — a subtle wash behind the whole modal so the mode
   * a caller is trading in stays visible on the confirm screen, not just the
   * screen before it. Deliberately generic (a raw color, not a paperMode
   * boolean) so this modal — also used for plain watchlist tracking, which
   * has no paper/live concept at all — stays decoupled from the trading
   * domain; callers that don't trade just never pass this.
   */
  tintColor?: string;
}

const fc = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v);

const fp = (v: number) => `${(v * 100).toFixed(2)}%`;

const Row = ({
  label, value, colors,
}: {
  label: string; value: string; colors: ReturnType<typeof useThemeColors>;
}) => (
  <View style={[r.row, { borderBottomColor: colors.separator }]}>
    <Text style={[r.label, { color: colors.textSecondary }]}>{label}</Text>
    <Text style={[r.value, { color: colors.text }]}>{value}</Text>
  </View>
);

const r = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: '600' },
});

export const OptionsContractDetailModal: React.FC<Props> = ({
  visible, onClose, contract, ticker, currentPrice,
  isTracked = false, onTrackContract, onUntrackContract,
  isTracking = false, isUntracking = false,
  trackedPrice = null,
  liveContractPrice = null,
  footer,
  onTrade,
  tintColor,
}) => {
  const colors = useThemeColors();
  const [greeksInfoOpen, setGreeksInfoOpen] = useState(false);
  if (!contract) return null;

  // Subtle wash, not a solid fill — this covers the whole scrollable content
  // area (lots of text/rows), unlike the small badges elsewhere that use a
  // much stronger tint at '12'-'25' alpha.
  const rootBg = tintColor ? tintColor + '0A' : colors.background;

  // Change vs. the initial tracked price — use liveContractPrice so it
  // mirrors the card exactly (null when no live data → change row hidden).
  const trackedChange = liveContractPrice != null && trackedPrice != null
    ? liveContractPrice - trackedPrice
    : null;
  const trackedChangePct = trackedChange != null && trackedPrice != null && trackedPrice > 0
    ? (trackedChange / trackedPrice) * 100
    : null;
  const changeColor = trackedChange == null ? colors.text
    : trackedChange >= 0 ? colors.success : colors.error;

  const isCall = contract.optionType === 'CALL';
  const typeColor = isCall ? colors.success : colors.error;
  const hasScore = contract.total_score > 0;
  const hasGreeks = contract.delta != null || contract.gamma != null || contract.theta != null || contract.vega != null;

  const signalColor =
    contract.signal === 'BUY' ? colors.success :
    contract.signal === 'AVOID' ? colors.error :
    '#F59E0B';

  const expiryLabel = (() => {
    try {
      return new Date(`${contract.expirationDate}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
    } catch { return contract.expirationDate; }
  })();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: rootBg }}>
        {/* ── Header ── */}
        <View style={[s.header, { borderBottomColor: colors.separator }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.symbol, { color: colors.text }]} numberOfLines={1}>
              {contract.contractSymbol}
            </Text>
            <Text style={[s.subhead, { color: colors.textSecondary }]}>
              {ticker}{currentPrice > 0 ? ` · $${currentPrice.toFixed(2)}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={[s.closeBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: footer ? 230 : 130 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero card ── */}
          <View style={[s.heroCard, { backgroundColor: typeColor + '12', borderColor: typeColor + '35' }]}>
            <View style={s.heroTop}>
              <View style={s.heroLeft}>
                <View style={[s.typePill, { backgroundColor: typeColor + '25', borderColor: typeColor + '50' }]}>
                  <Ionicons
                    name={isCall ? 'trending-up' : 'trending-down'}
                    size={14}
                    color={typeColor}
                  />
                  <Text style={[s.typePillText, { color: typeColor }]}>{contract.optionType}</Text>
                </View>
                <Text style={[s.heroTicker, { color: colors.text }]}>{ticker}</Text>
                <Text style={[s.heroStrike, { color: colors.textSecondary }]}>
                  Strike {fc(contract.strike)}
                </Text>
              </View>

              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {isTracked && (
                  <View style={[s.trackedBadge, { backgroundColor: colors.accent + '20', borderColor: colors.accent + '50' }]}>
                    <Ionicons name="bookmark" size={12} color={colors.accent} />
                    <Text style={[s.trackedText, { color: colors.accent }]}>Tracked</Text>
                  </View>
                )}
                {hasScore && (
                  <View style={[s.signalBadge, { backgroundColor: signalColor + '20' }]}>
                    <Text style={[s.signalText, { color: signalColor }]}>{contract.signal}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Score */}
            {hasScore && (
              <View style={[s.scoreBox, { backgroundColor: colors.background + 'BB' }]}>
                <Text style={[s.scoreMeta, { color: colors.textSecondary }]}>OptionsAnalyzer Score</Text>
                <Text style={[s.scoreNum, { color: colors.text }]}>{contract.total_score.toFixed(1)}</Text>
              </View>
            )}
          </View>

          {/* ── Pricing ── */}
          <Text style={[s.sectionTitle, { color: colors.text }]}>Pricing</Text>
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {contract.lastPrice != null && (
              <Row label="Last Price" value={fc(contract.lastPrice)} colors={colors} />
            )}
            <Row label="Midpoint" value={fc(contract.mark)} colors={colors} />

            {/* Tracked-price section — only shown when this contract is in the watchlist */}
            {trackedPrice != null && (
              <Row label="Tracked At" value={fc(trackedPrice)} colors={colors} />
            )}
            {trackedChange != null && trackedChangePct != null && (
              <View style={[r.row, { borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[r.label, { color: colors.textSecondary }]}>Change</Text>
                <Text style={[r.value, { color: changeColor }]}>
                  {trackedChange >= 0 ? '+' : ''}{fc(trackedChange)} ({trackedChange >= 0 ? '+' : ''}{trackedChangePct.toFixed(1)}%)
                </Text>
              </View>
            )}

            <Row label="Bid" value={fc(contract.bid)} colors={colors} />
            <Row label="Ask" value={fc(contract.ask)} colors={colors} />
            <View style={[r.row, { borderBottomWidth: 0 }]}>
              <Text style={[r.label, { color: colors.textSecondary }]}>Spread</Text>
              <Text style={[r.value, { color: colors.text }]}>{contract.spreadPct.toFixed(2)}%</Text>
            </View>
          </View>

          {/* ── Contract details ── */}
          <Text style={[s.sectionTitle, { color: colors.text }]}>Contract Details</Text>
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Row label="Expiration" value={expiryLabel} colors={colors} />
            {contract.dte > 0 && <Row label="Days to Expiry" value={`${contract.dte} days`} colors={colors} />}
            <Row label="Volume" value={contract.volume.toLocaleString()} colors={colors} />
            <View style={[r.row, { borderBottomWidth: 0 }]}>
              <Text style={[r.label, { color: colors.textSecondary }]}>Open Interest</Text>
              <Text style={[r.value, { color: colors.text }]}>{contract.openInterest.toLocaleString()}</Text>
            </View>
          </View>

          {/* ── Greeks ── */}
          {hasGreeks && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 4 }}>
                <Text style={[s.sectionTitle, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>Greeks</Text>
                <TouchableOpacity
                  onPress={() => setGreeksInfoOpen(o => !o)}
                  hitSlop={8}
                  style={[s.infoBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Ionicons
                    name={greeksInfoOpen ? 'close-circle-outline' : 'information-circle-outline'}
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text style={[s.infoBtnText, { color: colors.textSecondary }]}>
                    {greeksInfoOpen ? 'Hide' : 'What are Greeks?'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Greeks definitions panel */}
              {greeksInfoOpen && (
                <View style={[s.greeksInfo, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {[
                    {
                      symbol: 'Δ', name: 'Delta', def:
                        'How much the option price changes for every $1 move in the stock. A delta of 0.50 means the option gains ~$0.50 when the stock rises $1. Calls are positive (0 to 1); puts are negative (−1 to 0).',
                    },
                    {
                      symbol: 'Γ', name: 'Gamma', def:
                        'How fast delta itself changes per $1 move. High gamma means your delta exposure can shift rapidly — the option becomes more or less sensitive quickly, especially near expiration.',
                    },
                    {
                      symbol: 'Θ', name: 'Theta', def:
                        'Daily time decay — how much value the option loses each day as expiration approaches. Negative for long options. An option with theta −0.05 loses ~$5 per contract per day all else equal.',
                    },
                    {
                      symbol: 'V', name: 'Vega', def:
                        'Sensitivity to implied volatility. A vega of 0.10 means the option gains/loses ~$0.10 for every 1% change in IV. Long options benefit from rising IV; short options benefit from falling IV.',
                    },
                  ].map((g, i, arr) => (
                    <View
                      key={g.name}
                      style={[
                        s.greeksRow,
                        i < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
                      ]}
                    >
                      <View style={[s.greeksSymbol, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '30' }]}>
                        <Text style={[s.greeksSymbolText, { color: colors.accent }]}>{g.symbol}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.greeksName, { color: colors.text }]}>{g.name}</Text>
                        <Text style={[s.greeksDef, { color: colors.textSecondary }]}>{g.def}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {contract.delta != null && <Row label="Delta (Δ)" value={contract.delta.toFixed(4)} colors={colors} />}
                {contract.gamma != null && <Row label="Gamma (Γ)" value={contract.gamma.toFixed(4)} colors={colors} />}
                {contract.theta != null && <Row label="Theta (Θ)" value={contract.theta.toFixed(4)} colors={colors} />}
                {contract.vega != null && (
                  <View style={[r.row, { borderBottomWidth: 0 }]}>
                    <Text style={[r.label, { color: colors.textSecondary }]}>Vega (V)</Text>
                    <Text style={[r.value, { color: colors.text }]}>{contract.vega.toFixed(4)}</Text>
                  </View>
                )}
              </View>
            </>
          )}

          {/* ── Volatility + value ── */}
          {contract.impliedVolatility > 0 && (
            <>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Volatility & Value</Text>
              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Row label="Implied Volatility" value={fp(contract.impliedVolatility)} colors={colors} />
                {contract.intrinsicValue > 0 && <Row label="Intrinsic Value" value={fc(contract.intrinsicValue)} colors={colors} />}
                {contract.extrinsicValue > 0 && <Row label="Extrinsic Value" value={fc(contract.extrinsicValue)} colors={colors} />}
                {contract.moneyness !== 0 && (
                  <View style={[r.row, { borderBottomWidth: 0 }]}>
                    <Text style={[r.label, { color: colors.textSecondary }]}>Moneyness</Text>
                    <Text style={[r.value, { color: colors.text }]}>{contract.moneyness.toFixed(3)}</Text>
                  </View>
                )}
              </View>
            </>
          )}

          {/* ── Analysis ── */}
          {contract.reasons ? (
            <>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Analysis</Text>
              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 14 }]}>
                <Text style={[{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }]}>{contract.reasons}</Text>
              </View>
            </>
          ) : null}

          {/* ── Score breakdown ── */}
          {contract.score_breakdown && hasScore && (
            <>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Score Breakdown</Text>
              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {Object.entries(contract.score_breakdown).map(([k, v], i, arr) => (
                  <View key={k} style={[r.row, i === arr.length - 1 ? { borderBottomWidth: 0 } : {}]}>
                    <Text style={[r.label, { color: colors.textSecondary }]}>
                      {k.charAt(0).toUpperCase() + k.slice(1)}
                    </Text>
                    <Text style={[r.value, { color: colors.text }]}>{(v as number).toFixed(1)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>

        {/* ── Bottom action ── */}
        <View style={[s.bottomBar, { backgroundColor: rootBg, borderTopColor: colors.separator }]}>
          {footer ? footer : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {isTracked ? (
                <TouchableOpacity
                  onPress={onUntrackContract}
                  disabled={isUntracking}
                  activeOpacity={0.8}
                  style={[s.actionBtn, { flex: 1, backgroundColor: colors.error + '18', borderColor: colors.error + '50', opacity: isUntracking ? 0.5 : 1 }]}
                >
                  {isUntracking ? (
                    <ActivityIndicator color={colors.error} />
                  ) : (
                    <>
                      <Ionicons name="bookmark-outline" size={18} color={colors.error} />
                      <Text style={[s.actionText, { color: colors.error }]}>Remove</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : onTrackContract ? (
                <TouchableOpacity
                  onPress={onTrackContract}
                  disabled={isTracking}
                  activeOpacity={0.8}
                  style={[s.actionBtn, { flex: 1, backgroundColor: colors.accent + '18', borderColor: colors.accent + '50', opacity: isTracking ? 0.5 : 1 }]}
                >
                  {isTracking ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <>
                      <Ionicons name="add-circle" size={18} color={colors.accent} />
                      <Text style={[s.actionText, { color: colors.accent }]}>Watchlist</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}

              {onTrade && (
                <TouchableOpacity
                  onPress={onTrade}
                  activeOpacity={0.8}
                  style={[s.actionBtn, { flex: 1, backgroundColor: colors.success + '1E', borderColor: colors.success + '55' }]}
                >
                  <Ionicons name="flash" size={18} color={colors.success} />
                  <Text style={[s.actionText, { color: colors.success }]}>Trade</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  symbol: { fontSize: 16, fontWeight: '700' },
  subhead: { fontSize: 13, marginTop: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  heroCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  heroLeft: { gap: 4 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  typePillText: { fontSize: 12, fontWeight: '700' },
  heroTicker: { fontSize: 22, fontWeight: '800' },
  heroStrike: { fontSize: 14 },
  trackedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  trackedText: { fontSize: 11, fontWeight: '700' },
  signalBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  signalText: { fontSize: 12, fontWeight: '700' },
  scoreBox: { borderRadius: 10, padding: 14, alignItems: 'center' },
  scoreMeta: { fontSize: 11, fontWeight: '500', marginBottom: 4 },
  scoreNum: { fontSize: 36, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8, marginTop: 4 },
  card: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, marginBottom: 18 },
  infoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  infoBtnText: { fontSize: 12, fontWeight: '500' },
  greeksInfo: {
    borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: 'hidden',
  },
  greeksRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12,
  },
  greeksSymbol: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  greeksSymbolText: { fontSize: 16, fontWeight: '700' },
  greeksName: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  greeksDef: { fontSize: 12, lineHeight: 17 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1,
  },
  actionText: { fontSize: 15, fontWeight: '700' },
});
