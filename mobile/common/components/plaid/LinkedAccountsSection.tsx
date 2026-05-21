import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useThemeColors } from '@/lib/useColorScheme';
import { useLinkedAccounts } from '@/hooks/queries/plaid/useLinkedAccounts';
import { unlinkAccount } from '@/common/services/PlaidService';
import { LINKED_ACCOUNTS_QUERY_KEY } from '@/hooks/queries/plaid/useLinkedAccounts';
import { PLAID_HOLDINGS_QUERY_KEY } from '@/hooks/queries/plaid/usePlaidHoldings';
import { ConnectBrokerageButton } from './ConnectBrokerageButton';
import type { PlaidLinkedAccount } from '@/common/types/plaid';

function groupByInstitution(accounts: PlaidLinkedAccount[]) {
  return accounts.reduce<Record<string, PlaidLinkedAccount[]>>((acc, a) => {
    const key = a.institution_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});
}

export function LinkedAccountsSection() {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const { data: accounts, isLoading } = useLinkedAccounts();

  const unlinkMutation = useMutation({
    mutationFn: unlinkAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LINKED_ACCOUNTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PLAID_HOLDINGS_QUERY_KEY] });
    },
  });

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 16, alignItems: 'center' }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  const grouped = groupByInstitution(accounts ?? []);
  const institutions = Object.keys(grouped);

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Linked Brokerages
        </Text>
        <ConnectBrokerageButton />
      </View>

      {institutions.length === 0 ? (
        <View
          style={{
            padding: 16,
            backgroundColor: colors.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
            No brokerage accounts linked yet.{'\n'}Connect one to import your portfolio.
          </Text>
        </View>
      ) : (
        institutions.map((name) => (
          <View
            key={name}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.separator,
              }}
            >
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{name}</Text>
              <TouchableOpacity
                onPress={() => unlinkMutation.mutate(grouped[name][0].item_id)}
                disabled={unlinkMutation.isPending}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.error, fontSize: 13, fontWeight: '500' }}>
                  {unlinkMutation.isPending ? 'Removing...' : 'Disconnect'}
                </Text>
              </TouchableOpacity>
            </View>

            {grouped[name].map((account) => (
              <View
                key={account.account_id}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                    {account.account_name}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                    {account.account_subtype ?? account.account_type}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );
}
