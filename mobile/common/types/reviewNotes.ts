export type ReviewNoteKind = 'note' | 'todo';

export interface ReviewNote {
  id: string;
  note_date: string; // "YYYY-MM-DD"
  kind: ReviewNoteKind;
  content: string;
  is_done: boolean;
  completion_note: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewNotesResponse {
  success: boolean;
  data: ReviewNote[];
  error?: string;
}
