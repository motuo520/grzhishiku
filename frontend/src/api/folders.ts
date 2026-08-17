import api from './client';

export interface Folder {
  id: string;
  user_id: string;
  brain_side: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  note_count: number;
  knowledge_count: number;
  created_at: string;
  updated_at: string;
}

export interface FolderCreateData {
  name: string;
  brain_side: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface FolderUpdateData {
  name?: string;
  parent_id?: string | null;
  sort_order?: number;
}

export const foldersApi = {
  list: (brainSide: string) => api.get<Folder[]>('/api/v1/folders/', { params: { brain_side: brainSide } }),
  create: (data: FolderCreateData) => api.post<Folder>('/api/v1/folders/', data),
  update: (id: string, data: FolderUpdateData) => api.put<Folder>(`/api/v1/folders/${id}`, data),
  remove: (id: string) => api.delete<{ success: boolean }>(`/api/v1/folders/${id}`),
};
