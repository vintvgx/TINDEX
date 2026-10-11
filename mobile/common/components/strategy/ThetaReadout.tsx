import React from 'react';
import { Text } from 'react-native';
import { useMarketStream } from '@/hooks/useMarketStream';
import { estimateTheta } from '@/lib/thetaEstimate';

/** Above this share of the premium lost per hour, add the warning line. */
const AGGRESSIVE_PCT_PER_HOUR = 0.15;

/**
 * `θ −$0.10/hr est.` under a position's premium row (0DTE / short-dated
 * only — see estimateTheta for when it hides). Recomputes off the card's
 * live premium; the underlying comes from the app-wide /ws/prices socket
 * (no new connection). In premium units ($/share), like the premium row
 * it sits under.
 */
export function ThetaReadout({ ticker, contract, premium, colors, style }: {
  ticker: string;
  contract: string | null | undefined;
  premium: number | null | undefined;
  colors: any;
  style?: object;
}) {
  const { livePrices } = useMarketStream(ticker ? [ticker.toUpperCase()] : []);
  const theta = estimateTheta({ contract, premium, underlying: livePrices[ticker?.toUpperCase()] });
  if (!theta) return null;
  const perHour = Math.abs(theta.perHour);
  const aggressive = theta.pctPerHour > AGGRESSIVE_PCT_PER_HOUR;
  return (
    <Text style={[{ fontFamily: 'Menlo', fontSize: 11, color: colors.textSecondary ?? colors.tabBarInactive }, style]}>
      θ −${perHour.toFixed(2)}/hr est.
      {aggressive ? (
        <Text style={{ color: colors.warning, fontWeight: '700' }}>
          {`  ·  losing ~${Math.round(theta.pctPerHour * 100)}%/hr to time`}
        </Text>
      ) : null}
    </Text>
  );
}
