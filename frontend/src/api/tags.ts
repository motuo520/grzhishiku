import api from './client';

export interface Tag {
  id: string;
  name: string;
  color: string;
  description?: string;
  usage_count: number;
  usage_breakdown: {
    note?: number;
    clip?: number;
    knowledge?: number;
  };
  created_at: string;
  updated_at: string;
}

export interface TagCreateData {
  name: string;
  color?: string;
  description?: string;
}

export interface TagUpdateData {
  name?: string;
  color?: string;
  description?: string;
}

export interface TagAssociationItem {
  id: string;
  title: string;
  type: string;
  url?: string;
}

export interface TagAssociationsResponse {
  tag_id: string;
  note: TagAssociationItem[];
  clip: TagAssociationItem[];
  knowledge: TagAssociationItem[];
}

export const tagsApi = {
  list: () => api.get<Tag[]>('/api/v1/tags/'),
  create: (data: TagCreateData) => api.post<Tag>('/api/v1/tags/', data),
  get: (id: string) => api.get<Tag>(`/api/v1/tags/${id}`),
  update: (id: string, data: TagUpdateData) => api.put<Tag>(`/api/v1/tags/${id}`, data),
  delete: (id: string) => api.delete(`/api/v1/tags/${id}`),
  merge: (id: string, targetTagId: string) => api.post<Tag>(`/api/v1/tags/${id}/merge`, { target_tag_id: targetTagId }),
  cleanup: () => api.delete<{ success: boolean; deleted_count: number }>('/api/v1/tags/orphaned'),
  associations: (id: string) => api.get<TagAssociationsResponse>(`/api/v1/tags/${id}/associations`),
};
