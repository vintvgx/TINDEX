import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { usePlaidPortfolio } from '@/hooks/queries/plaid/usePlaidPortfolio';
import { useLinkedAccounts } from '@/hooks/queries/plaid/useLinkedAccounts';
import { ConnectBrokerageButton } from '@/common/components/plaid/ConnectBrokerageButton';
import { AccountSection } from './AccountSection';

export function BrokerageHoldingsSection() {
  const colors = useThemeColors();
  const { groups, isLoading, error, refetch } = usePlaidPortfolio();
  const { data: linkedAccounts, isLoading: accountsLoading } = useLinkedAccounts();

  const noLinkedAccounts = !accountsLoading && (!linkedAccounts || linkedAccounts.length === 0);

  return (
    <View>
      {/* Section header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          Brokerage
        </Text>
        <ConnectBrokerageButton />
      </View>

      {/* No linked accounts */}
      {noLinkedAccounts && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 24,
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
            No brokerage connected
          </Text>
          <Text
            style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 }}
          >
            Connect your brokerage account to import your portfolio, holdings, and options positions.
          </Text>
          <View style={{ marginTop: 4 }}>
            <ConnectBrokerageButton />
          </View>
        </View>
      )}

      {/* Loading */}
      {!noLinkedAccounts && isLoading && (
        <View style={{ paddingVertical: 32, alignItems: 'center', gap: 12 }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
            Loading holdings…
          </Text>
        </View>
      )}

      {/* Error */}
      {!noLinkedAccounts && !isLoading && error && (
        <View
          style={{
            backgroundColor: colors.errorBg,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.error,
            padding: 16,
            gap: 8,
          }}
        >
          <Text style={{ color: colors.error, fontSize: 14, fontWeight: '600' }}>
            Failed to load holdings
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            {error instanceof Error ? error.message : 'Unknown error'}
          </Text>
          <TouchableOpacity onPress={() => refetch()} activeOpacity={0.7}>
            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Account groups */}
      {!isLoading && !error && groups.length > 0 &&
        groups.map((group) => (
          <AccountSection key={group.account.account_id} group={group} />
        ))}

      {/* Linked but no holdings returned yet */}
      {!noLinkedAccounts && !isLoading && !error && groups.length === 0 && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 20,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
            Holdings are syncing. This can take a moment after linking.
          </Text>
        </View>
      )}
    </View>
  );
}
