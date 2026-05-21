import { View, Text } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { HoldingRow } from './HoldingRow';
import type { AccountGroup } from '@/hooks/queries/plaid/usePlaidPortfolio';

interface Props {
  group: AccountGroup;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AccountSection({ group }: Props) {
  const colors = useThemeColors();
  const { account, institutionName, equities, options } = group;

  const balance = account.balances.current;
  const subtype = account.subtype ?? account.type;
  const hasHoldings = equities.length > 0 || options.length > 0;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        marginBottom: 12,
      }}
    >
      {/* Account header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: hasHoldings ? 1 : 0,
          borderBottomColor: colors.separator,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
            {institutionName}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              {account.name}
            </Text>
            {subtype ? (
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  backgroundColor: colors.surfaceSecondary,
                  borderRadius: 6,
                }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
                  {subtype.toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {balance != null && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '500' }}>
              BALANCE
            </Text>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 1 }}>
              ${fmt(balance)}
            </Text>
          </View>
        )}
      </View>

      {/* Equities */}
      {equities.length > 0 && (
        <View>
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 6,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 11,
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              Equities
            </Text>
            <View
              style={{
                backgroundColor: colors.surfaceSecondary,
                borderRadius: 8,
                paddingHorizontal: 6,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
                {equities.length}
              </Text>
            </View>
          </View>
          {equities.map((item) => (
            <View
              key={`${item.holding.account_id}-${item.holding.security_id}`}
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.separator,
              }}
            >
              <HoldingRow item={item} />
            </View>
          ))}
        </View>
      )}

      {/* Options */}
      {options.length > 0 && (
        <View>
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 6,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderTopWidth: equities.length > 0 ? 1 : 0,
              borderTopColor: colors.separator,
            }}
          >
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 11,
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              Options
            </Text>
            <View
              style={{
                backgroundColor: colors.surfaceSecondary,
                borderRadius: 8,
                paddingHorizontal: 6,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
                {options.length}
              </Text>
            </View>
          </View>
          {options.map((item) => (
            <View
              key={`${item.holding.account_id}-${item.holding.security_id}`}
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.separator,
              }}
            >
              <HoldingRow item={item} />
            </View>
          ))}
        </View>
      )}

      {!hasHoldings && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
            No holdings in this account.
          </Text>
        </View>
      )}
    </View>
  );
}
