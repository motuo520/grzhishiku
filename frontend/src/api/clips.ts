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
  folder_id?: string | null;
  tags: TagSelectorTag[];
  // 仓库模式：true=只进检索层（AI 问答可答），不进图谱/百科/打标/复盘
  index_only: boolean;
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
  index_only?: boolean;
}

export interface ClipUpdateData {
  title?: string;
  url?: string;
  domain?: string;
  excerpt?: string;
  full_text?: string;
  tags?: string[];
  folder_id?: string | null;
  index_only?: boolean;
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
  list: (params?: { q?: string; domain?: string; tag_ids?: string; skip?: number; limit?: number; folder_id?: string; brain_side?: string }) =>
    api.get<Clip[]>('/api/v1/clips/', { params }),
  create: (data: ClipCreateData) => api.post<Clip>('/api/v1/clips/', data),
  update: (id: string, data: ClipUpdateData) => api.put<Clip>(`/api/v1/clips/${id}`, data),
  saveToKnowledge: (id: string) => api.post(`/api/v1/clips/${id}/save-to-knowledge`),
  batchCreate: (data: BatchCreateClipsData) => api.post<BatchCreateResult<Clip>>('/api/v1/clips/batch', data),
  fetchMetadata: (urls: string[]) => api.post<UrlMetadata[]>('/api/v1/clips/fetch-metadata', { urls }),
  // 服务端抓 URL 正文（readability）：剪藏表单「抓取填充」（09-01 立项，无扩展场景的补齐）
  fetchContent: (url: string) =>
    api.post<{ url: string; title: string; domain: string; excerpt?: string; full_text?: string; error?: string }>(
      '/api/v1/clips/fetch-content', { url }),
  get: (id: string) => api.get<Clip>(`/api/v1/clips/${id}`),
  delete: (id: string) => api.delete(`/api/v1/clips/${id}`),
  batchDelete: (ids: string[]) => api.request({ method: 'DELETE', url: '/api/v1/clips/batch', data: { ids } }),
};
