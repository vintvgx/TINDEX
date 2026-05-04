import React from 'react';
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
}) => {
  const colors = useThemeColors();
  if (!contract) return null;

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
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
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
          contentContainerStyle={{ padding: 16, paddingBottom: 130 }}
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
              <Text style={[s.sectionTitle, { color: colors.text }]}>Greeks</Text>
              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {contract.delta != null && <Row label="Delta" value={contract.delta.toFixed(4)} colors={colors} />}
                {contract.gamma != null && <Row label="Gamma" value={contract.gamma.toFixed(4)} colors={colors} />}
                {contract.theta != null && <Row label="Theta" value={contract.theta.toFixed(4)} colors={colors} />}
                {contract.vega != null && (
                  <View style={[r.row, { borderBottomWidth: 0 }]}>
                    <Text style={[r.label, { color: colors.textSecondary }]}>Vega</Text>
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
        <View style={[s.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.separator }]}>
          {isTracked ? (
            <TouchableOpacity
              onPress={onUntrackContract}
              disabled={isUntracking}
              activeOpacity={0.8}
              style={[s.actionBtn, { backgroundColor: colors.error + '18', borderColor: colors.error + '50', opacity: isUntracking ? 0.5 : 1 }]}
            >
              {isUntracking ? (
                <ActivityIndicator color={colors.error} />
              ) : (
                <>
                  <Ionicons name="bookmark-outline" size={18} color={colors.error} />
                  <Text style={[s.actionText, { color: colors.error }]}>Remove from Watchlist</Text>
                </>
              )}
            </TouchableOpacity>
          ) : onTrackContract ? (
            <TouchableOpacity
              onPress={onTrackContract}
              disabled={isTracking}
              activeOpacity={0.8}
              style={[s.actionBtn, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '50', opacity: isTracking ? 0.5 : 1 }]}
            >
              {isTracking ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <>
                  <Ionicons name="add-circle" size={18} color={colors.accent} />
                  <Text style={[s.actionText, { color: colors.accent }]}>Add to Watchlist</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
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
