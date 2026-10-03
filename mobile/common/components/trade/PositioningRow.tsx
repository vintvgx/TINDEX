import { View, Text, StyleSheet } from 'react-native';
import { usePositioning } from '@/hooks/queries/ticker/useTickerBrief';

/**
 * Entry-sheet "contract factor" row, under the technicals: the options-
 * positioning read in plain language ("Headwind — target $13.00 beyond
 * $12.50 call wall") with its +1 / 0 / −1 modifier. Confluence only — it
 * never changes the gate's ENTER / WAIT / DON'T ENTER and never blocks.
 */
export function PositioningRow({ ticker, direction, expiry, colors }: {
  ticker: string | null | undefined;
  direction: 'CALL' | 'PUT';
  expiry?: string | null;
  colors: any;
}) {
  const q = usePositioning(ticker, direction, expiry);
  const d = q.data?.data;

  const tone = !d ? colors.textTertiary
    : d.modifier > 0 ? colors.success
    : d.modifier < 0 ? colors.error
    : d.flags.crowded_caution ? colors.warning
    : colors.textSecondary;

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={s.header}>
        <Text style={[s.label, { color: colors.textTertiary }]}>POSITIONING</Text>
        {d ? (
          <View style={[s.pill, { backgroundColor: tone + '1F', borderColor: tone + '55' }]}>
            <Text style={[s.pillText, { color: tone }]}>{d.modifier > 0 ? '+1' : d.modifier < 0 ? '−1' : '0'}</Text>
          </View>
        ) : null}
      </View>
      {q.isLoading && !q.data ? (
        <Text style={[s.muted, { color: colors.textTertiary }]}>Loading…</Text>
      ) : !d ? (
        <Text style={[s.muted, { color: colors.textTertiary }]}>Positioning unavailable</Text>
      ) : (
        <>
          <Text style={[s.headline, { color: colors.text }]}>{d.headline}</Text>
          {d.reasons.length > 1
            ? d.reasons.filter(r => !d.headline.endsWith(r.text)).map(r => (
                <Text key={r.component} style={[s.reason, { color: colors.textSecondary }]}>
                  {r.score > 0 ? '+' : '−'} {r.text}
                </Text>
              ))
            : null}
          {d.notes.filter(n => n !== d.headline).map(n => (
            <Text key={n} style={[s.reason, { color: colors.warning }]}>{n}</Text>
          ))}
          <Text style={[s.caption, { color: colors.textTertiary }]}>
            OI-based estimate, chain ~15 min delayed · does not change the gate verdict
          </Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  headline: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  reason: { fontSize: 12, lineHeight: 17 },
  muted: { fontSize: 13, fontStyle: 'italic' },
  caption: { fontSize: 11, marginTop: 4 },
});
