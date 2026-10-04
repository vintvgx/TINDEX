import React, { useMemo, useState } from 'react';
import type { ChartDisplaySettings, ChartMode, ChartReferenceLine } from '@/common/components/ticker/AdvancedPriceChart';
import type { ChartSettingRow, ChartSettingsSection } from '@/common/components/ticker/ChartControlToggles';
import { useChartTechnicals, technicalsReferenceLines, ChartTechnicalsInfo } from '@/common/components/ticker/ChartTechnicals';
import { useWatchZonesVisibility } from '@/hooks/useWatchZonesVisibility';
import { useAutoZonesVisibility } from '@/hooks/useAutoZonesVisibility';
import { useCrosshairEnabled } from '@/hooks/useCrosshairEnabled';
import { useChartDisplayPrefs } from '@/hooks/useChartDisplayPrefs';
import { usePositioning, type PositioningRead } from '@/hooks/queries/ticker/useTickerBrief';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import { ALLOWED_INTERVALS, DEFAULT_INTERVAL, INTERVAL_LABEL } from '@/lib/chartIntervals';
import { PERIOD_STOPS, intervalCycleFor } from '@/common/components/ticker/TimeframeChips';

/**
 * Everything behind the chart's Technicals and settings modals, shared by the Charts tab
 * and PriceChartFullScreen: chart style, the technicals overlays (signal
 * strip, VWAP, daily EMAs, ORB band), session lines, watch levels, data
 * points, plus the "mark a watch level" action. Every display option
 * persists across launches: style/technicals/session lines via
 * useChartDisplayPrefs (SecureStore), watch levels / auto zones / Data
 * Points via their own hooks. Only Watch mode itself is transient.
 */
interface Options {
  ticker: string | null | undefined;
  period: PricePeriod;
  colors: any;
  /** Only offer "Mark a watch level" where the chart can actually save one. */
  canMarkWatchLevel: boolean;
  /** Screen-specific overlay rows (e.g. the full-screen chart's S/R). */
  extraOverlayRows?: ChartSettingRow[];
  /** Hide the "Signal & RSI strip" row on screens that don't render the
   *  strip (the Charts tab shows the signal in the ticker tape instead). */
  hideStripRow?: boolean;
  /** Show the "Defaults" section (launch date range + bar size). */
  showDefaults?: boolean;
}

