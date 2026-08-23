import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useCreateKeyLevel } from '@/hooks/mutations/priceLevels/useCreateKeyLevel';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useToast } from '@/common/components/ui/Toast';
import type { FlowChecklist } from '@/common/types/agent';

// Build OCC option symbol: e.g. PLTR260828C00185000 (same convention as AddContractSheet)
const buildOCCSymbol = (ticker: string, expiry: string, type: 'CALL' | 'PUT', strike: number) => {
  const [yr, mo, dy] = expiry.split('-');
  return `${ticker}${yr.slice(2)}${mo}${dy}${type[0]}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
};

const fmtExpiry = (d: string) => {
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
};

export type ChecklistStatus = 'pending' | 'submitted' | 'skipped';

interface Props {
  checklist: FlowChecklist;
  status: ChecklistStatus;
  onResolved: (status: 'submitted' | 'skipped') => void;
  colors: ReturnType<typeof useThemeColors>;
}

export const ChecklistCard: React.FC<Props> = ({ checklist, status, onResolved, colors }) => {
  const { authState: { user } } = useAuth();
  const { mutateAsync: createLevel } = useCreateKeyLevel();
  const { mutateAsync: trackContract } = useTrackContract();
  const toast = useToast();

  const hasZone = !!checklist.watch_zone;
  const [zoneEnabled, setZoneEnabled] = useState(hasZone);
  const [contractsEnabled, setContractsEnabled] = useState<boolean[]>(
    () => checklist.contracts.map(() => true),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isBullish = checklist.sentiment === 'bullish';
  const isEither = checklist.sentiment === 'either';
  const dirColor = isEither ? colors.accent : isBullish ? colors.success : checklist.sentiment === 'bearish' ? colors.error : colors.textTertiary;
  const canAct = !!checklist.ticker && status === 'pending';
  const anySelected = zoneEnabled || contractsEnabled.some(Boolean);

  const toggleContract = (i: number) => {
    if (status !== 'pending') return;
    setContractsEnabled(prev => prev.map((v, idx) => (idx === i ? !v : v)));
  };

  const handleSubmit = async () => {
    if (!checklist.ticker || !user?.id || !anySelected) return;
    setIsSubmitting(true);

    let zoneOk = true;
    let contractFailures = 0;

    if (zoneEnabled && checklist.watch_zone) {
      try {
        await createLevel({
          userId: user.id,
          ticker: checklist.ticker,
          direction: checklist.sentiment ?? 'bullish',
          levelLow: checklist.watch_zone.low,
          levelHigh: checklist.watch_zone.high,
          source: 'discord_admin',
          notes: checklist.summary,
        });
      } catch (e: any) {
        zoneOk = false;
        toast.error(e?.message || 'Failed to set watch zone');
      }
    }

    for (let i = 0; i < checklist.contracts.length; i++) {
      if (!contractsEnabled[i]) continue;
      const c = checklist.contracts[i];
      try {
        await trackContract({
          userId: user.id,
          ticker: checklist.ticker,
          contractSymbol: buildOCCSymbol(checklist.ticker, c.expiration_date, c.option_type, c.strike),
          optionType: c.option_type,
          strike: c.strike,
          expirationDate: c.expiration_date,
          trackingSnapshot: {},
          trackedFromSource: 'manual',
          trackingReason: c.note ? `From flow screenshot: ${c.note}` : 'From flow screenshot',
        });
      } catch (e: any) {
        contractFailures++;
        toast.error(e?.message || `Failed to track ${c.option_type} $${c.strike}`);
      }
    }

    setIsSubmitting(false);
    onResolved('submitted');
    const doneCount = (zoneEnabled && zoneOk ? 1 : 0) + (contractsEnabled.filter(Boolean).length - contractFailures);
    if (doneCount > 0) toast.success(`Applied ${doneCount} item${doneCount !== 1 ? 's' : ''} from the checklist`);
  };

  const summaryLines = useMemo(() => {
    const lines: string[] = [];
    if (zoneEnabled && checklist.watch_zone) {
      const z = checklist.watch_zone;
      lines.push(`Watching ${z.low === z.high ? `$${z.low.toFixed(2)}` : `$${z.low.toFixed(2)}–$${z.high.toFixed(2)}`}`);
    }
    checklist.contracts.forEach((c, i) => {
      if (contractsEnabled[i]) lines.push(`Tracking ${c.option_type} $${c.strike} ${fmtExpiry(c.expiration_date)}`);
    });
    return lines;
  }, [zoneEnabled, contractsEnabled, checklist]);

  return (
    <View style={[cc.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={cc.headerRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="document-text-outline" size={14} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>
            {checklist.ticker ?? 'Unknown ticker'}
          </Text>
          {checklist.sentiment && (
            <Ionicons name={isEither ? 'swap-vertical' : isBullish ? 'trending-up' : 'trending-down'} size={13} color={dirColor} />
          )}
        </View>
        {status !== 'pending' && (
          <View style={[cc.statusPill, {
            backgroundColor: (status === 'submitted' ? colors.success : colors.textTertiary) + '18',
            borderColor: (status === 'submitted' ? colors.success : colors.textTertiary) + '40',
          }]}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: status === 'submitted' ? colors.success : colors.textTertiary, textTransform: 'uppercase' }}>
              {status}
            </Text>
          </View>
        )}
      </View>

      {checklist.summary ? (
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 }}>
          {checklist.summary}
        </Text>
      ) : null}

      {!checklist.ticker && status === 'pending' && (
        <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 8, fontStyle: 'italic' }}>
          I couldn't identify a ticker — reply below to tell me which one this is.
        </Text>
      )}

      {status === 'pending' ? (
        <View style={{ marginTop: 10, gap: 6 }}>
          {hasZone && checklist.watch_zone && (
            <TouchableOpacity onPress={() => setZoneEnabled(v => !v)} activeOpacity={0.7} style={cc.row}>
              <Ionicons
                name={zoneEnabled ? 'checkmark-circle' : 'ellipse-outline'}
                size={19}
                color={zoneEnabled ? colors.accent : colors.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                  Set watch zone {checklist.watch_zone.low === checklist.watch_zone.high
                    ? `$${checklist.watch_zone.low.toFixed(2)}`
                    : `$${checklist.watch_zone.low.toFixed(2)}–$${checklist.watch_zone.high.toFixed(2)}`}
                </Text>
                <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 1 }}>
                  {isEither
                    ? "Confirms on a candle close outside the zone, either way — you'll get suggested contracts then"
                    : `Confirms on a candle close ${isBullish ? 'above' : 'below'} — you'll get suggested contracts then`}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {checklist.contracts.map((c, i) => (
            <TouchableOpacity key={`${c.option_type}-${c.strike}-${c.expiration_date}`} onPress={() => toggleContract(i)} activeOpacity={0.7} style={cc.row}>
              <Ionicons
                name={contractsEnabled[i] ? 'checkmark-circle' : 'ellipse-outline'}
                size={19}
                color={contractsEnabled[i] ? colors.accent : colors.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[cc.badge, {
                    backgroundColor: (c.option_type === 'CALL' ? colors.success : colors.error) + '20',
                    borderColor: (c.option_type === 'CALL' ? colors.success : colors.error) + '40',
                  }]}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: c.option_type === 'CALL' ? colors.success : colors.error }}>
                      {c.option_type}
                    </Text>
                  </View>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                    ${c.strike % 1 === 0 ? c.strike.toFixed(0) : c.strike.toFixed(2)} · {fmtExpiry(c.expiration_date)}
                  </Text>
                </View>
                {c.note ? (
                  <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                    {c.note}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={{ marginTop: 10, gap: 3 }}>
          {status === 'submitted' ? (
            summaryLines.length > 0 ? summaryLines.map((line, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="checkmark" size={13} color={colors.success} />
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{line}</Text>
              </View>
            )) : (
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Nothing was selected.</Text>
            )
          ) : (
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Skipped — nothing was applied.</Text>
          )}
        </View>
      )}

      {status === 'pending' && (
        <View style={cc.footer}>
          <TouchableOpacity
            onPress={() => onResolved('skipped')}
            disabled={isSubmitting}
            style={[cc.footerBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canAct || !anySelected || isSubmitting}
            style={[cc.footerBtn, { flex: 1.4, backgroundColor: colors.accent, opacity: (!canAct || !anySelected || isSubmitting) ? 0.45 : 1 }]}
          >
            {isSubmitting
              ? <ActivityIndicator size="small" color={colors.accentForeground} />
              : <Text style={{ color: colors.accentForeground, fontSize: 13, fontWeight: '700' }}>Submit</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const cc = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 12, marginTop: 4, maxWidth: '92%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  badge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, borderWidth: 1 },
  footer: { flexDirection: 'row', gap: 8, marginTop: 12 },
  footerBtn: { paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, paddingHorizontal: 16 },
});
