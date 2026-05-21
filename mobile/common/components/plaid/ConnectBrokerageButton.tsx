import { ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { useBrokerageConnect } from '@/hooks/mutations/plaid/useBrokerageConnect';

interface Props {
  onSuccess?: () => void;
}

export function ConnectBrokerageButton({ onSuccess }: Props) {
  const colors = useThemeColors();
  const { connect, isLinking, isExchanging } = useBrokerageConnect();
  const isLoading = isLinking || isExchanging;

  async function handlePress() {
    await connect();
    onSuccess?.();
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isLoading}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        backgroundColor: colors.iconButton,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.iconButtonBorder,
        opacity: isLoading ? 0.6 : 1,
      }}
    >
      {isLoading && <ActivityIndicator size="small" color={colors.text} />}
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
        {isLinking ? 'Opening...' : isExchanging ? 'Connecting...' : 'Connect Brokerage'}
      </Text>
    </TouchableOpacity>
  );
}