export function useChartSettings({
  ticker, period, colors, canMarkWatchLevel, extraOverlayRows = [], hideStripRow = false, showDefaults = false,
}: Options) {
  const { prefs, setPref } = useChartDisplayPrefs();
  const { mode, showSessionLines, showStrip, showVwap, showEma, showOrb, showWalls,
    ema20, ema50, ema200, ema400, chartEngine, defaultPeriod } = prefs;
  const defaultIntervalOptions = intervalCycleFor(ALLOWED_INTERVALS[defaultPeriod]);
  const defaultInterval = prefs.defaultInterval && defaultIntervalOptions.includes(prefs.defaultInterval)
    ? prefs.defaultInterval
    : DEFAULT_INTERVAL[defaultPeriod];
  const setMode = (v: ChartMode | null) => setPref('mode', v);
  const setShowSessionLines = (v: boolean) => setPref('showSessionLines', v);
  const setShowStrip = (v: boolean) => setPref('showStrip', v);
  const setShowVwap = (v: boolean) => setPref('showVwap', v);
  const setShowEma = (v: boolean) => setPref('showEma', v);
  const setShowOrb = (v: boolean) => setPref('showOrb', v);
  const setShowWalls = (v: boolean) => setPref('showWalls', v);
  // Options walls are an intraday read (0DTE / near-term OI) — drawn on the
  // 1D and 1W views only, refreshed on the same ~90s cadence as zones.
  const wallsActive = showWalls && (period === '1D' || period === '1W');
  const positioning = usePositioning(ticker, 'CALL', null, wallsActive);
  const [watchMode, setWatchMode] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const { visible: showWatchZones, setVisible: setShowWatchZones } = useWatchZonesVisibility();
  // Unlike showWatchZones, the caller (PriceChartFullScreen) needs this
  // value itself — fetching ZoneEngine's zones is a real (if 90s-cached)
  // yfinance call, and should be gated on the toggle the same way S/R's
  // own fetch is gated on showSR, so it's returned below rather than left
  // purely internal to the hook/AdvancedPriceChart pair.
  const { visible: showAutoZones, setVisible: setShowAutoZones } = useAutoZonesVisibility();
  const { enabled: crosshairEnabled, setEnabled: setCrosshairEnabled } = useCrosshairEnabled();

  // Only poll while something actually uses the data.
  const technicals = useChartTechnicals(ticker, showStrip || showVwap || showEma || modalOpen);

  const referenceLines: ChartReferenceLine[] = useMemo(
    () => [
      ...technicalsReferenceLines(technicals.data, period, { vwap: showVwap, ema: showEma }),
      ...(wallsActive ? optionsWallLines(positioning.data?.data ?? null) : []),
    ],
    [technicals.data, period, showVwap, showEma, wallsActive, positioning.data],
  );

  const chartSettings: ChartDisplaySettings = { mode, showSessionLines, watchMode, onWatchModeChange: setWatchMode };

  const defaultMode: ChartMode = period === '1D' || period === '1W' ? 'candle' : 'line';
  const sections: ChartSettingsSection[] = [
    ...(showDefaults ? [{
      title: 'Timeframe · also used on launch',
      rows: [
        {
          kind: 'segment' as const, key: 'defaultPeriod', label: 'Date range',
          value: defaultPeriod,
          options: PERIOD_STOPS.map(p => ({ value: p, label: p })),
          onChange: (v: string) => {
            setPref('defaultPeriod', v as PricePeriod);
            // Keep the saved bar size only if the new range supports it.
            if (prefs.defaultInterval && !ALLOWED_INTERVALS[v as PricePeriod].includes(prefs.defaultInterval)) {
              setPref('defaultInterval', null);
            }
          },
        },
        {
          kind: 'segment' as const, key: 'defaultInterval', label: 'Bar size',
          value: defaultInterval,
          options: defaultIntervalOptions.map(i => ({ value: i, label: INTERVAL_LABEL[i] ?? i })),
          onChange: (v: string) => setPref('defaultInterval', v),
        },
      ],
    }] : []),
    {
      title: 'Chart engine',
      rows: [{
        kind: 'segment', key: 'engine', label: 'Engine',
        value: chartEngine,
        options: [
          { value: 'tv', label: 'TradingView', icon: 'stats-chart-outline' },
          { value: 'legacy', label: 'Legacy', icon: 'analytics-outline' },
        ],
        onChange: v => setPref('chartEngine', v as 'tv' | 'legacy'),
      }],
    },
    {
      title: 'Moving averages',
      rows: ([
        [20, '#4A9EFF', ema20, 'ema20'],
        [50, '#F59E0B', ema50, 'ema50'],
        [200, '#B388FF', ema200, 'ema200'],
        [400, '#A1887F', ema400, 'ema400'],
      ] as const).map(([period, color, value, key]) => ({
        kind: 'toggle' as const, key: `ema-${period}`, icon: 'trending-up-outline' as const,
        label: `EMA ${period}`,
        description: `Of the visible bars${period >= 200 ? ' — needs deep history' : ''}`,
        value, onChange: (v: boolean) => setPref(key, v),
        color,
      })),
    },
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
        ...(hideStripRow ? [] : [{ kind: 'toggle' as const, key: 'strip', icon: 'pulse-outline' as const, label: 'Signal & RSI strip',
          description: 'BUY CALL / BUY PUT / WAIT pill with Trend, RSI, VWAP and ORB chips above the chart',
          value: showStrip, onChange: setShowStrip }]),
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
        { kind: 'toggle', key: 'autoZones', icon: 'grid-outline', label: 'Auto-detected zones',
          description: 'Support/resistance ZoneEngine finds automatically, scored by confluence (separate from your own watch levels)',
          value: showAutoZones, onChange: setShowAutoZones },
        { kind: 'toggle', key: 'walls', icon: 'reorder-four-outline', label: 'Options walls',
          description: 'Top call/put open-interest strikes (dotted) and expiry-day max pain — 1D/1W, ~15 min delayed',
          value: showWalls, onChange: setShowWalls },
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

  // Timeframe EMA overlays for the TV chart — computed in-page from the
  // loaded bars (no backend change).
  // Memoized: TVChart re-sends (and the page rebuilds every EMA series) on
  // each new identity, so a fresh array per render meant a full rebuild on
  // every live-price tick.
  const emaOverlays = useMemo(() => [
    { period: 20, color: '#4A9EFF', visible: ema20 },
    { period: 50, color: '#F59E0B', visible: ema50 },
    { period: 200, color: '#B388FF', visible: ema200 },
    { period: 400, color: '#A1887F', visible: ema400 },
  ], [ema20, ema50, ema200, ema400]);

  return {
    technicals,
    showStrip,
    showOrb,
    showAutoZones,
    referenceLines,
    chartSettings,
    sections,
    technicalsContent,
    emaOverlays,
    chartEngine,
    crosshairEnabled,
    defaultPeriod,
    defaultInterval,
    onTechnicalsOpenChange: setModalOpen,
  };
}

// Faint dotted wall lines — gray for call walls, purple for put walls, so
// they never read as zone bands (shaded) or user levels (solid) — plus an
// amber max-pain line on the front expiry's expiration day only. Walls more
// than WALL_MAX_DISTANCE_PCT from price are skipped: every reference line is
// folded into the y-axis, and a far strike would flatten the candles.
const WALL_CALL_COLOR = '#8E8E93';
const WALL_PUT_COLOR = '#A78BFA';
const MAX_PAIN_COLOR = '#F5A524';
const WALL_MAX_DISTANCE_PCT = 0.03;

function fmtOi(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function etToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function optionsWallLines(p: PositioningRead | null): ChartReferenceLine[] {
  const spot = p?.inputs.spot;
  if (!p || !spot) return [];
  const near = (k: number) => Math.abs(k - spot) / spot <= WALL_MAX_DISTANCE_PCT;
  const fmtStrike = (k: number) => `$${k.toFixed(2)}`;
  const lines: ChartReferenceLine[] = [
    ...p.inputs.call_walls.filter(w => near(w.strike)).map(w => ({
      label: `${fmtStrike(w.strike)} · ${fmtOi(w.open_interest)}`, price: w.strike, color: WALL_CALL_COLOR, dash: '2,4',
    })),
    ...p.inputs.put_walls.filter(w => near(w.strike)).map(w => ({
      label: `${fmtStrike(w.strike)} · ${fmtOi(w.open_interest)}`, price: w.strike, color: WALL_PUT_COLOR, dash: '2,4',
    })),
  ];
  if (p.inputs.max_pain != null && p.inputs.front_expiry === etToday() && near(p.inputs.max_pain)) {
    lines.push({ label: `Max pain ${fmtStrike(p.inputs.max_pain)}`, price: p.inputs.max_pain, color: MAX_PAIN_COLOR, dash: '2,4' });
  }
  return lines;
}
