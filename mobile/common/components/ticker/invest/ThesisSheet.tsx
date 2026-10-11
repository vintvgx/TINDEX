import React from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { Thesis } from '@/hooks/queries/ticker/useThesis';

/**
 * Bandit's investing thesis for a ticker (invest-tab-thesis-mock, sheet
 * side): verdict chip + conviction + horizon → summary → "For you,
 * specifically" → bull / bear → what changes this → educational footer.
 * Pure renderer — the thesis is written by Bandit and delivered by the
 * backend (see useThesis); missing sections simply don't render.
 */

function verdictColor(verdict: string, colors: ReturnType<typeof useThemeColors>): string {
  const v = verdict.toUpperCase();
  if (/SELL|AVOID|TRIM|EXIT/.test(v)) return colors.error;
  if (/BUY|ADD|ACCUMULATE|HOLD/.test(v)) return colors.success;
  return colors.warning;
}

export function ThesisSheet({ visible, onClose, ticker, thesis, generatedAt, staleReason }: {
  visible: boolean;
  onClose: () => void;
  ticker: string;
  thesis: Thesis;
  generatedAt?: string;
  staleReason?: string | null;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const tone = verdictColor(thesis.verdict, colors);
  const written = generatedAt ? new Date(generatedAt) : null;
  const writtenLabel = written
    ? written.toDateString() === new Date().toDateString()
      ? written.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : written.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  const meta = [
    thesis.conviction != null ? `Conviction ${thesis.conviction}/10` : null,
    thesis.horizon ? `horizon ${thesis.horizon}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={[s.grabber, { backgroundColor: colors.textTertiary }]} />
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{ticker}</Text>
            <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              Thesis by Bandit{writtenLabel ? ` · written ${writtenLabel}` : ''}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close thesis">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 26 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {!!staleReason && (
            <View style={[s.box, { backgroundColor: colors.warning + '12', borderColor: colors.warning + '44', marginTop: 4 }]}>
              <Text style={{ fontSize: 12.5, color: colors.warning, fontWeight: '700' }}>
                ⚠ Your thesis may be stale — {staleReason.toLowerCase()}.
              </Text>
            </View>
          )}

          <View style={s.verdictRow}>
            <View style={[s.tag, { borderColor: tone + '66', backgroundColor: tone + '14' }]}>
              <Text style={{ fontSize: 15, fontWeight: '800', letterSpacing: 1, color: tone }}>{thesis.verdict}</Text>
            </View>
          </View>
          {!!meta && <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 10 }}>{meta}</Text>}

          <View style={[s.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 14.5, lineHeight: 24, color: colors.text }}>{thesis.summary}</Text>
          </View>

          {!!thesis.for_you?.length && (
            <>
              <Text style={[s.sec, { color: colors.textSecondary }]}>FOR YOU, SPECIFICALLY</Text>
              <View style={[s.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Bullets items={thesis.for_you} color={colors.textSecondary} />
              </View>
            </>
          )}

          {!!thesis.bull?.length && (
            <View style={[s.box, s.case, { backgroundColor: colors.success + '0D', borderColor: colors.success + '33' }]}>
              <Text style={[s.caseHead, { color: colors.success }]}>BULL CASE</Text>
              <Bullets items={thesis.bull} color={colors.textSecondary} />
            </View>
          )}
          {!!thesis.bear?.length && (
            <View style={[s.box, s.case, { backgroundColor: colors.error + '0D', borderColor: colors.error + '33' }]}>
              <Text style={[s.caseHead, { color: colors.error }]}>BEAR CASE / RISKS</Text>
              <Bullets items={thesis.bear} color={colors.textSecondary} />
            </View>
          )}

          {!!thesis.what_changes && (
            <View style={[s.box, s.case, { backgroundColor: colors.warning + '0D', borderColor: colors.warning + '33' }]}>
              <Text style={{ fontSize: 13, lineHeight: 21, color: colors.warning }}>
                <Text style={{ fontWeight: '800' }}>⚠ What changes this: </Text>
                {thesis.what_changes}
              </Text>
            </View>
          )}

          <Text style={[s.fine, { color: colors.textTertiary }]}>
            Investing view (months to years) — a different question from the trading verdict.{'\n'}
            Educational only, not financial advice.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Bullets({ items, color }: { items: string[]; color: string }) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color, fontSize: 13.5, lineHeight: 21 }}>•</Text>
          <Text style={{ flex: 1, color, fontSize: 13.5, lineHeight: 21 }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '88%',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 10, marginBottom: 4, opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 6, paddingBottom: 4 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 8 },
  tag: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  box: { borderWidth: 1, borderRadius: 14, padding: 14 },
  case: { marginTop: 12 },
  caseHead: { fontSize: 12, letterSpacing: 1.5, fontWeight: '700', marginBottom: 8 },
  sec: { fontSize: 11, letterSpacing: 2, marginTop: 18, marginBottom: 8 },
  fine: { textAlign: 'center', fontSize: 11, lineHeight: 16, marginTop: 16 },
});
