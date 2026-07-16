import api from './client';

export interface SocialAccount {
  id: string;
  user_id: string;
  provider: 'wechat' | 'dingtalk' | 'feishu';
  account_name: string | null;
  connection_type: string;
  sync_status: string;
  last_sync_at: string | null;
  last_error: string | null;
  sync_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SocialAccountCreateData {
  provider: 'wechat' | 'dingtalk' | 'feishu';
  account_name?: string;
}

export interface SocialMessage {
  id: string;
  user_id: string;
  account_id: string;
  platform: string;
  conversation_id: string | null;
  conversation_name: string | null;
  message_uid: string;
  sender_name: string | null;
  sender_id: string | null;
  content_raw: string | null;
  content_text: string | null;
  message_type: string;
  attachments: string | null;
  sent_at: string | null;
  is_me: boolean;
  status: string;
  knowledge_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialUploadResult {
  success: boolean;
  parsed_count: number;
  skipped_count: number;
  error?: string;
}

export const socialApi = {
  listAccounts: () => api.get<SocialAccount[]>('/api/v1/social/accounts'),
  createAccount: (data: SocialAccountCreateData) =>
    api.post<SocialAccount>('/api/v1/social/accounts', data),
  deleteAccount: (id: string) => api.delete(`/api/v1/social/accounts/${id}`),
  uploadFile: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<SocialUploadResult>(`/api/v1/social/accounts/${id}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  listMessages: (params?: {
    account_id?: string;
    conversation_id?: string;
    q?: string;
    skip?: number;
    limit?: number;
  }) => api.get<SocialMessage[]>('/api/v1/social/messages', { params }),
  getMessage: (id: string) => api.get<SocialMessage>(`/api/v1/social/messages/${id}`),
  saveToKnowledge: (id: string, tag_ids?: string[], brain_side?: string) =>
    api.post(`/api/v1/social/messages/${id}/save-to-knowledge`, { tag_ids, brain_side }),
  deleteMessage: (id: string) => api.delete(`/api/v1/social/messages/${id}`),
};
