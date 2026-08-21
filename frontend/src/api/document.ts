import api from './client';

export interface DocumentItem {
  id: string;
  user_id: string;
  title?: string;
  original_name: string;
  file_path: string;
  file_size: number;
  file_type?: string;
  content_text?: string;
  extraction_status: 'pending' | 'success' | 'error';
  extraction_error?: string;
  doc_status: string;
  knowledge_id?: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentFilters {
  file_type?: string;
  extraction_status?: string;
  q?: string;
  skip?: number;
  limit?: number;
}

export const documentApi = {
  list: (params?: DocumentFilters) => api.get<DocumentItem[]>('/api/v1/documents/', { params }),
  upload: (file: File, title?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    return api.post<DocumentItem>('/api/v1/documents/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  get: (id: string) => api.get<DocumentItem>(`/api/v1/documents/${id}`),
  reextract: (id: string) => api.post<DocumentItem>(`/api/v1/documents/${id}/extract`),
  delete: (id: string) => api.delete(`/api/v1/documents/${id}`),
  batchDelete: (ids: string[]) => api.request({ method: 'DELETE', url: '/api/v1/documents/batch', data: { ids } }),
  saveToKnowledge: (id: string, tagIds?: string[]) =>
    api.post<{ success: boolean; knowledge_id: string }>(`/api/v1/documents/${id}/save-to-knowledge`, { tag_ids: tagIds }),
};
