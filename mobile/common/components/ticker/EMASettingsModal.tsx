import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Switch,
} from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { EMA_CONFIGS } from '@/common/utils/chartUtils';

interface Props {
  visible: boolean;
  onClose: () => void;
  selectedPeriods: number[];
  onToggle: (period: number) => void;
}

const EMA_RULES: Record<number, string> = {
  10:  'Short-term momentum. Reacts quickly to price changes. Used by day traders to spot early reversals.',
  20:  'Short-swing trend line. Crossover with EMA 10 signals short-term momentum shifts.',
  50:  'Medium-term trend. A break below EMA 50 after a rally is a common exit signal for swing traders.',
  200: 'Long-term regime line. EMA 50 crossing above = Golden Cross (bullish); below = Death Cross (bearish).',
};

export const EMASettingsModal: React.FC<Props> = ({
  visible,
  onClose,
  selectedPeriods,
  onToggle,
}) => {
  const colors = useThemeColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={s.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />

      <View style={[s.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Handle bar */}
        <View style={[s.handle, { backgroundColor: colors.separator }]} />

        <Text style={[s.title, { color: colors.text }]}>EMA Overlays</Text>
        <Text style={[s.subtitle, { color: colors.textTertiary }]}>
          Select which moving averages to display on the chart.
        </Text>

        <View style={s.rows}>
          {EMA_CONFIGS.map(cfg => {
            const active = selectedPeriods.includes(cfg.period);
            return (
              <View key={cfg.period} style={[s.row, { borderBottomColor: colors.separator }]}>
                <View style={[s.swatch, { backgroundColor: cfg.color }]} />
                <View style={s.rowText}>
                  <Text style={[s.rowLabel, { color: colors.text }]}>{cfg.label}</Text>
                  <Text style={[s.rowDesc, { color: colors.textTertiary }]} numberOfLines={2}>
                    {EMA_RULES[cfg.period]}
                  </Text>
                </View>
                <Switch
                  value={active}
                  onValueChange={() => onToggle(cfg.period)}
                  trackColor={{ false: colors.separator, true: cfg.color + '88' }}
                  thumbColor={active ? cfg.color : colors.textTertiary}
                />
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={onClose}
          style={[s.doneBtn, { backgroundColor: colors.accent }]}
          activeOpacity={0.8}
        >
          <Text style={s.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  rows: {
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  rowDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  doneBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
