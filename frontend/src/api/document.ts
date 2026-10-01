import api from './client';
import type { NoteTag } from './notes';

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
  brain_side?: string;
  // 所属文件夹（手动归档，口径B）：null/缺省=未归档
  folder_id?: string | null;
  // 自动/人工标签（09-11 文档纳入自动打标，随响应下发）
  tags?: NoteTag[];
  // 仓库模式：true=只进检索层（AI 问答可答），不进图谱/百科/打标/复盘
  index_only?: boolean;
  created_at: string;
  updated_at: string;
}

export interface DocumentFilters {
  file_type?: string;
  extraction_status?: string;
  q?: string;
  brain_side?: string;
  folder_id?: string;
  skip?: number;
  limit?: number;
}

export const documentApi = {
  list: (params?: DocumentFilters) => api.get<DocumentItem[]>('/api/v1/documents/', { params }),
  upload: (file: File, title?: string, indexOnly?: boolean) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    // 仓库模式走 query 参数（multipart body 只放文件/标题）
    return api.post<DocumentItem>('/api/v1/documents/', formData, {
      params: indexOnly ? { index_only: true } : undefined,
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  get: (id: string) => api.get<DocumentItem>(`/api/v1/documents/${id}`),
  // 手动归档：folder_id 显式 null = 移出文件夹；文本类文档在线编辑：title/content（写 content_text 文本层）
  update: (id: string, data: { folder_id?: string | null; title?: string; content?: string; index_only?: boolean }) => api.put<DocumentItem>(`/api/v1/documents/${id}`, data),
  reextract: (id: string) => api.post<DocumentItem>(`/api/v1/documents/${id}/extract`),
  delete: (id: string) => api.delete(`/api/v1/documents/${id}`),
  batchDelete: (ids: string[]) => api.request({ method: 'DELETE', url: '/api/v1/documents/batch', data: { ids } }),
  saveToKnowledge: (id: string, tagIds?: string[]) =>
    api.post<{ success: boolean; knowledge_id: string }>(`/api/v1/documents/${id}/save-to-knowledge`, { tag_ids: tagIds }),
};
