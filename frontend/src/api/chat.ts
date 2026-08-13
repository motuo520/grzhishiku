import api from './client';

export interface ChatConversation {
  id: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ChatConversationListItem extends ChatConversation {
  message_count: number;
}

export interface ChatConversationList {
  total: number;
  conversations: ChatConversationListItem[];
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  refs: string | null; // 引用列表 JSON（与 /llm/chat 的 sources 事件同构）
  model: string | null;
  created_at: string | null;
}

export interface ChatConversationDetail extends ChatConversation {
  messages: ChatMessage[];
}

// 助手消息里的引用条目（检索来源）
export interface ChatSource {
  id: string;
  title: string;
  preview?: string;
  source_type?: string;
}

export function parseMessageRefs(refs: string | null): ChatSource[] {
  if (!refs) return [];
  try {
    const parsed = JSON.parse(refs);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const chatApi = {
  listConversations: () => api.get<ChatConversationList>('/api/v1/chat/conversations'),
  createConversation: (title?: string) =>
    api.post<ChatConversation>('/api/v1/chat/conversations', title ? { title } : {}),
  getConversation: (id: string) =>
    api.get<ChatConversationDetail>(`/api/v1/chat/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    api.patch<ChatConversation>(`/api/v1/chat/conversations/${id}`, { title }),
  deleteConversation: (id: string) =>
    api.delete(`/api/v1/chat/conversations/${id}`),
};
