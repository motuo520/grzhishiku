import api from './client';

import type { TagSelectorTag } from '@/components/TagSelector';

export interface Clip {
  id: string;
  title: string;
  url: string;
  domain: string;
  excerpt: string | null;
  full_text: string | null;
  brain_side: string;
  tags: TagSelectorTag[];
  created_at: string;
  updated_at: string;
}

export interface ClipCreateData {
  title: string;
  url: string;
  domain: string;
  excerpt?: string;
  full_text?: string;
  brain_side?: string;
  tags?: string[];
}

export interface ClipUpdateData {
  title?: string;
  url?: string;
  domain?: string;
  excerpt?: string;
  full_text?: string;
  tags?: string[];
}

export interface BatchCreateClipsData {
  items: ClipCreateData[];
}

export interface UrlMetadata {
  url: string;
  title: string;
  domain: string;
  excerpt?: string;
  error?: string;
}

export interface BatchCreateResult<T> {
  success_count: number;
  failed_count: number;
  failures: { index: number; title?: string; reason: string }[];
  items: T[];
  // 防重：已存在的相同内容/链接被跳过（可选，旧后端无此字段）
  skipped_count?: number;
  skipped?: { index: number; title?: string; reason: string }[];
}

export const clipsApi = {
  list: (params?: { q?: string; domain?: string; tag_ids?: string; skip?: number; limit?: number }) =>
    api.get<Clip[]>('/api/v1/clips/', { params }),
  create: (data: ClipCreateData) => api.post<Clip>('/api/v1/clips/', data),
  update: (id: string, data: ClipUpdateData) => api.put<Clip>(`/api/v1/clips/${id}`, data),
  saveToKnowledge: (id: string) => api.post(`/api/v1/clips/${id}/save-to-knowledge`),
  batchCreate: (data: BatchCreateClipsData) => api.post<BatchCreateResult<Clip>>('/api/v1/clips/batch', data),
  fetchMetadata: (urls: string[]) => api.post<UrlMetadata[]>('/api/v1/clips/fetch-metadata', { urls }),
  get: (id: string) => api.get<Clip>(`/api/v1/clips/${id}`),
  delete: (id: string) => api.delete(`/api/v1/clips/${id}`),
};
