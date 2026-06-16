import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';

const DAYS = [
  { label: 'M', value: 0 },
  { label: 'T', value: 1 },
  { label: 'W', value: 2 },
  { label: 'T', value: 3 },
  { label: 'F', value: 4 },
];

interface Props {
  selected: number[];
  onChange: (days: number[]) => void;
}

export const TradeDaysSelector: React.FC<Props> = ({ selected, onChange }) => {
  const colors = useThemeColors();

  const toggle = (day: number) => {
    if (selected.includes(day)) {
      onChange(selected.filter(d => d !== day));
    } else {
      onChange([...selected, day].sort());
    }
  };

  return (
    <View style={styles.row}>
      {DAYS.map(({ label, value }) => {
        const active = selected.includes(value);
        return (
          <TouchableOpacity
            key={value}
            onPress={() => toggle(value)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.accent : colors.card,
                borderColor: active ? colors.accent : colors.border,
              },
            ]}
          >
            <Text style={[styles.label, { color: active ? colors.background : colors.text }]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  label: { fontSize: 13, fontWeight: '600' },
});
