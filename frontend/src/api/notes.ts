import api from './client';

export interface NoteTag {
  id: string;
  name: string;
  color: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  brain_side: string;
  evolution_stage?: string;
  tags: NoteTag[];
  created_at: string;
  updated_at: string;
}

export interface NoteCreateData {
  title: string;
  content: string;
  brain_side?: string;
  tags?: string[];
}

export interface NoteUpdateData {
  title?: string;
  content?: string;
  brain_side?: string;
  tags?: string[];
}

export interface BatchCreateNotesData {
  items: NoteCreateData[];
}

export interface BatchCreateResult<T> {
  success_count: number;
  failed_count: number;
  failures: { index: number; title?: string; reason: string }[];
  items: T[];
}

export const notesApi = {
  list: (params?: { q?: string; tag_ids?: string; sort?: string; order?: string; brain_side?: string; skip?: number; limit?: number }) =>
    api.get<Note[]>('/api/v1/notes/', { params }),
  create: (data: NoteCreateData) => api.post<Note>('/api/v1/notes/', data),
  batchCreate: (data: BatchCreateNotesData) => api.post<BatchCreateResult<Note>>('/api/v1/notes/batch', data),
  batchDelete: (ids: string[]) => api.delete('/api/v1/notes/batch', { data: { ids } }),
  get: (id: string) => api.get<Note>(`/api/v1/notes/${id}`),
  update: (id: string, data: NoteUpdateData) => api.put<Note>(`/api/v1/notes/${id}`, data),
  delete: (id: string) => api.delete(`/api/v1/notes/${id}`),
};
