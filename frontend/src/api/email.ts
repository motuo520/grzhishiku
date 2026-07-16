import api from './client';

export interface EmailAccount {
  id: string;
  user_id: string;
  provider: string;
  email_address: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_use_ssl: boolean | null;
  sync_status: string;
  last_sync_at: string | null;
  last_error: string | null;
  sync_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EmailAccountCreateData {
  provider: string;
  email_address: string;
  imap_host?: string;
  imap_port?: number;
  imap_use_ssl?: boolean;
  access_token: string;
  refresh_token?: string;
}

export interface EmailMessage {
  id: string;
  account_id: string;
  message_uid: string;
  subject: string | null;
  sender_name: string | null;
  sender_email: string | null;
  recipients_to: string | null;
  recipients_cc: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  is_read: boolean;
  labels: string | null;
  status: string;
  knowledge_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailSyncResult {
  success: boolean;
  synced_count: number;
  error?: string;
}

export const emailApi = {
  listAccounts: () => api.get<EmailAccount[]>('/api/v1/email/accounts'),
  createAccount: (data: EmailAccountCreateData) => api.post<EmailAccount>('/api/v1/email/accounts', data),
  deleteAccount: (id: string) => api.delete(`/api/v1/email/accounts/${id}`),
  syncAccount: (id: string, maxMessages?: number) =>
    api.post<EmailSyncResult>(`/api/v1/email/accounts/${id}/sync`, null, { params: { max_messages: maxMessages } }),
  listMessages: (params?: { account_id?: string; q?: string; status?: string; skip?: number; limit?: number }) =>
    api.get<EmailMessage[]>('/api/v1/email/messages', { params }),
  getMessage: (id: string) => api.get<EmailMessage>(`/api/v1/email/messages/${id}`),
  saveToKnowledge: (id: string, tag_ids?: string[]) =>
    api.post(`/api/v1/email/messages/${id}/save-to-knowledge`, { tag_ids }),
  deleteMessage: (id: string) => api.delete(`/api/v1/email/messages/${id}`),
};
