import api from './client';

export interface StickyNote {
  id: string;
  user_id: string;
  content: string;
  color: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  is_pinned: boolean;
  is_archived: boolean;
  is_todo: boolean;
  is_completed: boolean;
  converted_to_note_id: string | null;
  remind_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StickyNoteList {
  total: number;
  notes: StickyNote[];
}

export interface CreateStickyNoteData {
  content: string;
  color?: string;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  is_pinned?: boolean;
  is_todo?: boolean;
  remind_at?: string | null;
}

export interface UpdateStickyNoteData {
  content?: string;
  color?: string;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  is_pinned?: boolean;
  is_archived?: boolean;
  is_todo?: boolean;
  is_completed?: boolean;
  converted_to_note_id?: string | null;
  remind_at?: string | null;
}

export const stickyNoteApi = {
  getNotes: (includeArchived = false) =>
    api.get<StickyNoteList>('/api/v1/sticky/sticky-notes/', { params: { include_archived: includeArchived } }),
  createNote: (data: CreateStickyNoteData) =>
    api.post<StickyNote>('/api/v1/sticky/sticky-notes/', data),
  updateNote: (id: string, data: UpdateStickyNoteData) =>
    api.patch<StickyNote>(`/api/v1/sticky/sticky-notes/${id}`, data),
  deleteNote: (id: string) =>
    api.delete(`/api/v1/sticky/sticky-notes/${id}`),
  convertToNote: (id: string) =>
    api.post<{ note_id: string }>(`/api/v1/sticky/sticky-notes/${id}/convert-to-note`),
};
