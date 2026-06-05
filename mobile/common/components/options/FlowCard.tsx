import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import type { FlowAlert } from '@/common/types/flow';
import { formatPremium } from '@/common/types/flow';

interface FlowCardProps {
  alert: FlowAlert;
  onPress?: () => void;
}

const formatExpiry = (d: string): string => {
  const [, m, day] = d.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${day}`;
};

const formatTime = (ts: string): string => {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return '—'; }
};

export const FlowCard: React.FC<FlowCardProps> = ({ alert, onPress }) => {
  const colors = useThemeColors();

  const isCall = alert.contract_type === 'call';
  const contractColor = isCall ? colors.success : colors.error;
  const contractLabel = isCall ? 'CALL' : 'PUT';

  // ask-side = aggressive buy (bullish for calls, bearish for puts)
  // bid-side = aggressive sell
  const sideLabel = alert.side === 'ask' ? 'ASK' : 'BID';
  const sideColor = alert.side === 'ask' ? colors.success : colors.error;

  const premium = formatPremium(alert.premium);
  const strike = parseFloat(alert.strike).toFixed(0);
  const iv = alert.implied_volatility
    ? `${(parseFloat(alert.implied_volatility) * 100).toFixed(1)}%`
    : null;
  const delta = alert.delta ? parseFloat(alert.delta).toFixed(2) : null;
  const score = alert.unusual_score ? parseFloat(alert.unusual_score).toFixed(0) : null;

  const hasSweep = alert.is_sweep;
  const hasFloor = alert.is_floor;
  const hasMultileg = alert.is_multileg;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        marginHorizontal: 16,
        marginBottom: 10,
        padding: 14,
        borderWidth: 1,
        borderColor: contractColor + '30',
        borderLeftWidth: 3,
        borderLeftColor: contractColor,
      }}
    >
      {/* Row 1: Ticker + contract type + premium */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
            {alert.ticker}
          </Text>
          <View style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
            backgroundColor: contractColor + '20',
            borderWidth: 1,
            borderColor: contractColor + '50',
          }}>
            <Text style={{ color: contractColor, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>
              {contractLabel}
            </Text>
          </View>
          {/* Strike + expiry */}
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>
            ${strike} · {formatExpiry(alert.expiry)}
          </Text>
        </View>

        {/* Premium — the most important signal */}
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>
          {premium}
        </Text>
      </View>

      {/* Row 2: Side + size + tags */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Side */}
        <View style={{
          paddingHorizontal: 7,
          paddingVertical: 3,
          borderRadius: 6,
          backgroundColor: sideColor + '15',
          borderWidth: 1,
          borderColor: sideColor + '40',
        }}>
          <Text style={{ color: sideColor, fontSize: 10, fontWeight: '700' }}>
            {sideLabel}
          </Text>
        </View>

        {/* Size */}
        <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500' }}>
          {alert.size.toLocaleString()} contracts
        </Text>

        {/* Sweep badge */}
        {hasSweep && (
          <View style={{
            paddingHorizontal: 7,
            paddingVertical: 3,
            borderRadius: 6,
            backgroundColor: '#FF9F0A20',
            borderWidth: 1,
            borderColor: '#FF9F0A50',
          }}>
            <Text style={{ color: '#FF9F0A', fontSize: 10, fontWeight: '700' }}>
              SWEEP
            </Text>
          </View>
        )}

        {/* Floor badge */}
        {hasFloor && (
          <View style={{
            paddingHorizontal: 7,
            paddingVertical: 3,
            borderRadius: 6,
            backgroundColor: '#5856D620',
            borderWidth: 1,
            borderColor: '#5856D650',
          }}>
            <Text style={{ color: '#5856D6', fontSize: 10, fontWeight: '700' }}>
              FLOOR
            </Text>
          </View>
        )}

        {/* Multileg badge */}
        {hasMultileg && (
          <View style={{
            paddingHorizontal: 7,
            paddingVertical: 3,
            borderRadius: 6,
            backgroundColor: colors.accent + '20',
            borderWidth: 1,
            borderColor: colors.accent + '50',
          }}>
            <Text style={{ color: colors.accent, fontSize: 10, fontWeight: '700' }}>
              MULTILEG
            </Text>
          </View>
        )}
      </View>

      {/* Row 3: Greeks + score + time */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: colors.separator,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {iv && (
            <View>
              <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>IV</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>{iv}</Text>
            </View>
          )}
          {delta && (
            <View>
              <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>Δ Delta</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>{delta}</Text>
            </View>
          )}
          <View>
            <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>OI</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>{alert.open_interest.toLocaleString()}</Text>
          </View>
          <View>
            <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>Vol</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>{alert.volume.toLocaleString()}</Text>
          </View>
        </View>

        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          {score && (
            <View style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 8,
              backgroundColor: colors.accent + '18',
            }}>
              <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>
                {score} Score
              </Text>
            </View>
          )}
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            {formatTime(alert.timestamp)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};
