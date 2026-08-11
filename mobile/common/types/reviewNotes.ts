export type ReviewNoteKind = 'note' | 'todo';

export interface ReviewNote {
  id: string;
  note_date: string; // "YYYY-MM-DD"
  kind: ReviewNoteKind;
  content: string;
  is_done: boolean;
  /** Set aside for later, distinct from actually resolved — see
   *  useUpdateReviewNote's docstring. Always true implies is_done true too
   *  (deferring forces is_done — see the backend PATCH route). */
  is_deferred: boolean;
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
