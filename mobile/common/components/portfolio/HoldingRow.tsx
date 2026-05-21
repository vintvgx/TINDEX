import { View, Text, TouchableOpacity } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import type { EnrichedHolding } from '@/hooks/queries/plaid/usePlaidPortfolio';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

interface Props {
  item: EnrichedHolding;
  onPress?: () => void;
}

export function HoldingRow({ item, onPress }: Props) {
  const colors = useThemeColors();
  const { security, holding, liveValue, livePnl, livePnlPct, parsedOption, isOption, livePrice } = item;

  const pnlColor = livePnl == null ? colors.textSecondary : livePnl >= 0 ? colors.success : colors.error;

  // Equity row
  if (!isOption) {
    const ticker = security.ticker_symbol ?? security.name?.slice(0, 6) ?? '—';
    const shares = holding.quantity % 1 === 0
      ? `${holding.quantity} sh`
      : `${holding.quantity.toFixed(4)} sh`;

    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={onPress ? 0.7 : 1}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 }}
      >
        {/* Ticker badge */}
        <View style={{
          width: 44, height: 44, borderRadius: 10,
          backgroundColor: colors.surfaceSecondary,
          alignItems: 'center', justifyContent: 'center',
          marginRight: 12, flexShrink: 0,
        }}>
          <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700', letterSpacing: -0.3 }} numberOfLines={1}>
            {ticker.length > 4 ? ticker.slice(0, 4) : ticker}
          </Text>
        </View>

        {/* Name + shares */}
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{ticker}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
            {shares} · {fmt(livePrice)}/sh
          </Text>
        </View>

        {/* Value + P&L */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{fmt(liveValue)}</Text>
          {livePnl != null && (
            <Text style={{ color: pnlColor, fontSize: 12, marginTop: 1 }}>
              {livePnl >= 0 ? '+' : ''}{fmt(livePnl)} {livePnlPct != null ? `(${fmtPct(livePnlPct)})` : ''}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // Option (derivative) row
  const opt = parsedOption;
  const label = opt?.underlying
    ? `${opt.underlying} ${opt.expiryStr ? opt.expiryStr.slice(5) : ''} ${opt.callPut === 'call' ? 'Call' : opt.callPut === 'put' ? 'Put' : ''} $${opt.strike ?? '—'}`
    : (security.name ?? 'Option');

  const contracts = holding.quantity;
  const contractLabel = contracts === 1 ? '1 contract' : `${contracts} contracts`;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 }}
    >
      {/* Option badge */}
      <View style={{
        width: 44, height: 44, borderRadius: 10,
        backgroundColor: opt?.callPut === 'call'
          ? 'rgba(48,209,88,0.15)'
          : opt?.callPut === 'put'
            ? 'rgba(255,69,58,0.15)'
            : colors.surfaceSecondary,
        alignItems: 'center', justifyContent: 'center',
        marginRight: 12, flexShrink: 0,
      }}>
        <Text style={{
          color: opt?.callPut === 'call' ? colors.success : opt?.callPut === 'put' ? colors.error : colors.textSecondary,
          fontSize: 11, fontWeight: '700',
        }}>
          {opt?.callPut === 'call' ? 'CALL' : opt?.callPut === 'put' ? 'PUT' : 'OPT'}
        </Text>
      </View>

      {/* Label + contracts */}
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{label}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>{contractLabel}</Text>
      </View>

      {/* Value */}
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{fmt(liveValue)}</Text>
        {livePnl != null && (
          <Text style={{ color: pnlColor, fontSize: 12, marginTop: 1 }}>
            {livePnl >= 0 ? '+' : ''}{fmt(livePnl)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
