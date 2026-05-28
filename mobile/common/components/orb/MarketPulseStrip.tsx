import { View, Text } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import type { MarketSentiment } from '@/hooks/useMarketStream';
import type { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';

interface Props {
  vix:       number | null;
  spy:       number | null;
  sentiment: MarketSentiment | null;
  orbData:   ORBMonitoringState[];
  livePrices: Record<string, number>;
  connected: boolean;
}

const SENTIMENT_HEX: Record<string, string> = {
  green:  '#30D158',
  gray:   '#8E8E93',
  yellow: '#FFD60A',
  orange: '#FF9F0A',
  red:    '#FF453A',
};

function computeFlow(orbData: ORBMonitoringState[], livePrices: Record<string, number>) {
  let up = 0, down = 0;
  for (const item of orbData) {
    const price = livePrices[item.ticker] ?? item.current_price;
    const ref   = item.opening_price ?? item.previous_close;
    if (price == null || ref == null || ref === 0) continue;
    if (price > ref) up++;
    else if (price < ref) down++;
  }
  const total = up + down;
  if (total === 0) return { label: 'No Data', up: 0, down: 0, color: '#8E8E93' };
  const label = up > down ? 'Bullish' : down > up ? 'Bearish' : 'Mixed';
  const color = label === 'Bullish' ? '#30D158' : label === 'Bearish' ? '#FF453A' : '#8E8E93';
  return { label, up, down, color };
}

export function MarketPulseStrip({ vix, spy, sentiment, orbData, livePrices, connected }: Props) {
  const colors = useThemeColors();
  const flow = computeFlow(orbData, livePrices);
  const sentimentColor = sentiment ? (SENTIMENT_HEX[sentiment.color] ?? colors.textSecondary) : colors.textSecondary;

  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.separator,
      backgroundColor: colors.surface,
      gap: 6,
    }}>

      {/* VIX — primary metric */}
      <View style={{
        flex: 1.2,
        backgroundColor: sentimentColor + '14',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: sentimentColor + '30',
        paddingHorizontal: 10,
        paddingVertical: 7,
      }}>
        <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>
          VIX
        </Text>
        <Text style={{ color: sentimentColor, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 }}>
          {vix != null ? vix.toFixed(2) : '—'}
        </Text>
        <Text style={{ color: sentimentColor + 'CC', fontSize: 10, fontWeight: '600', marginTop: 1 }}>
          {sentiment?.label ?? '—'}
        </Text>
      </View>

      {/* SPY */}
      <View style={{
        flex: 1,
        backgroundColor: colors.surfaceSecondary,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: 10,
        paddingVertical: 7,
      }}>
        <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>
          SPY
        </Text>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 }}>
          {spy != null ? `$${spy.toFixed(2)}` : '—'}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '500', marginTop: 1 }}>
          S&P 500 ETF
        </Text>
      </View>

      {/* Flow */}
      <View style={{
        flex: 1,
        backgroundColor: flow.color + '14',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: flow.color + '30',
        paddingHorizontal: 10,
        paddingVertical: 7,
      }}>
        <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>
          Flow
        </Text>
        <Text style={{ color: flow.color, fontSize: 14, fontWeight: '800', marginBottom: 1 }}>
          {flow.label}
        </Text>
        {flow.up + flow.down > 0 && (
          <Text style={{ color: flow.color + 'CC', fontSize: 10, fontWeight: '600' }}>
            {flow.up}↑ · {flow.down}↓
          </Text>
        )}
      </View>

      {/* Live indicator */}
      <View style={{ alignItems: 'center', gap: 3, paddingHorizontal: 2 }}>
        <View style={{
          width: 7, height: 7, borderRadius: 4,
          backgroundColor: connected ? '#30D158' : '#FF453A',
        }} />
        <Text style={{ color: colors.textTertiary, fontSize: 8, fontWeight: '600' }}>
          {connected ? 'LIVE' : 'OFF'}
        </Text>
      </View>
    </View>
  );
}
