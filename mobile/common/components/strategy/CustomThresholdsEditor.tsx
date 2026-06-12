import React, { useRef, useMemo, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder, Switch,
  TouchableOpacity,
} from 'react-native';
import type { CustomThresholds } from '@/common/types/strategy';

export const DEFAULT_CUSTOM_THRESHOLDS: CustomThresholds = {
  qty_contracts:           5,
  max_loss_pct:            0.35,
  tp1_mult:                1.50,
  tp2_mult:                2.00,
  tp1_close_pct:           0.50,
  tp2_close_pct:           0.50,
  runner_trail_pct:        0.20,
  consol_exit:             true,
  consol_range_pct:        0.0008,
  consol_bars:             4,
  volume_exit_threshold:   0.20,
  strike_offset_min:       0.50,
  strike_offset_max:       2.00,
  target_delta_min:        0.38,
  target_delta_max:        0.58,
  eod_buffer_minutes:      25,
  breakout_time_limit_min: 45,
  vix_max_override:        30,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function snapValue(pct: number, min: number, max: number, step: number): number {
  const raw   = min + Math.max(0, Math.min(1, pct)) * (max - min);
  const steps = Math.round((raw - min) / step);
  const snapped = min + steps * step;
  return parseFloat(Math.max(min, Math.min(max, snapped)).toFixed(6));
}

// ── SliderRow ─────────────────────────────────────────────────────────────────

interface SliderRowProps {
  label:            string;
  value:            number;
  min:              number;
  max:              number;
  step:             number;
  format:           (v: number) => string;
  onChange:         (v: number) => void;
  accent:           string;
  trackBg:          string;
  labelColor:       string;
  textColor:        string;
  onDragStart?:     () => void;
  onDragEnd?:       () => void;
}

const SliderRow = React.memo(function SliderRow({
  label, value, min, max, step, format, onChange,
  accent, trackBg, labelColor, onDragStart, onDragEnd,
}: SliderRowProps) {
  const trackWidthRef  = useRef(0);
  const startPctRef    = useRef(0);
  const isDraggingRef  = useRef(false);

  const minRef         = useRef(min);
  const maxRef         = useRef(max);
  const stepRef        = useRef(step);
  const onChangeRef    = useRef(onChange);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef   = useRef(onDragEnd);
  useEffect(() => {
    minRef.current = min; maxRef.current = max;
    stepRef.current = step; onChangeRef.current = onChange;
    onDragStartRef.current = onDragStart;
    onDragEndRef.current   = onDragEnd;
  });

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder:        () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder:         () => true,
    onMoveShouldSetPanResponderCapture:  () => true,
    // Prevent ScrollView from reclaiming the gesture mid-drag
    onPanResponderTerminationRequest:    () => false,
    onPanResponderGrant: (e) => {
      const tw = trackWidthRef.current;
      if (!tw) return;
      isDraggingRef.current = true;
      onDragStartRef.current?.();
      const pct = e.nativeEvent.locationX / tw;
      startPctRef.current = Math.max(0, Math.min(1, pct));
      onChangeRef.current(snapValue(pct, minRef.current, maxRef.current, stepRef.current));
    },
    onPanResponderMove: (_, gs) => {
      const tw = trackWidthRef.current;
      if (!tw) return;
      const pct = startPctRef.current + gs.dx / tw;
      onChangeRef.current(snapValue(pct, minRef.current, maxRef.current, stepRef.current));
    },
    onPanResponderRelease: () => {
      isDraggingRef.current = false;
      onDragEndRef.current?.();
    },
    onPanResponderTerminate: () => {
      isDraggingRef.current = false;
      onDragEndRef.current?.();
    },
  }), []);

  const fillPct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <View style={s.sliderRow}>
      <View style={s.sliderLabelRow}>
        <Text style={[s.sliderLabel, { color: labelColor }]}>{label}</Text>
        <Text style={[s.sliderValue, { color: accent }]}>{format(value)}</Text>
      </View>
      {/* Enlarged hit area wraps the track so the touch target is generous */}
      <View
        style={[s.trackHitArea]}
        onLayout={e => { trackWidthRef.current = e.nativeEvent.layout.width; }}
        {...panResponder.panHandlers}
      >
        <View style={[s.track, { backgroundColor: trackBg }]}>
          <View style={[s.fill, { width: `${fillPct}%` as any, backgroundColor: accent }]} />
          <View style={[s.thumb, {
            left:      `${fillPct}%` as any,
            transform: [{ translateX: -10 }],
            backgroundColor:  accent,
            shadowColor:      accent,
            shadowOpacity:    0.4,
            shadowRadius:     4,
            shadowOffset:     { width: 0, height: 2 },
            elevation:        4,
          }]} />
        </View>
      </View>
      {/* Min / max labels */}
      <View style={s.sliderRange}>
        <Text style={[s.sliderRangeText, { color: labelColor }]}>{format(min)}</Text>
        <Text style={[s.sliderRangeText, { color: labelColor }]}>{format(max)}</Text>
      </View>
    </View>
  );
});

