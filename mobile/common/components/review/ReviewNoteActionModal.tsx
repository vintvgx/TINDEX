import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useUpdateReviewNote, useDeleteReviewNote } from '@/hooks/mutations/review/useReviewNoteMutations';
import { useToast } from '@/common/components/ui/Toast';
import type { ReviewNote } from '@/common/types/reviewNotes';

interface Props {
  note: ReviewNote | null;
  onClose: () => void;
}

/**
 * Tap-to-manage sheet for an existing note/TODO — reassign to a different
 * date, toggle finished (TODO only), or delete. Shared by the Daily Review
 * TODO list and the Backlog screen so both surfaces manage entries the
 * same way.
 */
export function ReviewNoteActionModal({ note, onClose }: Props) {
  const colors = useThemeColors();
  const toast = useToast();
  const updateNote = useUpdateReviewNote();
  const deleteNote = useDeleteReviewNote();
  const [reassignDate, setReassignDate] = useState<string | null>(null);

  useEffect(() => {
    setReassignDate(null);
  }, [note?.id]);

  if (!note) return null;
  const tint = note.kind === 'todo' ? colors.error : '#F59E0B';

  const handleToggleDone = () => {
    updateNote.mutate({ id: note.id, is_done: !note.is_done }, {
      onSuccess: () => {
        toast.success(note.is_done ? 'Marked as open' : 'Marked as finished');
        onClose();
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  const handleSaveReassign = () => {
    if (!reassignDate || reassignDate === note.note_date) { setReassignDate(null); return; }
    updateNote.mutate({ id: note.id, note_date: reassignDate }, {
      onSuccess: () => {
        toast.success(`Moved to ${format(parseISO(reassignDate), 'MMM d')}`);
        onClose();
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  const handleDelete = () => {
    deleteNote.mutate(note.id, {
      onSuccess: () => { toast.success('Deleted'); onClose(); },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  const busy = updateNote.isPending || deleteNote.isPending;

  return (
    <Modal visible={!!note} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <SafeAreaView style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint }} />
                <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '700' }}>
                  {note.kind.toUpperCase()} · {format(parseISO(note.note_date), 'MMM d')}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>{note.content}</Text>

            {reassignDate ? (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <TouchableOpacity onPress={() => setReassignDate(d => format(subDays(parseISO(d!), 1), 'yyyy-MM-dd'))} style={{ padding: 8 }}>
                    <Ionicons name="chevron-back" size={18} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                    {format(parseISO(reassignDate), 'EEEE, MMMM d')}
                  </Text>
                  <TouchableOpacity onPress={() => setReassignDate(d => format(addDays(parseISO(d!), 1), 'yyyy-MM-dd'))} style={{ padding: 8 }}>
                    <Ionicons name="chevron-forward" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={handleSaveReassign}
                  disabled={busy}
                  style={{ paddingVertical: 13, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Move to this date</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {note.kind === 'todo' && (
                  <ActionRow
                    icon={note.is_done ? 'checkmark-circle' : 'checkmark-circle-outline'}
                    label={note.is_done ? 'Mark as not finished' : 'Mark as finished'}
                    color={colors.success}
                    onPress={handleToggleDone}
                    disabled={busy}
                    colors={colors}
                  />
                )}
                <ActionRow
                  icon="calendar-outline"
                  label="Reassign to a different date"
                  color={colors.accent}
                  onPress={() => setReassignDate(note.note_date)}
                  disabled={busy}
                  colors={colors}
                />
                <ActionRow
                  icon="trash-outline"
                  label="Delete"
                  color={colors.error}
                  onPress={handleDelete}
                  disabled={busy}
                  colors={colors}
                />
              </View>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ActionRow({
  icon, label, color, onPress, disabled, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap; label: string; color: string;
  onPress: () => void; disabled: boolean; colors: any;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12,
        backgroundColor: colors.background, opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}
