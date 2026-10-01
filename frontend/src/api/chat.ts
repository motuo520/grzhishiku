import api from './client';

export interface ChatConversation {
  id: string;
  title: string;
  /** 会话模式：普通问答（chat）/ 独立智能体（agent），由创建时 body 的 mode 决定 */
  mode: string;
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
    // 批⑤ 取证回执（agent_evidence 键）不是引用源：深度研究 refs 末位标记条目
    // 在此过滤，防历史页渲染幽灵引用行；agent 会话的 dict 命名空间形态由
    // Array.isArray 天然挡掉
    return Array.isArray(parsed)
      ? parsed.filter((r) => r && typeof r === 'object' && !('agent_evidence' in r))
      : [];
  } catch {
    return [];
  }
}

export const chatApi = {
  // mode 过滤（如 mode=agent 只列智能体会话）；不传保持旧行为
  listConversations: (mode?: string) =>
    api.get<ChatConversationList>('/api/v1/chat/conversations', {
      params: mode ? { mode } : undefined,
    }),
  // mode 缺省不带，保持旧调用方行为不变
  createConversation: (title?: string, mode?: string) =>
    api.post<ChatConversation>('/api/v1/chat/conversations', {
      ...(title ? { title } : {}),
      ...(mode ? { mode } : {}),
    }),
  getConversation: (id: string) =>
    api.get<ChatConversationDetail>(`/api/v1/chat/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    api.patch<ChatConversation>(`/api/v1/chat/conversations/${id}`, { title }),
  deleteConversation: (id: string) =>
    api.delete(`/api/v1/chat/conversations/${id}`),
};
