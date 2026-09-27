import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, SafeAreaView, Pressable, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  eachDayOfInterval, getISODay, isSameDay, isAfter, startOfDay, parseISO,
} from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { usePerformanceReviews } from '@/hooks/queries/review/usePerformanceReviews';
import { useGenerateReview } from '@/hooks/mutations/review/useGenerateReview';
import { useReviewNotes } from '@/hooks/queries/review/useReviewNotes';
import { ReviewDetailModal } from '@/common/components/review/ReviewDetailModal';
import { AddReviewNoteModal } from '@/common/components/review/AddReviewNoteModal';
import { ReviewNoteActionModal } from '@/common/components/review/ReviewNoteActionModal';
import { useToast } from '@/common/components/ui/Toast';
import { useFloatingTabBarHeight } from '@/common/components/ui/CustomTabBar';
import { LiveModeToggle, type AccountMode } from '@/common/components/strategy/LiveModeToggle';
import { MarketDigestModal } from '@/common/components/digest/MarketDigestModal';
import { DigestGeneratingOverlay } from '@/common/components/digest/DigestGeneratingOverlay';
import { useMarketDigest, useMarketDigestList, fetchMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { useGenerateMarketDigest } from '@/hooks/mutations/digest/useGenerateMarketDigest';
import type { ReviewNote } from '@/common/types/reviewNotes';

const NOTE_COLOR = '#F59E0B';
const DIGEST_COLOR = '#0A84FF';

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
  const [generatingDate, setGeneratingDate] = useState<string | null>(null);
  // Reviews are fully decoupled per account — a day can have a live review,
  // a paper review, both, or neither. Default live: "especially my live
  // strategies" is the primary thing being tracked; paper is for testing.
  const [mode, setMode] = useState<AccountMode>('live');
  const paperMode = mode === 'paper';

  // Deep-link from a notification tap (see NotificationNavigationService) —
  // consume `review_date`/`paper_mode` exactly once, same pattern as
  // orb.tsx's `section`. Opens the detail modal directly since a
  // notify_review_ready* tap only ever fires once that review already exists.
  const { review_date: reviewDateParam, paper_mode: paperModeParam } =
    useLocalSearchParams<{ review_date?: string; paper_mode?: string }>();
  useFocusEffect(
    useCallback(() => {
      if (reviewDateParam != null) {
        if (paperModeParam != null) setMode(paperModeParam === 'true' ? 'paper' : 'live');
        setCurrentMonth(parseISO(reviewDateParam));
        setModalDate(reviewDateParam);
        router.setParams({ review_date: undefined, paper_mode: undefined });
      }
    }, [reviewDateParam, paperModeParam]),
  );

  const { data, isLoading, isFetching, refetch } = usePerformanceReviews(180, paperMode);
  const generateReview = useGenerateReview();
  const toast = useToast();
  const tabBarHeight = useFloatingTabBarHeight();

  // Notes/TODOs are account-mode-independent (general project notes, not
  // trade commentary) — fetched unfiltered so the calendar dots cover every
  // month and the TODO list below covers the full backlog, not just the
  // visible one.
  const { data: notesData } = useReviewNotes();
  const notes = notesData?.data ?? [];
  const [addNoteDate, setAddNoteDate] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<ReviewNote | null>(null);

  // Market Digest — the Home-card-style entry point still only ever offers
  // today's (view if already generated by the 8:30 AM ET cron, else build
  // it on-demand). Browsing a PAST day's digest from the calendar below is
  // a separate, read-only path — see handleViewDigest — since a past day's
  // digest either already exists or never will (nothing to generate).
  const todayKey = dateKey(today);
  const { data: todayDigest } = useMarketDigest(todayKey);
  const generateDigest = useGenerateMarketDigest();
  const [digestModalDate, setDigestModalDate] = useState<string | null>(null);
  const handleDigestPress = () => {
    if (todayDigest?.data) { setDigestModalDate(todayKey); return; }
    if (generateDigest.isPending) return;
    generateDigest.mutate(todayKey, {
      onSuccess: () => setDigestModalDate(todayKey),
      onError: (e) => toast.error((e as Error).message),
    });
  };

  // Which past days actually have a digest — drives the blue calendar dot.
  // Only ever a lightweight date-list fetch (no content_json); the full
  // digest for a given day is only fetched once the user actually presses
  // "View Market Digest" for it, below.
  const queryClient = useQueryClient();
  const { data: digestListData } = useMarketDigestList(90);
  const digestDates = useMemo(
    () => new Set((digestListData?.data ?? []).map(d => d.digest_date)),
    [digestListData],
  );
  const [checkingDigestDate, setCheckingDigestDate] = useState<string | null>(null);
  const handleViewDigest = async (date: string) => {
    if (checkingDigestDate) return;
    setCheckingDigestDate(date);
    try {
      await queryClient.fetchQuery({ queryKey: ['market-digest', date], queryFn: () => fetchMarketDigest(date) });
      setDigestModalDate(date);
    } catch {
      Alert.alert('No Market Digest', `No digest was generated for ${format(parseISO(date), 'MMMM d, yyyy')}.`);
    } finally {
      setCheckingDigestDate(null);
    }
  };

  const noteIndicatorsByDay = useMemo(() => {
    const map = new Map<string, { hasNote: boolean; hasTodo: boolean }>();
    for (const n of notes) {
      const entry = map.get(n.note_date) ?? { hasNote: false, hasTodo: false };
      if (n.kind === 'note') entry.hasNote = true;
      if (n.kind === 'todo' && !n.is_done) entry.hasTodo = true;
      map.set(n.note_date, entry);
    }
    return map;
  }, [notes]);

  const openTodos = useMemo(
    () => notes
      .filter(n => n.kind === 'todo' && !n.is_done)
      .sort((a, b) => (a.note_date < b.note_date ? -1 : a.note_date > b.note_date ? 1 : 0)),
    [notes],
  );

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

  // Everything pinned to the selected day — drives the dynamic button/list
  // set in the bottom panel below (a day can have any mix of review, notes,
  // and TODOs, or none at all).
  const selectedDateNotes = useMemo(
    () => (selectedDate ? notes.filter(n => n.note_date === selectedDate) : []),
    [notes, selectedDate],
  );

  const handleGenerate = () => {
    if (!selectedDate || selectedIsReviewed || selectedIsFuture || generateReview.isPending) return;
    const dateToGenerate = selectedDate;
    setGeneratingDate(dateToGenerate);
    toast.info(`Generating ${mode} review… this takes ~15 seconds`);
    generateReview.mutate({ date: dateToGenerate, paperMode }, {
      onSuccess: (res) => {
        const date = res?.date as string | undefined;
        toast.success(`${mode === 'live' ? 'Live' : 'Paper'} review for ${date ?? dateToGenerate} is ready`);
        setSelectedDate(null);
        setGeneratingDate(null);
        setModalDate(date ?? dateToGenerate);
      },
      onError: (e) => {
        toast.error((e as Error).message);
        setGeneratingDate(null);
      },
    });
  };

  const handleModeChange = (next: AccountMode) => {
    setMode(next);
    setSelectedDate(null);
  };

  const handleDayPress = (day: Date) => {
    // Lock day selection while a generation is in flight — only one review
    // can be generated at a time, for any day.
    if (generateReview.isPending) return;

    // Every day (past, today, or future) opens the same preview panel —
    // whatever mix of review/notes/TODOs it has, all viewable in one place.
    // Review/TODO generation actions inside the panel disable themselves
    // per-day as needed (see the button block below).
    const key = dateKey(day);
    setSelectedDate(prev => (prev === key ? null : key));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>
            Daily Review
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
            Auto-generated at 4:15 PM ET · {mode === 'live' ? 'live account only' : 'paper account only'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <TouchableOpacity onPress={handleDigestPress} disabled={generateDigest.isPending} hitSlop={10} style={{ padding: 6 }}>
            <Ionicons name="sunny-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/backlog')} hitSlop={10} style={{ padding: 6 }}>
            <Ionicons name="list-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAddNoteDate(selectedDate ?? dateKey(today))}
            hitSlop={10}
            style={{ padding: 6 }}
          >
            <Ionicons name="add-circle" size={26} color={colors.accent} />
          </TouchableOpacity>
        </View>
      </View>

      <LiveModeToggle mode={mode} onChange={handleModeChange} colors={colors} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: selectedDate ? tabBarHeight + 140 : tabBarHeight + 20 }}
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
                  const isGenerating = generatingDate === key;
                  // While any day is generating, dim/lock every other day so it's
                  // clear only one review can run at a time.
                  const isLockedByOther = generateReview.isPending && !isGenerating;

                  return (
                    <Pressable
                      key={di}
                      onPress={() => handleDayPress(day)}
                      disabled={isLockedByOther}
                      style={{
                        flex: 1, alignItems: 'center', paddingVertical: 4,
                        opacity: isFuture ? 0.25 : isLockedByOther ? 0.35 : 1,
                      }}
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
                        {isGenerating ? (
                          <ActivityIndicator size="small" color={isSelected ? '#fff' : colors.accent} />
                        ) : (
                          <Text style={{
                            color: isSelected ? '#fff' : isReviewed ? colors.success : colors.text,
                            fontSize: 14,
                            fontWeight: (isToday || isSelected || isReviewed) ? '700' : '400',
                          }}>
                            {format(day, 'd')}
                          </Text>
                        )}
                      </View>
                      {/* Dot indicators — green reviewed, orange note, red open TODO, blue Market Digest */}
                      {!isSelected && !isGenerating && (() => {
                        const noteInfo = noteIndicatorsByDay.get(key);
                        const dotColors: string[] = [];
                        if (isReviewed) dotColors.push(colors.success);
                        if (noteInfo?.hasNote) dotColors.push(NOTE_COLOR);
                        if (noteInfo?.hasTodo) dotColors.push(colors.error);
                        if (digestDates.has(key)) dotColors.push(DIGEST_COLOR);
                        if (dotColors.length === 0) return null;
                        return (
                          <View style={{ flexDirection: 'row', gap: 3, marginTop: 2 }}>
                            {dotColors.map((c, i) => (
                              <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c }} />
                            ))}
                          </View>
                        );
                      })()}
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}
        </View>

        {/* Legend */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 20, marginTop: 20 }}>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: NOTE_COLOR }} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Note</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error }} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>TODO</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: DIGEST_COLOR }} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Market Digest</Text>
          </View>
        </View>

        {/* TODOs — earliest date to latest, across every month */}
        {openTodos.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>
              TODOs ({openTodos.length})
            </Text>
            <View style={{ gap: 8 }}>
              {openTodos.map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setActionNote(t)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
                    padding: 12, borderRadius: 12,
                    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                  }}
                >
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error, marginTop: 6 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={2}>{t.content}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 3 }}>
                      {format(parseISO(t.note_date), 'MMM d, yyyy')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Day preview panel — shown for any selected day (past, today, or
          future) and dynamically surfaces whatever that day actually has:
          a review button (view or generate, never both), and every
          note/TODO pinned to it. */}
      {selectedDate && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          maxHeight: '70%',
          backgroundColor: colors.surface,
          borderTopWidth: 1, borderTopColor: colors.border,
          paddingHorizontal: 20, paddingTop: 16, paddingBottom: tabBarHeight + 16,
        }}>
          {/* Selected date info */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
                {format(parseISO(selectedDate), 'EEEE, MMMM d')}
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
                {generateReview.isPending
                  ? 'Generating…'
                  : selectedIsReviewed
                    ? 'Review ready'
                    : selectedIsFuture ? "Upcoming — can't review yet" : 'No review generated yet'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setSelectedDate(null)}
              disabled={generateReview.isPending}
              style={{ padding: 4, opacity: generateReview.isPending ? 0.3 : 1 }}
            >
              <Ionicons name="close" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 10 }}>
            {/* Review button — "View" once it exists, "Generate" while it
                doesn't and the day isn't in the future; neither for a
                future day since there's nothing to review yet. */}
            {selectedIsReviewed ? (
              <TouchableOpacity
                onPress={() => { setModalDate(selectedDate); setSelectedDate(null); }}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingVertical: 14, borderRadius: 12, backgroundColor: colors.success + '22',
                  borderWidth: 1, borderColor: colors.success,
                }}
              >
                <Ionicons name="document-text" size={16} color={colors.success} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.success }}>View Review</Text>
              </TouchableOpacity>
            ) : !selectedIsFuture && (
              <TouchableOpacity
                onPress={handleGenerate}
                disabled={generateReview.isPending}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingVertical: 14, borderRadius: 12, backgroundColor: colors.accent,
                  opacity: generateReview.isPending ? 0.7 : 1,
                }}
              >
                {generateReview.isPending
                  ? <ActivityIndicator size="small" color={colors.accentForeground} />
                  : <Ionicons name="sparkles" size={16} color={colors.accentForeground} />}
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.accentForeground }}>
                  {generateReview.isPending ? 'Generating…' : 'Generate Review'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Market Digest for this specific day — read-only (a past
                digest either exists or never will; nothing to generate
                here). Always shown for any non-future day regardless of
                the blue dot above — existence is only actually checked once
                pressed, see handleViewDigest — so this never eagerly fetches
                every visible day's digest just to decide whether to render. */}
            {!selectedIsFuture && (
              <TouchableOpacity
                onPress={() => handleViewDigest(selectedDate)}
                disabled={checkingDigestDate === selectedDate}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingVertical: 14, borderRadius: 12, backgroundColor: DIGEST_COLOR + '22',
                  borderWidth: 1, borderColor: DIGEST_COLOR,
                  opacity: checkingDigestDate === selectedDate ? 0.7 : 1,
                }}
              >
                {checkingDigestDate === selectedDate
                  ? <ActivityIndicator size="small" color={DIGEST_COLOR} />
                  : <Ionicons name="newspaper-outline" size={16} color={DIGEST_COLOR} />}
                <Text style={{ fontSize: 15, fontWeight: '700', color: DIGEST_COLOR }}>
                  {checkingDigestDate === selectedDate ? 'Checking…' : 'View Market Digest'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Notes/TODOs pinned to this day — only rendered when there are any */}
            {selectedDateNotes.length > 0 && (
              <View style={{ gap: 8 }}>
                {selectedDateNotes.map(n => {
                  const tint = n.kind === 'todo' ? colors.error : NOTE_COLOR;
                  return (
                    <TouchableOpacity
                      key={n.id}
                      onPress={() => setActionNote(n)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'flex-start', gap: 10,
                        padding: 12, borderRadius: 12,
                        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                        opacity: n.kind === 'todo' && n.is_done ? 0.55 : 1,
                      }}
                    >
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: n.is_deferred ? '#F59E0B' : tint, marginTop: 6 }} />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: colors.text, fontSize: 13,
                            // Deferred skips the strikethrough — that reads
                            // as "crossed off," which isn't right for
                            // "set aside for later." The dimmed opacity
                            // above already marks it as not actively open.
                            textDecorationLine: n.kind === 'todo' && n.is_done && !n.is_deferred ? 'line-through' : 'none',
                          }}
                        >
                          {n.content}
                        </Text>
                        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 3 }}>
                          {n.kind.toUpperCase()}
                          {n.kind === 'todo' && n.is_deferred ? ' · Deferred' : n.kind === 'todo' && n.is_done ? ' · Finished' : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Add a note/TODO pinned to this specific day */}
            <TouchableOpacity
              onPress={() => setAddNoteDate(selectedDate)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                paddingVertical: 12, borderRadius: 12,
                borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
              }}
            >
              <Ionicons name="add" size={16} color={colors.textSecondary} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary }}>
                Add Note / TODO for this day
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <ReviewDetailModal
        date={modalDate}
        paperMode={paperMode}
        visible={!!modalDate}
        onClose={() => { setModalDate(null); refetch(); }}
      />

      <AddReviewNoteModal
        visible={!!addNoteDate}
        initialDate={addNoteDate ?? dateKey(today)}
        onClose={() => setAddNoteDate(null)}
      />
      <ReviewNoteActionModal note={actionNote} onClose={() => setActionNote(null)} />

      <MarketDigestModal
        date={digestModalDate}
        visible={!!digestModalDate}
        onClose={() => setDigestModalDate(null)}
      />
      <DigestGeneratingOverlay visible={generateDigest.isPending} />
    </SafeAreaView>
  );
}
