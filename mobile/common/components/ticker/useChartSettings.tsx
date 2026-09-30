import React, { useMemo, useState } from 'react';
import type { ChartDisplaySettings, ChartMode, ChartReferenceLine } from '@/common/components/ticker/AdvancedPriceChart';
import type { ChartSettingRow, ChartSettingsSection } from '@/common/components/ticker/ChartControlToggles';
import { useChartTechnicals, technicalsReferenceLines, ChartTechnicalsInfo } from '@/common/components/ticker/ChartTechnicals';
import { useWatchZonesVisibility } from '@/hooks/useWatchZonesVisibility';
import { useCrosshairEnabled } from '@/hooks/useCrosshairEnabled';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';

/**
 * Everything behind the chart's Technicals and settings modals, shared by the Charts tab
 * and PriceChartFullScreen: chart style, the technicals overlays (signal
 * strip, VWAP, daily EMAs, ORB band), session lines, watch levels, data
 * points, plus the "mark a watch level" action. Watch-zone visibility and
 * Data Points are the app's existing global, persisted preferences; the
 * rest is per-screen state.
 */
interface Options {
  ticker: string | null | undefined;
  period: PricePeriod;
  colors: any;
  /** Only offer "Mark a watch level" where the chart can actually save one. */
  canMarkWatchLevel: boolean;
  /** Screen-specific overlay rows (e.g. the full-screen chart's S/R). */
  extraOverlayRows?: ChartSettingRow[];
}

export function useChartSettings({ ticker, period, colors, canMarkWatchLevel, extraOverlayRows = [] }: Options) {
  const [mode, setMode] = useState<ChartMode | null>(null);
  const [showSessionLines, setShowSessionLines] = useState(false);
  const [watchMode, setWatchMode] = useState(false);
  const [showStrip, setShowStrip] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showEma, setShowEma] = useState(false);
  const [showOrb, setShowOrb] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const { visible: showWatchZones, setVisible: setShowWatchZones } = useWatchZonesVisibility();
  const { enabled: crosshairEnabled, setEnabled: setCrosshairEnabled } = useCrosshairEnabled();

  // Only poll while something actually uses the data.
  const technicals = useChartTechnicals(ticker, showStrip || showVwap || showEma || modalOpen);

  const referenceLines: ChartReferenceLine[] = useMemo(
    () => technicalsReferenceLines(technicals.data, period, { vwap: showVwap, ema: showEma }),
    [technicals.data, period, showVwap, showEma],
  );

  const chartSettings: ChartDisplaySettings = { mode, showSessionLines, watchMode, onWatchModeChange: setWatchMode };

  const defaultMode: ChartMode = period === '1D' || period === '1W' ? 'candle' : 'line';
  const sections: ChartSettingsSection[] = [
    ...(canMarkWatchLevel ? [{
      title: 'Watch',
      rows: [{
        kind: 'action' as const, key: 'mark', icon: 'eye-outline' as const, label: 'Mark a watch level',
        description: 'Drag up/down on the chart · tap the eye in the chart toolbar when done',
        onPress: () => { setShowWatchZones(true); setWatchMode(true); },
      }],
    }] : []),
    {
      title: 'Chart style',
      rows: [{
        kind: 'segment', key: 'mode', label: 'Style',
        value: mode ?? defaultMode,
        options: [
          { value: 'candle', label: 'Candles', icon: 'stats-chart-outline' },
          { value: 'line', label: 'Line', icon: 'analytics-outline' },
        ],
        onChange: v => setMode(v as ChartMode),
      }],
    },
    {
      title: 'Technicals',
      rows: [
        { kind: 'toggle', key: 'strip', icon: 'pulse-outline', label: 'Signal & RSI strip',
          description: 'BUY CALL / BUY PUT / WAIT pill with Trend, RSI, VWAP and ORB chips above the chart',
          value: showStrip, onChange: setShowStrip },
        { kind: 'toggle', key: 'vwap', icon: 'git-commit-outline', label: 'VWAP line',
          description: 'Session VWAP (1D only)', value: showVwap, onChange: setShowVwap },
        { kind: 'toggle', key: 'ema', icon: 'trending-up-outline', label: 'Trend: daily EMA-20 / 50',
          description: 'On 1D, shown only when within 1.5% of price', value: showEma, onChange: setShowEma },
        { kind: 'toggle', key: 'orb', icon: 'resize-outline', label: 'ORB range',
          description: 'Opening range 9:30–9:45 ET (1D only)', value: showOrb, onChange: setShowOrb },
      ],
    },
    {
      title: 'Overlays',
      rows: [
        { kind: 'toggle', key: 'session', icon: 'partly-sunny-outline', label: 'Pre / post-market lines',
          description: 'Pre-market, close, post-market and overnight prices (1D only)',
          value: showSessionLines, onChange: setShowSessionLines },
        { kind: 'toggle', key: 'zones', icon: 'layers-outline', label: 'Show watch levels',
          description: 'Show or hide your saved levels on the chart (use Mark a watch level above to add one)', value: showWatchZones, onChange: setShowWatchZones },
        ...extraOverlayRows,
        { kind: 'toggle', key: 'crosshair', icon: 'locate-outline', label: 'Data points',
          description: 'Tap-and-hold the chart to inspect an exact price/time',
          value: crosshairEnabled, onChange: setCrosshairEnabled },
      ],
    },
  ];

  const technicalsContent = (
    <ChartTechnicalsInfo check={technicals.data} isLoading={technicals.isLoading} error={technicals.error} colors={colors} />
  );

  return {
    technicals,
    showStrip,
    showOrb,
    referenceLines,
    chartSettings,
    sections,
    technicalsContent,
    onTechnicalsOpenChange: setModalOpen,
  };
}
