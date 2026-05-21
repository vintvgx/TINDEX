import { View, Text } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import type { EnrichedHolding } from '@/hooks/queries/plaid/usePlaidPortfolio';

interface Props {
  item: EnrichedHolding;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

export function HoldingRow({ item }: Props) {
  const colors = useThemeColors();
  const { holding, security, isOption, pnl, pnlPct, parsedOption } = item;

  const pnlColor =
    pnl == null ? colors.textSecondary : pnl >= 0 ? colors.success : colors.error;

  if (isOption && parsedOption) {
    const { underlying, expiryStr, callPut, strike } = parsedOption;
    const contracts = holding.quantity;
    const label =
      [
        underlying ?? security.name?.slice(0, 6) ?? '—',
        expiryStr ? expiryStr.slice(2) : null,
        callPut ? callPut.toUpperCase() : null,
        strike != null ? `$${strike}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 11,
          paddingHorizontal: 16,
          gap: 12,
        }}
      >
        {/* Type badge */}
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            backgroundColor:
              callPut === 'call' ? colors.successBg : colors.errorBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              color: callPut === 'call' ? colors.success : colors.error,
              letterSpacing: 0.3,
            }}
          >
            {callPut === 'call' ? 'CALL' : 'PUT'}
          </Text>
        </View>

        {/* Name + contracts */}
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
            {contracts === 1 ? '1 contract' : `${contracts} contracts`}
          </Text>
        </View>

        {/* Value */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
            ${fmt(holding.institution_value)}
          </Text>
          {pnl != null && (
            <Text style={{ color: pnlColor, fontSize: 12, marginTop: 1 }}>
              {pnl >= 0 ? '+' : ''}${fmt(pnl)}
              {pnlPct != null ? `  ${fmtPct(pnlPct)}` : ''}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // Equity / ETF / other
  const ticker = security.ticker_symbol ?? security.name?.slice(0, 6) ?? '—';
  const displayName =
    security.name && security.name !== ticker
      ? security.name.length > 26
        ? security.name.slice(0, 24) + '…'
        : security.name
      : null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 11,
        paddingHorizontal: 16,
        gap: 12,
      }}
    >
      {/* Ticker badge */}
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          backgroundColor: colors.surfaceSecondary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: ticker.length > 4 ? 9 : 11,
            fontWeight: '700',
            color: colors.text,
            letterSpacing: 0.2,
          }}
          numberOfLines={1}
        >
          {ticker}
        </Text>
      </View>

      {/* Name + shares */}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
          {ticker}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
          {displayName
            ? `${displayName} · ${holding.quantity % 1 === 0 ? holding.quantity : holding.quantity.toFixed(4)} sh`
            : `${holding.quantity % 1 === 0 ? holding.quantity : holding.quantity.toFixed(4)} shares`}
        </Text>
      </View>

      {/* Value + P&L */}
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
          ${fmt(holding.institution_value)}
        </Text>
        {pnl != null ? (
          <Text style={{ color: pnlColor, fontSize: 12, marginTop: 1 }}>
            {pnl >= 0 ? '+' : ''}${fmt(pnl)}
            {pnlPct != null ? `  ${fmtPct(pnlPct)}` : ''}
          </Text>
        ) : (
          <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 1 }}>
            ${fmt(holding.institution_price)} / sh
          </Text>
        )}
      </View>
    </View>
  );
}
