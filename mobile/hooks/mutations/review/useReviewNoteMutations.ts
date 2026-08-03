import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ReviewNote, ReviewNoteKind } from '@/common/types/reviewNotes';

interface CreateNoteArgs {
  note_date: string;
  kind: ReviewNoteKind;
  content: string;
}

interface UpdateNoteArgs {
  id: string;
  note_date?: string;
  kind?: ReviewNoteKind;
  content?: string;
  is_done?: boolean;
}

async function parseOrThrow(resp: Response): Promise<{ success: boolean; data?: ReviewNote; error?: string }> {
  const text = await resp.text();
  let json: { success: boolean; data?: ReviewNote; error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Server error (${resp.status}): response was not JSON`);
  }
  if (!json.success) throw new Error(json.error ?? 'Request failed');
  return json;
}

export function useCreateReviewNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateNoteArgs) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/review/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      return parseOrThrow(resp);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-notes'] }),
  });
}

export function useUpdateReviewNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateNoteArgs) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/review/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return parseOrThrow(resp);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-notes'] }),
  });
}

export function useDeleteReviewNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/review/notes/${id}`, { method: 'DELETE' });
      return parseOrThrow(resp);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-notes'] }),
  });
}
