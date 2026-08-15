import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useReviewNotes } from '@/hooks/queries/review/useReviewNotes';
import { ReviewNoteActionModal } from '@/common/components/review/ReviewNoteActionModal';
import type { ReviewNote, ReviewNoteKind } from '@/common/types/reviewNotes';

const NOTE_COLOR = '#F59E0B';

type KindFilter = 'all' | ReviewNoteKind;
type StatusFilter = 'all' | 'open' | 'done';

/**
 * Full backlog of every Note/TODO across every review date — reached via
 * the list icon in Daily Review's header. Filterable by kind and status
 * (status only matters for TODOs; notes have no done state).
 */
export default function BacklogScreen() {
  const colors = useThemeColors();
  const { data, isLoading } = useReviewNotes();
  const notes = data?.data ?? [];

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [actionNote, setActionNote] = useState<ReviewNote | null>(null);

  const filtered = useMemo(() => {
    return notes
      .filter(n => kindFilter === 'all' || n.kind === kindFilter)
      .filter(n => {
        if (statusFilter === 'all') return true;
        if (n.kind === 'note') return true; // notes have no done state — never hidden by status
        return statusFilter === 'done' ? n.is_done : !n.is_done;
      })
      .sort((a, b) => (a.note_date < b.note_date ? 1 : a.note_date > b.note_date ? -1 : 0));
  }, [notes, kindFilter, statusFilter]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Backlog</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Kind filter */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 }}>
        {([
          ['all', 'All'], ['todo', 'TODOs'], ['note', 'Notes'],
        ] as [KindFilter, string][]).map(([value, label]) => (
          <Chip key={value} active={kindFilter === value} label={label} onPress={() => setKindFilter(value)} colors={colors} />
        ))}
      </View>

      {/* Status filter — only meaningful for TODOs, shown regardless since
          it's harmless for notes (they just ignore it, see filtered above) */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 }}>
        {([
          ['open', 'Open'], ['done', 'Finished'], ['all', 'All'],
        ] as [StatusFilter, string][]).map(([value, label]) => (
          <Chip key={value} active={statusFilter === value} label={label} onPress={() => setStatusFilter(value)} colors={colors} small />
        ))}
      </View>

      {isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}>
          {filtered.length === 0 && (
            <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center', marginTop: 30 }}>
              Nothing here.
            </Text>
          )}
          {filtered.map(n => {
            const tint = n.kind === 'todo' ? colors.error : NOTE_COLOR;
            return (
              <TouchableOpacity
                key={n.id}
                onPress={() => setActionNote(n)}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: 10,
                  padding: 12, borderRadius: 12, marginBottom: 8,
                  backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                  opacity: n.kind === 'todo' && n.is_done ? 0.55 : 1,
                }}
              >
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: n.is_deferred ? '#F59E0B' : tint, marginTop: 6 }} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.text, fontSize: 13,
                      textDecorationLine: n.kind === 'todo' && n.is_done && !n.is_deferred ? 'line-through' : 'none',
                    }}
                  >
                    {n.content}
                  </Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 3 }}>
                    {n.kind.toUpperCase()} · {format(parseISO(n.note_date), 'MMM d, yyyy')}
                    {n.kind === 'todo' && n.is_deferred ? ' · Deferred' : n.kind === 'todo' && n.is_done ? ' · Finished' : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ReviewNoteActionModal note={actionNote} onClose={() => setActionNote(null)} />
    </SafeAreaView>
  );
}

function Chip({
  active, label, onPress, colors, small,
}: {
  active: boolean; label: string; onPress: () => void; colors: any; small?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        paddingHorizontal: small ? 12 : 14, paddingVertical: small ? 6 : 8, borderRadius: 999,
        backgroundColor: active ? colors.accent : colors.card,
        borderWidth: 1, borderColor: active ? colors.accent : colors.border,
      }}
    >
      <Text style={{ color: active ? '#fff' : colors.textSecondary, fontSize: small ? 12 : 13, fontWeight: '700' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}
