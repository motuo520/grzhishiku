import { FC, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Plus, Trash2, Pencil, Check, X, BookMarked, MessageCircle,
} from 'lucide-react';
import {
  useChatConversations, useChatConversationDetail,
  useCreateConversation, useRenameConversation, useDeleteConversation,
} from '@/hooks/useChatHistory';
import { useChat } from '@/store/chat';
import { parseMessageRefs } from '@/api/chat';
import type { ChatMessage } from '@/api/chat';
import { knowledgeApi } from '@/api/knowledge';
import { useModelDisplayName } from '@/hooks/useModelDisplayName';

const formatTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

// 单条消息气泡：assistant 显示模型名、引用列表和「存为知识单元」
const MessageBubble: FC<{
  msg: ChatMessage;
  conversationTitle: string;
  onSaved: (ok: boolean) => void;
}> = ({ msg, conversationTitle, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const modelName = useModelDisplayName(msg.model || undefined);
  const refs = parseMessageRefs(msg.refs);

  // 「轻」档沉淀：答案正文 + 引用附录直接进知识单元
  const handleSaveToKnowledge = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const appendix = refs.length > 0
        ? `\n\n--- 引用来源 ---\n${refs.map((r, i) => `[${i + 1}] ${r.title}`).join('\n')}`
        : '';
      await knowledgeApi.create({
        content_raw: msg.content + appendix,
        brain_side: 'personal',
        content_type: '对话沉淀',
        source_type: 'chat',
        source_title: conversationTitle ? `对话：${conversationTitle}` : 'AI 对话沉淀',
      });
      setSaved(true);
      onSaved(true);
    } catch {
      onSaved(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] min-w-0 px-4 py-2.5 rounded-[2px] text-sm leading-relaxed ${
          msg.role === 'user'
            ? 'bg-accent text-white rounded-br-md'
            : 'bg-bg-secondary border border-border-color text-text-primary rounded-bl-md shadow-sm'
        }`}
      >
        <div className="whitespace-pre-wrap break-keep">{msg.content}</div>
        {msg.role === 'assistant' && refs.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-light space-y-1">
            {refs.map((r, i) => (
              <div key={r.id || i} className="text-[11px] text-text-secondary truncate">
                [{i + 1}] {r.title}
              </div>
            ))}
          </div>
        )}
        <div className={`flex items-center gap-2 text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-white/60' : 'text-text-secondary'}`}>
          <span>{formatTime(msg.created_at)}</span>
          {msg.role === 'assistant' && msg.model && (
            <span className="opacity-70">· {modelName}</span>
          )}
          {msg.role === 'assistant' && (
            <button
              onClick={handleSaveToKnowledge}
              disabled={saving || saved}
              className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] transition-colors ${
                saved
                  ? 'text-success'
                  : 'text-text-muted hover:text-accent hover:bg-accent/10'
              }`}
              title="存为知识单元"
            >
              <BookMarked size={11} />
              {saved ? '已存' : saving ? '存入中…' : '存为知识单元'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ChatHistoryPage: FC = () => {
  const queryClient = useQueryClient();
  const { conversations, isLoading } = useChatConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { conversation, messages } = useChatConversationDetail(selectedId);
  const createMutation = useCreateConversation();
  const renameMutation = useRenameConversation();
  const deleteMutation = useDeleteConversation();
  const { setActiveConversationId, setPanelOpen } = useChat();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2500);
  };

  const handleNewConversation = async () => {
    const res = await createMutation.mutateAsync(undefined);
    setSelectedId(res.data.id);
  };

  const handleRename = (id: string) => {
    const title = editTitle.trim();
    if (title) {
      renameMutation.mutate({ id, title });
    }
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(null);
      },
    });
  };

  // 把该会话设为活动会话并唤起全局 ChatInputBar 接着聊
  const handleContinue = () => {
    if (!selectedId) return;
    setActiveConversationId(selectedId);
    setPanelOpen(true);
  };

  return (
    <div className="h-full flex flex-col p-6 gap-4">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <MessageSquare size={20} className="text-accent" />
            对话历史
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">问出来的答案都沉淀在这里，可继续聊、可存成知识</p>
        </div>
        <button
          onClick={handleNewConversation}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] bg-accent text-white text-xs hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Plus size={14} />
          新对话
        </button>
      </div>

      {toast && (
        <div className="fixed top-4 right-4 z-[60] px-4 py-2.5 rounded-[2px] bg-bg-secondary border border-border-color text-sm text-text-primary shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-4">
        {/* 左：会话列表 */}
        <div className="w-72 shrink-0 glass rounded-[2px] border border-border-color overflow-y-auto">
          {isLoading && (
            <div className="p-4 text-xs text-text-muted">加载中…</div>
          )}
          {!isLoading && conversations.length === 0 && (
            <div className="p-6 text-center text-xs text-text-muted">
              还没有对话记录<br />在右下角输入框提问即会自动沉淀
            </div>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => setSelectedId(conv.id)}
              className={`group px-3 py-2.5 border-b border-border-light cursor-pointer transition-colors ${
                selectedId === conv.id ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-bg-hover'
              }`}
            >
              {editingId === conv.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(conv.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 min-w-0 bg-bg-secondary border border-border-color rounded-[2px] px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-info/60"
                  />
                  <button onClick={() => handleRename(conv.id)} className="p-1 text-success hover:bg-bg-hover rounded-[2px]">
                    <Check size={12} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1 text-text-muted hover:bg-bg-hover rounded-[2px]">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <span className="flex-1 min-w-0 text-xs font-medium text-text-primary truncate">
                      {conv.title || '未命名对话'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(conv.id);
                        setEditTitle(conv.title || '');
                      }}
                      className="p-1 rounded-[2px] text-text-muted hover:text-text-primary hover:bg-bg-hover opacity-0 group-hover:opacity-100 transition-opacity"
                      title="改名"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(conv.id);
                      }}
                      className="p-1 rounded-[2px] text-text-muted hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除会话"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-muted">
                    <span>{formatTime(conv.updated_at)}</span>
                    <span>· {conv.message_count} 条</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* 右：消息流 */}
        <div className="flex-1 min-w-0 glass rounded-[2px] border border-border-color flex flex-col">
          {!selectedId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-2">
              <MessageCircle size={28} className="opacity-40" />
              <span className="text-xs">选择左侧会话查看内容</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-color shrink-0">
                <span className="text-xs font-semibold text-text-primary truncate">
                  {conversation?.title || '未命名对话'}
                </span>
                <button
                  onClick={handleContinue}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] bg-accent text-white text-xs hover:bg-[var(--accent-hover)] transition-colors"
                >
                  <MessageCircle size={12} />
                  继续对话
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {messages.length === 0 && (
                  <div className="text-center text-xs text-text-muted py-8">这个会话还没有消息</div>
                )}
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    conversationTitle={conversation?.title || ''}
                    onSaved={(ok) => {
                      showToast(ok ? '已存为知识单元' : '保存失败，请重试');
                      if (ok) queryClient.invalidateQueries({ queryKey: ['knowledge'] });
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatHistoryPage;
