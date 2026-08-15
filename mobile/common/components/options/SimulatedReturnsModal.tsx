import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Line } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useSimulatedReturns, type SimulatedReturnsRequest } from '@/hooks/queries/options/useSimulatedReturns';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import type { TrackedOptionContract } from '@/common/types/options';

const fc = (v: number) =>
  `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;

const fmtExpiry = (d: string) => {
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  } catch { return d; }
};

interface Props {
  visible: boolean;
  onClose: () => void;
  contract: TrackedOptionContract;
  /** Current underlying spot price. */
  currentSpot: number;
  /** Current live/last price of the contract itself — the grid's "now" point is anchored to this. */
  currentContractPrice: number;
}

const CHART_H = 260;
const RULER_H = 56;
const Y_AXIS_W = 56;

export const SimulatedReturnsModal: React.FC<Props> = ({
  visible, onClose, contract, currentSpot, currentContractPrice,
}) => {
  const colors = useThemeColors();
  const { toTicker } = useBaseNavigation();
  const [plotW, setPlotW] = useState(0);
  const [rulerW, setRulerW] = useState(0);

  const isEntered = contract.status === 'entered';
  const costBasis = isEntered && contract.entry_price != null ? contract.entry_price : currentContractPrice;
  const quantity = contract.position_size ?? 1;

  const request: SimulatedReturnsRequest | null = useMemo(() => {
    if (!currentSpot || !currentContractPrice) return null;
    const snap = contract.tracking_snapshot as Record<string, any> | null;
    const iv = snap?.impliedVolatility;
    if (!iv || iv <= 0) return null;
    return {
      ticker: contract.ticker,
      optionType: contract.option_type,
      strike: contract.strike,
      expirationDate: contract.expiration_date,
      currentSpot,
      impliedVolatility: iv,
      currentContractPrice,
      costBasis,
      quantity,
    };
  }, [contract, currentSpot, currentContractPrice, costBasis, quantity]);

  const { data, isLoading, error } = useSimulatedReturns(request);

  // Index into spotPrices the ruler is currently parked on — defaults to
  // the center (current spot), same as Robinhood's default view.
  const [spotIndex, setSpotIndex] = useState<number | null>(null);
  const centerIndex = data ? Math.floor(data.spotPrices.length / 2) : 0;
  const activeSpotIndex = spotIndex ?? centerIndex;
  const selectedSpot = data?.spotPrices[activeSpotIndex];

  // ── The curve for the currently-selected spot, across every date ──────
  const points = useMemo(() => {
    if (!data) return [];
    return data.dates.map((d, i) => ({ date: d, value: data.pnl[i][activeSpotIndex] }));
  }, [data, activeSpotIndex]);

  const yDomain = useMemo(() => {
    if (!data || points.length === 0) return { lo: -100, hi: 100 };
    const values = points.map(p => p.value);
    const lo = Math.min(...values, data.maxLoss, 0);
    const hi = Math.max(...values, 0);
    const pad = (hi - lo) * 0.1 || 10;
    return { lo: lo - pad, hi: hi + pad };
  }, [data, points]);

  const yForValue = useCallback(
    (v: number) => CHART_H - ((v - yDomain.lo) / (yDomain.hi - yDomain.lo)) * CHART_H,
    [yDomain],
  );
  const xForIndex = useCallback(
    (i: number) => points.length > 1 ? (i / (points.length - 1)) * plotW : 0,
    [points.length, plotW],
  );
  const zeroY = yForValue(0);
  const maxLossY = data ? yForValue(data.maxLoss) : CHART_H;

  // Split the line into green (>=0) / orange (<0) segments, interpolating
  // the exact zero-crossing so the color change lands right on the $0 line
  // instead of snapping between whole data points.
  const { greenPath, orangePath } = useMemo(() => {
    if (points.length === 0 || plotW === 0) return { greenPath: '', orangePath: '' };
    let green = '';
    let orange = '';
    let greenStarted = false;
    let orangeStarted = false;

    const moveOrLine = (path: string, started: boolean, x: number, y: number) =>
      `${path}${started ? ' L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;

    for (let i = 0; i < points.length; i++) {
      const x = xForIndex(i);
      const y = yForValue(points[i].value);
      const isPos = points[i].value >= 0;
      if (isPos) {
        green = moveOrLine(green, greenStarted, x, y);
        greenStarted = true;
        orangeStarted = false;
      } else {
        orange = moveOrLine(orange, orangeStarted, x, y);
        orangeStarted = true;
        greenStarted = false;
      }

      if (i < points.length - 1) {
        const nextPos = points[i + 1].value >= 0;
        if (isPos !== nextPos) {
          // Linear-interpolate the zero crossing between i and i+1.
          const v0 = points[i].value, v1 = points[i + 1].value;
          const t = v0 / (v0 - v1);
          const cx = x + (xForIndex(i + 1) - x) * t;
          const cy = zeroY;
          green = moveOrLine(green, greenStarted, cx, cy);
          orange = moveOrLine(orange, orangeStarted, cx, cy);
          greenStarted = true;
          orangeStarted = true;
        }
      }
    }
    return { greenPath: green, orangePath: orange };
  }, [points, plotW, xForIndex, yForValue, zeroY]);

  // ── Price ruler drag ────────────────────────────────────────────────
  const dragIndexShared = useSharedValue(-1);
  const nSpots = data?.spotPrices.length ?? 0;

  const haptic = useCallback(() => { Haptics.selectionAsync(); }, []);
  const updateIndex = useCallback((idx: number) => setSpotIndex(idx), []);

  const rulerGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          'worklet';
          if (nSpots < 2 || rulerW === 0) return;
          const idx = Math.max(0, Math.min(nSpots - 1, Math.round((e.x / rulerW) * (nSpots - 1))));
          if (idx !== dragIndexShared.value) {
            dragIndexShared.value = idx;
            runOnJS(haptic)();
            runOnJS(updateIndex)(idx);
          }
        })
        .onUpdate((e) => {
          'worklet';
          if (nSpots < 2 || rulerW === 0) return;
          const idx = Math.max(0, Math.min(nSpots - 1, Math.round((e.x / rulerW) * (nSpots - 1))));
          if (idx !== dragIndexShared.value) {
            dragIndexShared.value = idx;
            runOnJS(haptic)();
            runOnJS(updateIndex)(idx);
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nSpots, rulerW, updateIndex, haptic],
  );

  const nowPnl = points[0]?.value ?? 0;
  const dte = data ? data.dates.length - 1 : 0;
  const isTrackingOnly = !isEntered;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
            {contract.ticker} ${contract.strike % 1 === 0 ? contract.strike.toFixed(0) : contract.strike.toFixed(2)} {contract.option_type === 'CALL' ? 'Call' : 'Put'} ({quantity}x)
          </Text>
          <TouchableOpacity onPress={() => { onClose(); toTicker(contract.ticker); }} hitSlop={10}>
            <Text style={{ color: colors.success, fontSize: 14, fontWeight: '600' }}>View {contract.ticker}</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error || !data ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>
              {!request
                ? 'No implied volatility available for this contract yet — try again after the next price refresh.'
                : (error as Error)?.message ?? 'Failed to simulate returns.'}
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {/* Headline */}
            <View style={{ paddingHorizontal: 16 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 4 }}>Simulated Returns</Text>
              <Text style={{ color: nowPnl >= 0 ? colors.success : colors.error, fontSize: 32, fontWeight: '800' }}>
                {fc(nowPnl)}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
                ${currentContractPrice.toFixed(2)} {isTrackingOnly ? 'Current contract price' : 'Estimated contract price'}
              </Text>
            </View>

            {/* "Now (N DTE)" */}
            <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '600', paddingHorizontal: 16, marginTop: 16, marginBottom: 4 }}>
              {spotIndex !== null && spotIndex !== centerIndex ? `At $${selectedSpot?.toFixed(2)}` : `Now (${dte} DTE)`}
            </Text>

            {/* Chart */}
            <View
              style={{ flexDirection: 'row', paddingHorizontal: 16 }}
              onLayout={(e: LayoutChangeEvent) => setPlotW(e.nativeEvent.layout.width - Y_AXIS_W)}
            >
              <View style={{ width: plotW, height: CHART_H }}>
                <Svg width={plotW} height={CHART_H}>
                  {/* Gridlines */}
                  <Line x1={0} y1={zeroY} x2={plotW} y2={zeroY} stroke={colors.separator} strokeWidth={1} />
                  {/* Max loss floor */}
                  <Line
                    x1={0} y1={maxLossY} x2={plotW} y2={maxLossY}
                    stroke={colors.error} strokeWidth={1} strokeDasharray="4,4"
                  />
                  {greenPath ? <Path d={greenPath} stroke={colors.success} strokeWidth={2} fill="none" /> : null}
                  {orangePath ? <Path d={orangePath} stroke={colors.error} strokeWidth={2} fill="none" /> : null}
                </Svg>
              </View>
              {/* Y axis labels */}
              <View style={{ width: Y_AXIS_W, height: CHART_H }}>
                <Text style={{ position: 'absolute', top: 0, right: 4, color: colors.textTertiary, fontSize: 11 }}>
                  {fc(yDomain.hi)}
                </Text>
                <Text style={{ position: 'absolute', top: zeroY - 7, right: 4, color: colors.textTertiary, fontSize: 11 }}>
                  $0
                </Text>
                <Text style={{ position: 'absolute', top: Math.min(maxLossY - 7, CHART_H - 24), right: 4, color: colors.error, fontSize: 10, fontWeight: '700' }}>
                  MAX{'\n'}LOSS
                </Text>
              </View>
            </View>

            {/* X axis date labels */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 4, marginRight: Y_AXIS_W }}>
              <Text style={{ color: colors.textTertiary, fontSize: 11 }}>{fmtExpiry(data.dates[0])}</Text>
              {data.dates.length > 2 && (
                <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                  {fmtExpiry(data.dates[Math.floor(data.dates.length / 2)])}
                </Text>
              )}
              <Text style={{ color: colors.textTertiary, fontSize: 11 }}>EXP</Text>
            </View>

            {/* Price ruler */}
            <View style={{ marginTop: 'auto', paddingBottom: 16 }}>
              <View style={{ alignItems: 'center', marginBottom: 8 }}>
                <View style={{ backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
                    ${selectedSpot?.toFixed(2)}
                  </Text>
                </View>
              </View>
              <GestureDetector gesture={rulerGesture}>
                <View
                  style={{ height: RULER_H, paddingHorizontal: 16, justifyContent: 'center' }}
                  onLayout={(e: LayoutChangeEvent) => setRulerW(e.nativeEvent.layout.width - 32)}
                >
                  <Svg width="100%" height={RULER_H}>
                    {data.spotPrices.map((_, i) => {
                      const x = rulerW > 0 ? (i / (data.spotPrices.length - 1)) * rulerW + 16 : 0;
                      const isMajor = i % 5 === 0;
                      const isActive = i === activeSpotIndex;
                      return (
                        <Line
                          key={i}
                          x1={x} x2={x}
                          y1={isActive ? 4 : (isMajor ? 12 : 20)}
                          y2={RULER_H - 4}
                          stroke={isActive ? colors.accent : (isMajor ? colors.textTertiary : colors.separator)}
                          strokeWidth={isActive ? 2 : 1}
                        />
                      );
                    })}
                  </Svg>
                </View>
              </GestureDetector>
              {spotIndex !== null && spotIndex !== centerIndex && (
                <TouchableOpacity onPress={() => setSpotIndex(null)} style={{ alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>Reset to current price</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};
