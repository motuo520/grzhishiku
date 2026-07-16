import api from './client';

export interface ReadLaterItem {
  id: string;
  user_id: string;
  title?: string;
  url: string;
  domain?: string;
  excerpt?: string;
  full_text?: string;
  cover_image?: string;
  status: 'unread' | 'reading' | 'read' | 'archived';
  is_favorite: boolean;
  read_progress: number;
  source: string;
  item_status: string;
  knowledge_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ReadLaterCreateData {
  url: string;
  title?: string;
  excerpt?: string;
  source?: string;
}

export interface ReadLaterUpdateData {
  title?: string;
  excerpt?: string;
  status?: 'unread' | 'reading' | 'read' | 'archived';
  is_favorite?: boolean;
  read_progress?: number;
}

export interface ReadLaterFilters {
  status?: string;
  is_favorite?: boolean;
  q?: string;
  skip?: number;
  limit?: number;
}

export const readLaterApi = {
  list: (params?: ReadLaterFilters) => api.get<ReadLaterItem[]>('/api/v1/read-later/items', { params }),
  create: (data: ReadLaterCreateData) => api.post<ReadLaterItem>('/api/v1/read-later/items', data),
  get: (id: string) => api.get<ReadLaterItem>(`/api/v1/read-later/items/${id}`),
  update: (id: string, data: ReadLaterUpdateData) => api.put<ReadLaterItem>(`/api/v1/read-later/items/${id}`, data),
  delete: (id: string) => api.delete(`/api/v1/read-later/items/${id}`),
  fetchContent: (id: string) => api.post<ReadLaterItem>(`/api/v1/read-later/items/${id}/fetch-content`),
  saveToKnowledge: (id: string, tagIds?: string[]) =>
    api.post<{ success: boolean; knowledge_id: string }>(`/api/v1/read-later/items/${id}/save-to-knowledge`, { tag_ids: tagIds }),
};
