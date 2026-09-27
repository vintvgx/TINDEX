import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { verdictColor } from './EntryTechnicalsPanel';

interface Props {
  check: EntryCheck | undefined;
  checkLoading: boolean;
  paperMode: boolean;
  label: string;              // e.g. "Buy CALL × 3"
  onReview: () => void;
  /** Lifted so the review sheet can recap that the technicals were overridden. */
  overridden: boolean;
  onOverride: (v: boolean) => void;
  colors: any;
}

/**
 * The entry sheet's buy button, gated on the technicals verdict:
 *  - DON'T ENTER → neutral, shows the top blocker; proceeding takes two
 *    deliberate taps (tap → "I understand…" confirm → tap it).
 *  - WAIT → active, missing conditions listed underneath.
 *  - ENTER → active.
 * It never submits — it only opens the Review sheet.
 */
export function GatedBuyButton({ check, checkLoading, paperMode, label, onReview, overridden, onOverride, colors }: Props) {
  const [confirming, setConfirming] = useState(false);
  const decision = check?.verdict.decision;
  const muted = colors.textSecondary ?? colors.tabBarInactive;
  const modeColor = paperMode ? colors.accent : colors.error;
  const modeFg = paperMode ? (colors.accentForeground ?? '#fff') : '#fff';

  // A verdict that improves out of DON'T ENTER drops any pending confirm.
  useEffect(() => {
    if (decision !== 'DONT_ENTER') setConfirming(false);
  }, [decision]);

  const blocked = decision === 'DONT_ENTER' && !overridden;
  const waitingForFirstCheck = !check && checkLoading;

  if (blocked) {
    const topBlocker = check!.verdict.blockers[0]
      ?? check!.verdict.reason.replace(/^DON'T ENTER — /, '');
    return (
      <View>
        <TouchableOpacity
          onPress={() => setConfirming(true)}
          activeOpacity={0.8}
          style={[s.btn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.error + '88' }]}
        >
          <Ionicons name="hand-left" size={17} color={colors.error} />
          <Text style={[s.btnText, { color: colors.error }]}>DON'T ENTER</Text>
        </TouchableOpacity>
        <Text style={[s.note, { color: colors.error }]} numberOfLines={3}>{topBlocker}</Text>
        {confirming && (
          <TouchableOpacity
            onPress={() => { onOverride(true); setConfirming(false); }}
            activeOpacity={0.8}
            style={[s.overrideBtn, { borderColor: colors.error }]}
          >
            <Ionicons name="warning" size={15} color={colors.error} />
            <Text style={[s.overrideText, { color: colors.error }]}>
              I understand the technicals are against this trade
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity
        onPress={onReview}
        disabled={waitingForFirstCheck}
        activeOpacity={0.85}
        style={[s.btn, { backgroundColor: waitingForFirstCheck ? colors.border : modeColor }]}
      >
        <Ionicons name="receipt-outline" size={17} color={modeFg} />
        <Text style={[s.btnText, { color: modeFg }]}>
          {waitingForFirstCheck ? 'Checking technicals…' : `Review ${paperMode ? '' : 'LIVE '}${label}`}
        </Text>
      </TouchableOpacity>

      {overridden && decision === 'DONT_ENTER' && (
        <TouchableOpacity onPress={() => onOverride(false)} hitSlop={6}>
          <Text style={[s.note, { color: colors.error }]}>
            Overriding DON'T ENTER · tap to undo
          </Text>
        </TouchableOpacity>
      )}
      {decision === 'WAIT' && check!.verdict.missing.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {check!.verdict.missing.slice(0, 3).map(m => (
            <Text key={m} style={[s.missing, { color: verdictColor('WAIT', colors) }]}>• {m}</Text>
          ))}
        </View>
      )}
      {!check && !checkLoading && (
        <Text style={[s.note, { color: muted }]}>Technicals unavailable — no verdict for this entry.</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  btn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12 },
  btnText:      { fontSize: 15, fontWeight: '700' },
  note:         { fontSize: 12, lineHeight: 17, marginTop: 8, textAlign: 'center' },
  missing:      { fontSize: 12, lineHeight: 17 },
  overrideBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed' },
  overrideText: { fontSize: 13, fontWeight: '700' },
});