// ── Stepper ───────────────────────────────────────────────────────────────────

interface StepperRowProps {
  label:      string;
  value:      number;
  min:        number;
  max:        number;
  step:       number;
  format:     (v: number) => string;
  onChange:   (v: number) => void;
  accent:     string;
  labelColor: string;
  textColor:  string;
  borderColor: string;
}

function StepperRow({ label, value, min, max, step, format, onChange, accent, labelColor, textColor, borderColor }: StepperRowProps) {
  const decrement = () => onChange(parseFloat(Math.max(min, value - step).toFixed(6)));
  const increment = () => onChange(parseFloat(Math.min(max, value + step).toFixed(6)));
  return (
    <View style={[s.stepRow, { borderBottomColor: borderColor }]}>
      <Text style={[s.sliderLabel, { color: labelColor, flex: 1 }]}>{label}</Text>
      <View style={s.stepControls}>
        <TouchableOpacity onPress={decrement} hitSlop={8} style={[s.stepBtn, { borderColor }]}>
          <Text style={[s.stepBtnText, { color: accent }]}>−</Text>
        </TouchableOpacity>
        <Text style={[s.stepValueText, { color: textColor, minWidth: 56 }]}>{format(value)}</Text>
        <TouchableOpacity onPress={increment} hitSlop={8} style={[s.stepBtn, { borderColor }]}>
          <Text style={[s.stepBtnText, { color: accent }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

interface Props {
  thresholds:     CustomThresholds;
  onChange:       (t: CustomThresholds) => void;
  colors:         any;
  onDragStart?:   () => void;
  onDragEnd?:     () => void;
}

export function CustomThresholdsEditor({ thresholds, onChange, colors, onDragStart, onDragEnd }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const t = thresholds;

  const patch = (key: keyof CustomThresholds, val: number | boolean) =>
    onChange({ ...t, [key]: val });

  const accent      = colors.accent;
  const trackBg     = colors.border;
  const labelColor  = colors.tabBarInactive;
  const textColor   = colors.text;
  const borderColor = colors.border;
  const cardBg      = colors.card;

  const sliderProps = { accent, trackBg, labelColor, textColor, onDragStart, onDragEnd };

  return (
    <View>

      {/* ── Sizing ── */}
      <GroupHeader title="Sizing" colors={colors} />
      <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
        <SliderRow
          label="Contracts"
          value={t.qty_contracts} min={1} max={20} step={1}
          format={v => `${Math.round(v)} contracts`}
          onChange={v => patch('qty_contracts', Math.round(v))}
          {...sliderProps}
        />
        <SliderRow
          label="Max Loss"
          value={t.max_loss_pct} min={0.10} max={0.60} step={0.05}
          format={v => `-${Math.round(v * 100)}%`}
          onChange={v => patch('max_loss_pct', v)}
          {...sliderProps}
        />
      </View>

      {/* ── Take Profit ── */}
      <GroupHeader title="Take Profit" colors={colors} />
      <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
        <SliderRow
          label="TP1 Target"
          value={t.tp1_mult} min={1.25} max={3.00} step={0.05}
          format={v => `+${Math.round((v - 1) * 100)}%`}
          onChange={v => patch('tp1_mult', v)}
          {...sliderProps}
        />
        <SliderRow
          label="TP2 Target"
          value={t.tp2_mult} min={1.50} max={4.00} step={0.05}
          format={v => `+${Math.round((v - 1) * 100)}%`}
          onChange={v => patch('tp2_mult', v)}
          {...sliderProps}
        />
        <SliderRow
          label="Close at TP1"
          value={t.tp1_close_pct} min={0.25} max={1.00} step={0.05}
          format={v => `${Math.round(v * 100)}% of position`}
          onChange={v => patch('tp1_close_pct', v)}
          {...sliderProps}
        />
        <SliderRow
          label="Close at TP2"
          value={t.tp2_close_pct} min={0.25} max={1.00} step={0.05}
          format={v => `${Math.round(v * 100)}% of position`}
          onChange={v => patch('tp2_close_pct', v)}
          {...sliderProps}
        />
        <SliderRow
          label="Runner Trail"
          value={t.runner_trail_pct} min={0.05} max={0.30} step={0.05}
          format={v => `${Math.round(v * 100)}% below peak`}
          onChange={v => patch('runner_trail_pct', v)}
          {...sliderProps}
        />
      </View>

      {/* ── Timing ── */}
      <GroupHeader title="Timing" colors={colors} />
      <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
        <SliderRow
          label="Breakout Window"
          value={t.breakout_time_limit_min} min={20} max={120} step={5}
          format={v => `${Math.round(v)} min after ORB`}
          onChange={v => patch('breakout_time_limit_min', Math.round(v))}
          {...sliderProps}
        />
        <SliderRow
          label="EOD Buffer"
          value={t.eod_buffer_minutes} min={10} max={45} step={5}
          format={v => `Close ${Math.round(v)} min before close`}
          onChange={v => patch('eod_buffer_minutes', Math.round(v))}
          {...sliderProps}
        />
      </View>

      {/* ── Filters ── */}
      <GroupHeader title="Filters" colors={colors} />
      <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
        <SliderRow
          label="VIX Max"
          value={t.vix_max_override} min={15} max={50} step={5}
          format={v => `Skip if VIX > ${Math.round(v)}`}
          onChange={v => patch('vix_max_override', Math.round(v))}
          {...sliderProps}
        />
        <View style={[s.toggleRow, { borderBottomColor: borderColor }]}>
          <View>
            <Text style={[s.sliderLabel, { color: labelColor }]}>Consolidation Exit</Text>
            <Text style={[s.toggleSub, { color: labelColor }]}>Exit when price stalls in range</Text>
          </View>
          <Switch
            value={t.consol_exit}
            onValueChange={v => patch('consol_exit', v)}
            thumbColor={t.consol_exit ? accent : '#ccc'}
            trackColor={{ true: accent + '55', false: borderColor }}
          />
        </View>
      </View>

      {/* ── Advanced (collapsible) ── */}
      <TouchableOpacity
        onPress={() => setShowAdvanced(v => !v)}
        style={s.advancedToggle}
        activeOpacity={0.7}
      >
        <Text style={[s.advancedToggleText, { color: labelColor }]}>
          {showAdvanced ? '▾' : '▸'} Advanced Strike & Delta
        </Text>
      </TouchableOpacity>

      {showAdvanced && (
        <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
          <StepperRow
            label="Strike Offset Min" value={t.strike_offset_min} min={0.25} max={3.00} step={0.25}
            format={v => `$${v.toFixed(2)}`}
            onChange={v => patch('strike_offset_min', v)}
            accent={accent} labelColor={labelColor} textColor={textColor} borderColor={borderColor}
          />
          <StepperRow
            label="Strike Offset Max" value={t.strike_offset_max} min={0.50} max={5.00} step={0.25}
            format={v => `$${v.toFixed(2)}`}
            onChange={v => patch('strike_offset_max', v)}
            accent={accent} labelColor={labelColor} textColor={textColor} borderColor={borderColor}
          />
          <StepperRow
            label="Delta Min" value={t.target_delta_min} min={0.20} max={0.55} step={0.02}
            format={v => v.toFixed(2)}
            onChange={v => patch('target_delta_min', v)}
            accent={accent} labelColor={labelColor} textColor={textColor} borderColor={borderColor}
          />
          <StepperRow
            label="Delta Max" value={t.target_delta_max} min={0.30} max={0.70} step={0.02}
            format={v => v.toFixed(2)}
            onChange={v => patch('target_delta_max', v)}
            accent={accent} labelColor={labelColor} textColor={textColor} borderColor={borderColor}
          />
          <StepperRow
            label="Consol. Bars" value={t.consol_bars} min={2} max={10} step={1}
            format={v => `${Math.round(v)} bars`}
            onChange={v => patch('consol_bars', Math.round(v))}
            accent={accent} labelColor={labelColor} textColor={textColor} borderColor={borderColor}
          />
        </View>
      )}
    </View>
  );
}

const GroupHeader = ({ title, colors }: { title: string; colors: any }) => (
  <Text style={[s.groupHeader, { color: colors.tabBarInactive }]}>{title.toUpperCase()}</Text>
);

const s = StyleSheet.create({
  card:         { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 4 },
  groupHeader:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: 14, marginBottom: 6, marginLeft: 2 },

  // Slider
  sliderRow:       { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  sliderLabelRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  sliderLabel:     { fontSize: 13, fontWeight: '500' },
  sliderValue:     { fontSize: 13, fontWeight: '700' },
  // Enlarged hit area — the user touches this; the visual track is inside it
  trackHitArea:   { paddingVertical: 10, justifyContent: 'center' },
  track:          { height: 4, borderRadius: 2, position: 'relative', justifyContent: 'center' },
  fill:           { height: 4, borderRadius: 2, position: 'absolute', left: 0, top: 0 },
  thumb:          { position: 'absolute', width: 20, height: 20, borderRadius: 10, top: -8 },
  sliderRange:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: 4 },
  sliderRangeText:{ fontSize: 10 },

  // Stepper
  stepRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  stepControls:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn:       { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepBtnText:   { fontSize: 18, fontWeight: '600', lineHeight: 22 },
  stepValueText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },

  // Toggle
  toggleRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleSub:     { fontSize: 11, marginTop: 2 },

  // Advanced
  advancedToggle:     { paddingVertical: 8, paddingHorizontal: 2, marginBottom: 4 },
  advancedToggleText: { fontSize: 13, fontWeight: '600' },
});
