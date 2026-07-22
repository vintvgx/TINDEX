import { Text, View } from 'react-native';

/**
 * Compact stat card for a horizontally-scrollable row: uppercase muted label
 * on top, a big bold accent-colored value, and an optional sub-line — same
 * pattern originally built for FeedMarketPulseStrip's ticker/VIX/Flow pills.
 * Extracted here so any screen needing a scrollable stats row (Accounts,
 * Live Positions) reuses the same visual language instead of redefining it.
 */
export function StatPill({
  label, value, sub, accentColor, colors,
}: {
  label: string; value: string; sub?: string; accentColor: string; colors: any;
}) {
  return (
    <View style={{
      backgroundColor: accentColor + '14',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: accentColor + '30',
      paddingHorizontal: 14,
      paddingVertical: 11,
      minWidth: 96,
      marginRight: 8,
    }}>
      <Text style={{
        color: colors.textTertiary, fontSize: 10, fontWeight: '700',
        textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4,
      }}>
        {label}
      </Text>
      <Text style={{ color: accentColor, fontSize: 21, fontWeight: '800', letterSpacing: -0.5 }} numberOfLines={1}>
        {value}
      </Text>
      {sub != null && (
        <Text style={{ color: accentColor + 'CC', fontSize: 11, fontWeight: '600', marginTop: 3 }} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}
