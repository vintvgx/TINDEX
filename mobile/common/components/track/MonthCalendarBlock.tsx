import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
} from "date-fns";

const DAY_LABELS = ["S", "M", "T", "W", "TH", "F", "S"];

export interface DayPnL {
  date: string; // YYYY-MM-DD
  pnl: number;
}

interface MonthCalendarBlockProps {
  /** First day of the month to display */
  monthDate: Date;
  /** Map of date string (YYYY-MM-DD) to P&L for that day. Negative = loss (red), positive = profit (blue). */
  dailyPnL?: Map<string, number> | Record<string, number>;
  /** Today, used to highlight the current day when it falls in this month. */
  today?: Date;
  /** Called when a day is pressed; when provided, day cells are pressable. */
  onDayPress?: (date: Date) => void;
}

/**
 * Renders a single month in the track calendar style:
 * - Month name (left) and year (right)
 * - Day-of-week headers (S M T W TH F S)
 * - Grid of days with optional P&L; losses in red, profits in blue on dark rounded background
 */
export const MonthCalendarBlock: React.FC<MonthCalendarBlockProps> = ({
  monthDate,
  dailyPnL = {},
  today,
  onDayPress,
}) => {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startWeekday = getDay(monthStart); // 0 = Sunday

  const pnlMap = dailyPnL instanceof Map ? dailyPnL : new Map(Object.entries(dailyPnL));

  // Build flat list of cells: leading empty slots + day numbers
  const leadingEmpty = startWeekday;
  const totalCells = leadingEmpty + daysInMonth.length;
  const rows = Math.ceil(totalCells / 7);

  return (
    <View className="mb-8">
      {/* Month / Year header */}
      <View className="flex-row justify-between items-baseline px-1 mb-3">
        <Text className="text-white text-2xl font-bold tracking-wide">
          {format(monthDate, "MMMM").toUpperCase()}
        </Text>
        <Text className="text-white text-lg font-medium opacity-90">
          {format(monthDate, "yyyy")}
        </Text>
      </View>

      {/* Day-of-week headers */}
      <View className="flex-row mb-2">
        {DAY_LABELS.map((label, i) => (
          <View key={i} className="flex-1 items-center">
            <Text className="text-gray-500 text-xs font-medium">{label}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      <View className="flex flex-wrap flex-row">
        {Array.from({ length: rows * 7 }, (_, i) => {
          const dayIndex = i - leadingEmpty;
          const isPadding = dayIndex < 0 || dayIndex >= daysInMonth.length;
          const day = isPadding ? null : daysInMonth[dayIndex];
          const dateKey = day ? format(day, "yyyy-MM-dd") : "";
          const pnl = dateKey ? pnlMap.get(dateKey) : undefined;
          const hasPnL = pnl !== undefined && pnl !== 0;
          const isToday = day && today ? isSameDay(day, today) : false;

          const dayCell = (
            <View
              className={`w-full min-h-[36px] rounded-lg items-center justify-center ${
                hasPnL ? "bg-gray-800/80" : ""
              } ${isToday ? "border border-indigo-400" : ""}`}
              style={{ paddingVertical: 4 }}
            >
              <Text
                className="text-white text-sm font-medium"
                style={isToday ? { fontWeight: "900" } : undefined}
              >
                {format(day!, "d")}
              </Text>
              {hasPnL && (
                <Text
                  className="text-xs font-semibold mt-0.5"
                  style={{
                    color: pnl! >= 0 ? "#3B82F6" : "#EF4444",
                  }}
                >
                  ${Math.abs(pnl!).toFixed(0)}
                </Text>
              )}
            </View>
          );

          return (
            <View key={i} className="w-[14.28%] aspect-square items-center justify-center py-0.5">
              {isPadding ? (
                <View className="w-full aspect-square" />
              ) : onDayPress ? (
                <TouchableOpacity
                  className="w-full"
                  activeOpacity={0.7}
                  onPress={() => onDayPress(day!)}
                >
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
