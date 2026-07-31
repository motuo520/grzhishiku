import { FC, useState, useRef, useCallback, useEffect } from 'react';
import { llmBase } from '@/api/unifiedSync';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, BookOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNavigation } from '@/store/navigation';
import { useSettings } from '@/store/settings';
import { apiClient } from '@/api/client';
import { getBackendModelId } from '@/config/llmModels';
import ChatInputBar from './ChatInputBar';

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  model?: string;
  timestamp: Date;
  isStreaming?: boolean;
  sources?: Array<{ id: string; title: string; preview: string; source_type: string; content_type?: string }>;
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChatPanel: FC<ChatPanelProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const { defaultLLM, ollamaModel } = useSettings();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentModel, setCurrentModel] = useState(() => getBackendModelId(defaultLLM, ollamaModel));
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentModel(getBackendModelId(defaultLLM, ollamaModel));
  }, [defaultLLM, ollamaModel]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async () => {
    if (!message.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setMessage('');
    setIsStreaming(true);

    const aiMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: aiMsgId, role: 'ai', content: '', timestamp: new Date(), isStreaming: true },
    ]);

    try {
      const token = apiClient.getToken();
      const response = await fetch(`${llmBase()}/llm/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          message: userMsg.content,
          brain_side: brainSide,
          preferred_model: currentModel,
          history: messages
            .filter((m) => m.content.trim() && !m.isStreaming)
            .map((m) => ({
              role: m.role === 'ai' ? 'assistant' : m.role,
              content: m.content,
            })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData?.error?.message || errorData?.detail || `HTTP ${response.status}`;
        if (response.status === 402) {
          window.dispatchEvent(
            new CustomEvent('psb:llm:insufficient-balance', {
              detail: { message: errMsg, url: '/topup' },
            })
          );
        }
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (reader) {
        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await reader.read();
          streamDone = done;
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'chunk' && data.content) {
                  fullContent += data.content;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === aiMsgId ? { ...m, content: fullContent, isStreaming: true } : m
                    )
                  );
                }
                if (data.type === 'sources' && Array.isArray(data.sources)) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === aiMsgId ? { ...m, sources: data.sources } : m
                    )
                  );
                }
                if (data.type === 'error' && data.message) {
                  throw new Error(data.message);
                }
              } catch (e) {
                if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
                  throw e;
                }
                // ignore parse errors for incomplete JSON
              }
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, content: fullContent, isStreaming: false, model: currentModel } : m))
      );
    } catch (error: any) {
      const errMsg = error?.message || '未知错误';
      let displayMsg = '抱歉，连接出现问题。';
      
      if (errMsg.includes('401') || errMsg.includes('Not authenticated') || errMsg.includes('Invalid token')) {
        displayMsg = '请先登录后再使用 AI 助手。';
      } else if (errMsg.includes('404') || errMsg.includes('Not Found')) {
        displayMsg = 'LLM 服务接口未找到，请检查后端是否已更新。';
      } else if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
        displayMsg = '网络连接失败，请检查后端服务是否已启动。';
      } else {
        displayMsg = `服务错误: ${errMsg}`;
      }
      
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? { ...m, content: displayMsg, isStreaming: false, model: currentModel }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const brainColor =
    brainSide === 'personal'
      ? 'border-personal-primary'
      : brainSide === 'network'
      ? 'border-network-primary'
      : 'border-fusion-primary';

  const brainLabel = brainSide === 'personal' ? '个人脑' : brainSide === 'network' ? '网络脑' : '双脑';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%', opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.8 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className={`fixed right-0 top-0 bottom-0 w-[520px] max-w-[95vw] bg-bg-secondary border-l ${brainColor} border-l-2 z-50 flex flex-col`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-color">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-[2px] ${brainColor.replace('border-', 'bg-')}/10 flex items-center justify-center`}>
                  <Sparkles className="w-4 h-4 text-text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-text-primary">AI 助手</div>
                  <div className="text-xs text-text-muted">当前模式：{brainLabel}</div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-[2px] hover:bg-bg-tertiary text-text-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-text-muted">
                  <Sparkles className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">AI 助手已就绪</p>
                  <p className="text-xs mt-1">输入消息开始对话</p>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] px-3.5 py-2.5 rounded-[2px] text-sm ${
                      msg.role === 'user'
                        ? 'bg-info text-white rounded-br-md'
                        : 'bg-bg-tertiary text-text-primary rounded-bl-md border border-border-color'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                    {msg.isStreaming && (
                      <span className="inline-block w-1.5 h-3 bg-info animate-pulse ml-1" />
                    )}
                    {msg.role === 'ai' && msg.sources && msg.sources.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-border-color/60">
                        <div className="text-[10px] text-text-muted mb-1.5 flex items-center gap-1">
                          <BookOpen className="w-3 h-3" />
                          引用来源
                        </div>
                        <div className="space-y-1.5">
                          {msg.sources.map((src, idx) => (
                            <button
                              key={src.id}
                              onClick={() => navigate(`/knowledge/${src.id}`)}
                              type="button"
                              className="w-full text-left px-2 py-1.5 rounded-[2px] bg-bg-primary/60 hover:bg-bg-primary border border-border-color/40 hover:border-accent/40 transition-colors group"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-medium text-accent min-w-[16px]">[{idx + 1}]</span>
                                <span className="text-xs font-medium text-text-primary truncate flex-1">{src.title}</span>
                                {src.content_type && (
                                  <span className="text-[10px] text-text-muted shrink-0">{src.content_type}</span>
                                )}
                              </div>
                              <div className="text-[10px] text-text-secondary line-clamp-1 mt-0.5 pl-[22px]">
                                {src.preview}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div
                      className={`flex items-center gap-1.5 text-[10px] mt-1 ${
                        msg.role === 'user' ? 'text-white/60' : 'text-text-muted'
                      }`}
                    >
                      <span>{msg.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                      {msg.role === 'ai' && msg.model && (
                        <span className="px-1 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-[10px] text-text-muted">
                          {msg.model}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <ChatInputBar
              message={message}
              onMessageChange={setMessage}
              onSend={handleSend}
              onStop={() => setIsStreaming(false)}
              isStreaming={isStreaming}
              disabled={isStreaming}
              brainLabel={brainLabel}
              messages={messages}
              preferredModel={currentModel}
              onPreferredModelChange={setCurrentModel}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ChatPanel;
