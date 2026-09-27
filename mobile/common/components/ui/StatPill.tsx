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
      // Without this, a horizontal ScrollView's row children default to
      // shrinking to fit the visible width instead of keeping their natural
      // size and letting the row scroll — squeezing every pill narrower than
      // its content (clipped/truncated labels and values) the moment enough
      // pills are added to overflow the screen.
      flexShrink: 0,
      // Explicit height, independent of text-metric quirks below — a pill
      // whose real rendered height ever disagreed with what the parent
      // ScrollView measured could visually bleed into whatever sits right
      // after the scrollable row.
      minHeight: 68,
      justifyContent: 'center',
    }}>
      <Text
        style={{
          color: colors.textTertiary, fontSize: 10, lineHeight: 13, fontWeight: '700',
          textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={{ color: accentColor, fontSize: 18, lineHeight: 22, fontWeight: '800', letterSpacing: -0.3 }}
        numberOfLines={1}
      >
        {value}
      </Text>
      {sub != null && (
        <Text
          style={{ color: accentColor + 'CC', fontSize: 11, lineHeight: 14, fontWeight: '600', marginTop: 3 }}
          numberOfLines={1}
        >
          {sub}
        </Text>
      )}
    </View>
  );
}
