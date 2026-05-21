import { SafeAreaView, ScrollView, View, Text } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { PortfolioSummaryStrip } from '@/common/components/portfolio/PortfolioSummaryStrip';
import { BrokerageHoldingsSection } from '@/common/components/portfolio/BrokerageHoldingsSection';
import { ManualPositionsSection } from '@/common/components/portfolio/ManualPositionsSection';

export default function PortfolioScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 }}>
          Portfolio
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500', marginTop: 2 }}>
          Holdings & Positions
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <PortfolioSummaryStrip />
        <BrokerageHoldingsSection />
        <View style={{ marginTop: 24 }}>
          <ManualPositionsSection />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
