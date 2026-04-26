import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'TH', 'F', 'S'];

export interface DayPnL {
  date: string;
  pnl: number;
}

interface MonthCalendarBlockProps {
  monthDate: Date;
  dailyPnL?: Map<string, number> | Record<string, number>;
  today?: Date;
  onDayPress?: (date: Date) => void;
}

export const MonthCalendarBlock: React.FC<MonthCalendarBlockProps> = ({
  monthDate,
  dailyPnL = {},
  today,
  onDayPress,
}) => {
  const colors = useThemeColors();
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startWeekday = getDay(monthStart);

  const pnlMap = dailyPnL instanceof Map ? dailyPnL : new Map(Object.entries(dailyPnL));
  const leadingEmpty = startWeekday;
  const rows = Math.ceil((leadingEmpty + daysInMonth.length) / 7);

  return (
    <View style={s.month}>
      {/* Month / Year header */}
      <View style={s.monthHeader}>
        <Text style={[s.monthName, { color: colors.text }]}>{format(monthDate, 'MMMM')}</Text>
        <Text style={[s.yearText, { color: colors.textSecondary }]}>{format(monthDate, 'yyyy')}</Text>
      </View>

      {/* Day-of-week headers */}
      <View style={s.dayLabelsRow}>
        {DAY_LABELS.map((label, i) => (
          <View key={i} style={s.dayLabelCell}>
            <Text style={[s.dayLabel, { color: colors.textTertiary }]}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={s.grid}>
        {Array.from({ length: rows * 7 }, (_, i) => {
          const dayIndex = i - leadingEmpty;
          const isPadding = dayIndex < 0 || dayIndex >= daysInMonth.length;
          const day = isPadding ? null : daysInMonth[dayIndex];
          const dateKey = day ? format(day, 'yyyy-MM-dd') : '';
          const pnl = dateKey ? pnlMap.get(dateKey) : undefined;
          const hasPnL = pnl !== undefined && pnl !== 0;
          const isToday = day && today ? isSameDay(day, today) : false;

          if (isPadding) {
            return <View key={i} style={s.cell} />;
          }

          const pnlColor = pnl != null && pnl >= 0 ? colors.accent : colors.error;

          const dayCell = (
            <View
              style={[
                s.dayCellInner,
                hasPnL && { backgroundColor: colors.surface },
                isToday && { borderWidth: 1.5, borderColor: colors.accent },
              ]}
            >
              <Text style={[s.dayNumber, { color: colors.text, fontWeight: isToday ? '800' : '400' }]}>
                {format(day!, 'd')}
              </Text>
              {hasPnL && (
                <Text style={[s.pnlText, { color: pnlColor }]}>
                  ${Math.abs(pnl!).toFixed(0)}
                </Text>
              )}
            </View>
          );

          return (
            <View key={i} style={s.cell}>
              {onDayPress ? (
                <TouchableOpacity style={s.cellTouchable} activeOpacity={0.7} onPress={() => onDayPress(day!)}>
                  {dayCell}
                </TouchableOpacity>
              ) : (
                dayCell
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};

const s = StyleSheet.create({
  month: { marginBottom: 32 },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  monthName: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  yearText: { fontSize: 15, fontWeight: '500' },
  dayLabelsRow: { flexDirection: 'row', marginBottom: 6 },
  dayLabelCell: { flex: 1, alignItems: 'center' },
  dayLabel: { fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  cellTouchable: { width: '100%' },
  dayCellInner: { width: '100%', minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  dayNumber: { fontSize: 13 },
  pnlText: { fontSize: 10, fontWeight: '700', marginTop: 1 },
});
