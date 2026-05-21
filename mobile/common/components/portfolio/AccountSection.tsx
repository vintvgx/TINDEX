import { View, Text } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { HoldingRow } from './HoldingRow';
import type { AccountGroup } from '@/hooks/queries/plaid/usePlaidPortfolio';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

interface Props {
  group: AccountGroup;
}

export function AccountSection({ group }: Props) {
  const colors = useThemeColors();
  const { account, equities, options } = group;

  const balance = account.balances.current;
  const hasEquities = equities.length > 0;
  const hasOptions = options.length > 0;

  const subtype = account.subtype
    ? account.subtype.charAt(0).toUpperCase() + account.subtype.slice(1)
    : account.type;

  return (
    <View style={{
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      {/* Account header */}
      <View style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: hasEquities || hasOptions ? 1 : 0,
        borderBottomColor: colors.separator,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{account.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <View style={{
              paddingHorizontal: 7, paddingVertical: 2,
              backgroundColor: colors.surfaceSecondary,
              borderRadius: 6,
            }}>
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
                {subtype}
              </Text>
            </View>
          </View>
        </View>
        {balance != null && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '500' }}>Cash</Text>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 1 }}>
              {fmt(balance)}
            </Text>
          </View>
        )}
      </View>

      {/* Equities */}
      {hasEquities && equities.map((item, i) => (
        <View key={`${item.holding.security_id}-${i}`}>
          <HoldingRow item={item} />
          {(i < equities.length - 1 || hasOptions) && (
            <View style={{ height: 1, backgroundColor: colors.separator, marginHorizontal: 16 }} />
          )}
        </View>
      ))}

      {/* Options sub-header */}
      {hasOptions && (
        <>
          <View style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: colors.surfaceSecondary,
            borderTopWidth: hasEquities ? 1 : 0,
            borderTopColor: colors.separator,
          }}>
            <Text style={{
              color: colors.textSecondary,
              fontSize: 11, fontWeight: '700',
              textTransform: 'uppercase', letterSpacing: 0.6,
            }}>
              Options
            </Text>
          </View>
          {options.map((item, i) => (
            <View key={`${item.holding.security_id}-opt-${i}`}>
              <HoldingRow item={item} />
              {i < options.length - 1 && (
                <View style={{ height: 1, backgroundColor: colors.separator, marginHorizontal: 16 }} />
              )}
            </View>
          ))}
        </>
      )}

      {!hasEquities && !hasOptions && (
        <View style={{ padding: 16 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
            No positions in this account
          </Text>
        </View>
      )}
    </View>
  );
}
