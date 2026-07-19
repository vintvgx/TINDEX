import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatContractSymbol } from '@/lib/formatContract';
import type { SocialSignalContract } from '@/common/types/social';

interface Props {
  contract: SocialSignalContract;
  livePrice?: number;
  colors: any;
  onEnter: () => void;
  onRemove: () => void;
  removing?: boolean;
}

export function SignalCard({ contract, livePrice, colors, onEnter, onRemove, removing = false }: Props) {
  const entry = contract.tracked_entry_price;
  // Prefer the live WS tick; fall back to the 5-min-poll-backed current_price
  // (OptionsContractMonitorService) so the card still shows something useful
  // before the first WS tick arrives, or if the WS is momentarily down.
  const current = livePrice ?? contract.current_price ?? entry;
  const change = entry && current != null ? current - entry : null;
  const pct = entry && change != null && entry > 0 ? (change / entry) * 100 : null;
  const isUp = (change ?? 0) >= 0;
  const pnlColor = change == null ? colors.textTertiary : isUp ? colors.success : colors.error;
  const dirColor = contract.option_type === 'CALL' ? colors.success : colors.error;
  const handle = contract.tracking_snapshot?.account_handle;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: pnlColor }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Text style={[styles.ticker, { color: colors.text }]}>{contract.ticker}</Text>
          <View style={[styles.dirPill, { backgroundColor: dirColor + '1A' }]}>
            <Ionicons name={contract.option_type === 'CALL' ? 'trending-up' : 'trending-down'} size={10} color={dirColor} />
            <Text style={[styles.dirText, { color: dirColor }]}>{contract.option_type}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={onRemove} disabled={removing} hitSlop={8}>
          {removing ? (
            <ActivityIndicator size="small" color={colors.tabBarInactive} />
          ) : (
            <Ionicons name="close" size={18} color={colors.tabBarInactive} />
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.contract, { color: colors.textSecondary }]} numberOfLines={1}>
        {formatContractSymbol(contract.contract_symbol)}
      </Text>

      <View style={styles.priceRow}>
        <View>
          <Text style={[styles.priceLabel, { color: colors.tabBarInactive }]}>Entry</Text>
          <Text style={[styles.priceValue, { color: colors.text }]}>
            {entry != null ? `$${entry.toFixed(2)}` : '—'}
          </Text>
        </View>
        <Ionicons name="arrow-forward" size={14} color={colors.tabBarInactive} />
        <View>
          <Text style={[styles.priceLabel, { color: colors.tabBarInactive }]}>Live</Text>
          <Text style={[styles.priceValue, { color: pnlColor }]}>
            {current != null ? `$${current.toFixed(2)}` : '—'}
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          {change != null && pct != null ? (
            <View style={[styles.pctPill, { backgroundColor: pnlColor + '18' }]}>
              <Text style={[styles.pctText, { color: pnlColor }]}>
                {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{pct.toFixed(1)}%)
              </Text>
            </View>
          ) : (
            <Text style={{ color: colors.tabBarInactive, fontSize: 12 }}>awaiting price…</Text>
          )}
        </View>
      </View>

      {(handle || contract.tracking_reason) && (
        <Text style={[styles.source, { color: colors.tabBarInactive }]} numberOfLines={2}>
          {handle ? `@${handle}` : ''}{handle && contract.tracking_reason ? ' · ' : ''}
          {contract.tracking_reason}
        </Text>
      )}

      <TouchableOpacity
        onPress={onEnter}
        activeOpacity={0.85}
        style={[styles.enterBtn, { backgroundColor: colors.accent }]}
      >
        <Ionicons name="flash" size={15} color={colors.accentForeground ?? '#fff'} />
        <Text style={[styles.enterText, { color: colors.accentForeground ?? '#fff' }]}>Enter</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, borderLeftWidth: 3, padding: 14, gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticker: { fontSize: 17, fontWeight: '800' },
  dirPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  dirText: { fontSize: 10, fontWeight: '800' },
  contract: { fontSize: 12, fontWeight: '600' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priceLabel: { fontSize: 10, marginBottom: 1 },
  priceValue: { fontSize: 15, fontWeight: '700' },
  pctPill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  pctText: { fontSize: 13, fontWeight: '700' },
  source: { fontSize: 11, lineHeight: 15, fontStyle: 'italic' },
  enterBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 10, marginTop: 2 },
  enterText: { fontSize: 14, fontWeight: '700' },
});
