import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, SafeAreaView, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  eachDayOfInterval, getISODay, isSameDay, isAfter, startOfDay, parseISO,
} from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { usePerformanceReviews } from '@/hooks/queries/review/usePerformanceReviews';
import { useGenerateReview } from '@/hooks/mutations/review/useGenerateReview';
import { ReviewDetailModal } from '@/common/components/review/ReviewDetailModal';
import { useToast } from '@/common/components/ui/Toast';

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr'];

function getCalendarRows(date: Date): (Date | null)[][] {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  const allDays = eachDayOfInterval({ start, end });

  const rows: (Date | null)[][] = [];
  let currentRow: (Date | null)[] = [];

  // ISO: 1=Mon, 2=Tue, ..., 5=Fri, 6=Sat, 7=Sun
  const firstIsoDay = getISODay(start);

  // Pad nulls before the first weekday of the month
  if (firstIsoDay <= 5) {
    for (let i = 1; i < firstIsoDay; i++) currentRow.push(null);
  }

  for (const day of allDays) {
    if (getISODay(day) >= 6) continue; // skip Sat/Sun
    currentRow.push(day);
    if (currentRow.length === 5) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  if (currentRow.length > 0) {
    while (currentRow.length < 5) currentRow.push(null);
    rows.push(currentRow);
  }

  return rows;
}

function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export default function DailyReviewScreen() {
  const colors = useThemeColors();
  const today = startOfDay(new Date());

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [modalDate, setModalDate] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = usePerformanceReviews(180);
  const generateReview = useGenerateReview();
  const toast = useToast();

  const reviewedDates = useMemo(() => {
    const s = new Set<string>();
    for (const r of (data?.data ?? [])) s.add(r.review_date);
    return s;
  }, [data?.data]);

  const calendarRows = useMemo(() => getCalendarRows(currentMonth), [currentMonth]);

  const nextMonthStart = startOfMonth(addMonths(currentMonth, 1));
  const canGoForward = !isAfter(nextMonthStart, today);

  const selectedIsReviewed = selectedDate ? reviewedDates.has(selectedDate) : false;
  const selectedIsFuture = selectedDate ? isAfter(parseISO(selectedDate), today) : false;

  const handleGenerate = () => {
    if (!selectedDate || selectedIsReviewed || selectedIsFuture) return;
    toast.info('Generating review… this takes ~15 seconds');
    generateReview.mutate(selectedDate, {
      onSuccess: (res) => {
        const date = res?.date as string | undefined;
        toast.success(`Review for ${date ?? selectedDate} is ready`);
        setSelectedDate(null);
        setModalDate(date ?? selectedDate);
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  const handleDayPress = (day: Date) => {
    const key = dateKey(day);
    const isFuture = isAfter(day, today);
    if (isFuture) return;

    if (reviewedDates.has(key)) {
      // Tap reviewed day → open review modal directly
      setSelectedDate(null);
      setModalDate(key);
    } else {
      // Tap unreviewed day → toggle selection to show generate panel
      setSelectedDate(prev => (prev === key ? null : key));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>
          Daily Review
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
          Auto-generated at 4:15 PM ET · paper + live
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: selectedDate ? 160 : 40 }}
        scrollIndicatorInsets={{ right: 1 }}
      >
        {/* Month navigation */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20, paddingVertical: 16,
        }}>
          <TouchableOpacity
            onPress={() => { setSelectedDate(null); setCurrentMonth(m => subMonths(m, 1)); }}
            style={{ padding: 8 }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>

          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
            {format(currentMonth, 'MMMM yyyy')}
          </Text>

          <TouchableOpacity
            onPress={() => { setSelectedDate(null); setCurrentMonth(m => addMonths(m, 1)); }}
            disabled={!canGoForward}
            style={{ padding: 8, opacity: canGoForward ? 1 : 0.25 }}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Calendar grid */}
        <View style={{ paddingHorizontal: 16 }}>
          {/* Day-of-week headers */}
          <View style={{ flexDirection: 'row', marginBottom: 4 }}>
            {WEEKDAY_LABELS.map(label => (
              <View key={label} style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }}>
                <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '600' }}>
                  {label}
                </Text>
              </View>
            ))}
          </View>

          {isLoading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : (
            calendarRows.map((row, ri) => (
              <View key={ri} style={{ flexDirection: 'row', marginBottom: 6 }}>
                {row.map((day, di) => {
                  if (!day) return <View key={di} style={{ flex: 1 }} />;

                  const key = dateKey(day);
                  const isFuture = isAfter(day, today);
                  const isToday = isSameDay(day, today);
                  const isSelected = selectedDate === key;
                  const isReviewed = reviewedDates.has(key);

                  return (
                    <Pressable
                      key={di}
                      onPress={() => handleDayPress(day)}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 4, opacity: isFuture ? 0.25 : 1 }}
                    >
                      <View style={{
                        width: 38, height: 38, borderRadius: 19,
                        alignItems: 'center', justifyContent: 'center',
                        backgroundColor: isSelected
                          ? colors.accent
                          : isReviewed
                            ? colors.success + '28'
                            : 'transparent',
                        borderWidth: isToday && !isSelected ? 1.5 : 0,
                        borderColor: colors.accent,
                      }}>
                        <Text style={{
                          color: isSelected ? '#fff' : isReviewed ? colors.success : colors.text,
                          fontSize: 14,
                          fontWeight: (isToday || isSelected || isReviewed) ? '700' : '400',
                        }}>
                          {format(day, 'd')}
                        </Text>
                      </View>
                      {/* Dot indicator under reviewed days */}
                      {isReviewed && !isSelected && (
                        <View style={{
                          width: 4, height: 4, borderRadius: 2,
                          backgroundColor: colors.success, marginTop: 2,
                        }} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}
        </View>

        {/* Legend */}
        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 20, marginTop: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success }} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Reviewed</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: colors.accent }} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Today</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Selected</Text>
          </View>
        </View>
      </ScrollView>

      {/* Bottom action panel — shown when an unreviewed day is selected */}
      {selectedDate && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          backgroundColor: colors.surface,
          borderTopWidth: 1, borderTopColor: colors.border,
          paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36,
        }}>
          {/* Selected date info */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
                {format(parseISO(selectedDate), 'EEEE, MMMM d')}
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
                {selectedIsReviewed ? 'Review already exists' : 'No review generated yet'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedDate(null)} style={{ padding: 4 }}>
              <Ionicons name="close" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {/* Generate Review button */}
          <TouchableOpacity
            onPress={handleGenerate}
            disabled={selectedIsReviewed || selectedIsFuture || generateReview.isPending}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: (selectedIsReviewed || selectedIsFuture)
                ? colors.border
                : colors.accent,
              opacity: generateReview.isPending ? 0.7 : 1,
            }}
          >
            {generateReview.isPending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons
                  name="sparkles"
                  size={16}
                  color={(selectedIsReviewed || selectedIsFuture) ? colors.textTertiary : '#fff'}
                />
            }
            <Text style={{
              fontSize: 15, fontWeight: '700',
              color: (selectedIsReviewed || selectedIsFuture) ? colors.textTertiary : '#fff',
            }}>
              {selectedIsReviewed ? 'Already Reviewed' : 'Generate Review'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ReviewDetailModal
        date={modalDate}
        visible={!!modalDate}
        onClose={() => { setModalDate(null); refetch(); }}
      />
    </SafeAreaView>
  );
}
