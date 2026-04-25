import type React from 'react';
import { View, Text, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TickerData } from '@/common/types/blogPosts/ticker';
import { useThemeColors } from '@/lib/useColorScheme';

interface StockInfoHeaderProps {
  stockData: TickerData;
}

export const StockInfoHeader: React.FC<StockInfoHeaderProps> = ({ stockData }) => {
  const colors = useThemeColors();
  const priceChangePositive = (stockData.price_change ?? 0) >= 0;
  const priceColor = priceChangePositive ? colors.success : colors.error;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 }}>
      <View style={{ flex: 1 }}>
        {/* Company logo + name */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          {stockData.logo_url && (
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: colors.surface,
                marginRight: 10,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: 'hidden',
              }}
            >
              <Image source={{ uri: stockData.logo_url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </View>
          )}
          {stockData.company_name && (
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }} numberOfLines={1}>
              {stockData.company_name}
            </Text>
          )}
        </View>

        {/* Ticker symbol */}
        {stockData.ticker && (
          <Text style={{ color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginBottom: 2 }}>
            {stockData.ticker}
          </Text>
        )}

        {/* Sector */}
        {stockData.sector && (
          <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '500' }}>{stockData.sector}</Text>
        )}
      </View>

      {/* Price */}
      <View style={{ alignItems: 'flex-end' }}>
        {stockData.current_price && (
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>
            ${stockData.current_price.toFixed(2)}
          </Text>
        )}
        {stockData.price_change !== undefined && stockData.price_change_percent !== undefined && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
            <Ionicons
              name="triangle"
              size={10}
              color={priceColor}
              style={{ transform: [{ rotate: priceChangePositive ? '0deg' : '180deg' }] }}
            />
            <Text style={{ color: priceColor, fontWeight: '700', fontSize: 13 }}>
              {priceChangePositive ? '+' : ''}
              {stockData.price_change.toFixed(2)} ({stockData.price_change_percent.toFixed(2)}%)
            </Text>
          </View>
        )}
        {stockData.currency && (
          <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>{stockData.currency}</Text>
        )}
      </View>
    </View>
  );
};
