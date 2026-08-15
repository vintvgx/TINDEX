import type React from 'react';
import { useState, useEffect } from 'react';
import { View, Text, Image } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';

interface TickerLogoProps {
  uri?: string;
  ticker: string;
  size: number;
  borderRadius?: number;
}

/**
 * Company logo with a graceful fallback: if the URL is missing, or the image
 * fails to load (e.g. the logo CDN 404s for that ticker), shows the ticker's
 * first letter on a tinted background instead of leaving a blank gap.
 */
export const TickerLogo: React.FC<TickerLogoProps> = ({ uri, ticker, size, borderRadius }) => {
  const colors = useThemeColors();
  const [failed, setFailed] = useState(false);

  // A new ticker may reuse a URL that previously failed for a different
  // symbol's stale component instance — reset so each ticker gets its own try.
  useEffect(() => setFailed(false), [uri]);

  const showImage = !!uri && !failed;
  const radius = borderRadius ?? size / 4;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: colors.surfaceSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: size * 0.4 }}>
          {ticker[0]?.toUpperCase()}
        </Text>
      )}
    </View>
  );
};
