import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, SafeAreaView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useCreateReviewNote } from '@/hooks/mutations/review/useReviewNoteMutations';
import { useToast } from '@/common/components/ui/Toast';
import type { ReviewNoteKind } from '@/common/types/reviewNotes';

interface Props {
  visible: boolean;
  /** Date the "+" button was pressed for — pre-fills the entry, but the day
   *  stepper here still lets it be changed before saving (referencing the
   *  intended review day is the whole point of the entry). */
  initialDate: string;
  onClose: () => void;
}

/**
 * "+" entry sheet for Daily Review — a freeform note or TODO pinned to a
 * specific date, rendered as a bullet everywhere it's listed (the day's
 * dot indicator, the TODO list, the backlog screen).
 */
export function AddReviewNoteModal({ visible, initialDate, onClose }: Props) {
  const colors = useThemeColors();
  const toast = useToast();
  const createNote = useCreateReviewNote();

  const [date, setDate] = useState(initialDate);
  const [kind, setKind] = useState<ReviewNoteKind>('todo');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (visible) {
      setDate(initialDate);
      setKind('todo');
      setContent('');
    }
  }, [visible, initialDate]);

  const handleSave = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    createNote.mutate({ note_date: date, kind, content: trimmed }, {
      onSuccess: () => {
        toast.success(kind === 'todo' ? 'TODO added' : 'Note added');
        onClose();
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Add Note / TODO</Text>
                <TouchableOpacity onPress={onClose} hitSlop={12}>
                  <Ionicons name="close" size={22} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>

              {/* Day stepper — references the review date this entry is for */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <TouchableOpacity onPress={() => setDate(d => format(subDays(parseISO(d), 1), 'yyyy-MM-dd'))} style={{ padding: 8 }}>
                  <Ionicons name="chevron-back" size={18} color={colors.text} />
                </TouchableOpacity>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                  {format(parseISO(date), 'EEEE, MMMM d')}
                </Text>
                <TouchableOpacity onPress={() => setDate(d => format(addDays(parseISO(d), 1), 'yyyy-MM-dd'))} style={{ padding: 8 }}>
                  <Ionicons name="chevron-forward" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              {/* Note / TODO toggle */}
              <View style={{ flexDirection: 'row', backgroundColor: colors.background, borderRadius: 10, padding: 3, gap: 3 }}>
                {(['todo', 'note'] as ReviewNoteKind[]).map(k => {
                  const active = kind === k;
                  const tint = k === 'todo' ? colors.error : '#F59E0B';
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setKind(k)}
                      style={{
                        flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8,
                        backgroundColor: active ? tint + '22' : 'transparent',
                      }}
                    >
                      <Text style={{ color: active ? tint : colors.textTertiary, fontSize: 13, fontWeight: '700' }}>
                        {k === 'todo' ? 'TODO' : 'Note'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                value={content}
                onChangeText={setContent}
                placeholder={kind === 'todo' ? 'What needs to get done…' : 'Write a note…'}
                placeholderTextColor={colors.textTertiary}
                multiline
                numberOfLines={4}
                autoFocus
                style={{
                  color: colors.text, fontSize: 15, borderWidth: 1, borderColor: colors.border,
                  borderRadius: 12, padding: 14, minHeight: 90, textAlignVertical: 'top',
                }}
              />

              <TouchableOpacity
                onPress={handleSave}
                disabled={!content.trim() || createNote.isPending}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingVertical: 14, borderRadius: 12,
                  backgroundColor: colors.accent, opacity: (!content.trim() || createNote.isPending) ? 0.5 : 1,
                }}
              >
                {createNote.isPending
                  ? <ActivityIndicator size="small" color={colors.accentForeground} />
                  : <Text style={{ color: colors.accentForeground, fontSize: 15, fontWeight: '700' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
