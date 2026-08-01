import { FC, ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@/store/navigation';
import { useSettings } from '@/store/settings';
import { useBrain } from '@/hooks/useBrain';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import apiClientInstance, { apiClient } from '@/api/client';
import { BrainSide } from '@/types';
import { LLM_MODEL_MAP, getBackendModelId, getModelIdByProviderModel } from '@/config/llmModels';
import LLMConnectionStatus from '@/components/llm/LLMConnectionStatus';
import ModelSelector from '@/components/llm/ModelSelector';
import {
  Brain, Globe,
  Download, Send, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, FileJson, FileText, Trash2, X,
  Home, LogIn
} from 'lucide-react';


interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  model?: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface ChatInputBarProps {
  sidebarOpen?: boolean;
  onLoginClick?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ChatInputBar: FC<ChatInputBarProps> = ({ sidebarOpen = true, onLoginClick }) => {
  const { brainSide } = useNavigation();
  const {
    defaultLLM,
    activeProvider,
    activeModel,
    setActiveProvider,
    ollamaModel,
  } = useSettings();
  const { activeBrain, switchBrain } = useBrain();
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [currentModel, setCurrentModel] = useState(
    getModelIdByProviderModel(activeProvider, activeModel) || defaultLLM
  );
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showBrainSwitcher, setShowBrainSwitcher] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem('chatInputBarCollapsed') === 'true';
    } catch {
      return false;
    }
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);

  const effectiveBrain = activeBrain || brainSide || 'both';
  const brainLabel = effectiveBrain === 'personal' ? '个人脑' : effectiveBrain === 'network' ? '网络脑' : '双脑融合';
  const BrainIcon = effectiveBrain === 'personal' ? Home : effectiveBrain === 'network' ? Globe : Brain;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const derived = getModelIdByProviderModel(activeProvider, activeModel) || defaultLLM;
    setCurrentModel(derived);
  }, [activeProvider, activeModel, defaultLLM]);

  useEffect(() => {
    try {
      localStorage.setItem('chatInputBarCollapsed', String(isCollapsed));
    } catch {
      // ignore
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleOpenChat = () => setShowChatPanel(true);
    window.addEventListener('psb:chat:open', handleOpenChat);
    return () => window.removeEventListener('psb:chat:open', handleOpenChat);
  }, []);



  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSend = async () => {
    if (!message.trim() && attachments.length === 0) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setMessage('');
    setIsStreaming(true);
    setShowChatPanel(true);

    const aiMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: aiMsgId, role: 'ai', content: '', model: currentModel, timestamp: new Date(), isStreaming: true }]);

    try {
      const token = apiClient.getToken();
      const response = await fetch('/api/v1/llm/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          message: userMsg.content,
          brain_side: effectiveBrain,
          history: messages
            .filter((m) => m.content.trim() && !m.isStreaming)
            .map((m) => ({
              role: m.role === 'ai' ? 'assistant' : m.role,
              content: m.content,
            })),
          preferred_model: getBackendModelId(currentModel, ollamaModel),
          brain_style: effectiveBrain === 'personal' ? 'warm_personal' : effectiveBrain === 'network' ? 'objective_network' : 'balanced',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
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
              } catch {
                // ignore parse errors
              }
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, content: fullContent, isStreaming: false } : m))
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
            ? { ...m, content: displayMsg, isStreaming: false }
            : m
        )
      );
      showToast(displayMsg, 'error');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 语音输入：Web Speech API 语音识别（中文），仅支持 Chrome / Edge；
  // Chrome 依赖 Google 语音服务，国内不可用，国内用户应使用 Edge（走微软服务）
  const handleVoiceToggle = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      showToast('语音输入仅支持 Chrome / Edge 浏览器', 'error');
      return;
    }

    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      if (finalText) {
        setMessage((prev) => (prev ? prev.trimEnd() + ' ' : '') + finalText.trim());
      }
    };
    rec.onerror = (e: any) => {
      setIsRecording(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        showToast('麦克风权限被拒绝，请在系统/浏览器中授权', 'error');
      } else if (e.error === 'network') {
        showToast('语音识别服务不可用：Chrome 需访问 Google 服务，国内用户请改用 Edge 浏览器', 'error');
      } else if (e.error !== 'aborted') {
        showToast(`语音识别失败：${e.error}`, 'error');
      }
    };
    rec.onend = () => setIsRecording(false);

    recognitionRef.current = rec;
    try {
      rec.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
      showToast('无法启动语音识别', 'error');
    }
  };

  // 卸载时停止识别
  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  const handleAttachment = (type: string) => {
    setAttachments((prev) => [...prev, type]);
    setShowAttachmentMenu(false);
  };

  const handleExport = (format: 'json' | 'markdown') => {
    if (messages.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'json') {
      const data = {
        exportedAt: new Date().toISOString(),
        model: currentModel,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          model: m.model,
          timestamp: m.timestamp.toISOString(),
        })),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${timestamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('对话已导出为 JSON', 'success');
    } else {
      let md = `# 对话记录\n\n**导出时间**: ${new Date().toLocaleString('zh-CN')}\n**使用模型**: ${LLM_MODEL_MAP[currentModel]?.name || currentModel}\n\n---\n\n`;
      messages.forEach((m) => {
        md += m.role === 'user' ? `**用户**: ${m.content}\n\n` : `**AI** (${m.model || '未知'}): ${m.content}\n\n`;
      });
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${timestamp}.md`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('对话已导出为 Markdown', 'success');
    }
  };

  const modelInfo = LLM_MODEL_MAP[currentModel];

  const handleModelChange = async (modelId: string) => {
    setCurrentModel(modelId);
    if (!isLoggedIn) {
      onLoginClick?.();
      return;
    }
    const config = LLM_MODEL_MAP[modelId];
    if (config) {
      await setActiveProvider(config.provider, config.model);
    } else if (modelId.startsWith('ollama-')) {
      await setActiveProvider('ollama', modelId.replace('ollama-', ''));
    }
    queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
  };

  const renderModelRow = () => (
    <div className="px-4 pt-2 pb-1 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <ModelSelector
          value={currentModel}
          onChange={handleModelChange}
          taskType="chat"
          className="w-56"
          disabled={isStreaming}
        />
      </div>
      {/* Model capability tags */}
      {modelInfo && (
        <div className="hidden sm:flex items-center gap-1.5 overflow-hidden mt-2">
          {modelInfo.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-secondary border border-border-color whitespace-nowrap">
              {tag}
            </span>
          ))}
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-secondary border border-border-color whitespace-nowrap">
            上下文 {modelInfo.context}
          </span>
        </div>
      )}
    </div>
  );

  const renderInputRow = (prefix?: ReactNode) => (
    <div className="flex items-center gap-2 sm:gap-3 px-4 py-3 max-w-4xl mx-auto relative">
      {prefix}

      {/* Brain Indicator with Quick Switch */}
      <div className="relative shrink-0">
        <button
          onClick={() => setShowBrainSwitcher(!showBrainSwitcher)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[2px] text-xs font-medium border transition-all hover:bg-bg-hover ${
            effectiveBrain === 'personal' ? 'bg-personal-primary/10 text-personal-primary border-personal-primary/30 hover:border-personal-primary/50' :
            effectiveBrain === 'network' ? 'bg-network-primary/10 text-network-primary border-network-primary/30 hover:border-network-primary/50' :
            'bg-fusion-primary/10 text-fusion-primary border-fusion-primary/30 hover:border-fusion-primary/50'
          }`}
          title={`当前: ${brainLabel} (点击切换)`}
        >
          <BrainIcon size={14} />
          <span className="hidden sm:inline">{brainLabel}</span>
        </button>

        <AnimatePresence>
          {showBrainSwitcher && (
            <motion.div
              initial={{ opacity: 0, y: 5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 5, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-2 w-40 glass rounded-[2px] border border-border-color py-1 z-50"
            >
              {[
                { id: 'personal', label: '个人脑', icon: Home, color: 'text-personal-primary', bg: 'hover:bg-personal-primary/10' },
                { id: 'network', label: '网络脑', icon: Globe, color: 'text-network-primary', bg: 'hover:bg-network-primary/10' },
                { id: 'both', label: '双脑融合', icon: Brain, color: 'text-fusion-primary', bg: 'hover:bg-fusion-primary/10' },
              ].map((b) => {
                const Icon = b.icon;
                const isActive = effectiveBrain === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={() => {
                      switchBrain(b.id as BrainSide);
                      setShowBrainSwitcher(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      isActive ? `${b.bg} ${b.color} bg-bg-secondary` : 'text-text-primary hover:bg-bg-hover'
                    }`}
                  >
                    <Icon size={14} className={isActive ? b.color : 'text-text-secondary'} />
                    <span className="text-xs">{b.label}</span>
                    {isActive && <div className={`ml-auto w-1.5 h-1.5 rounded-full ${b.color.replace('text-', 'bg-')}`} />}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Voice */}
      <button onClick={handleVoiceToggle} className={`shrink-0 p-2.5 rounded-[2px] transition-all ${isRecording ? 'bg-danger/10 text-danger animate-pulse' : 'hover:bg-bg-hover text-text-secondary hover:text-danger'}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>

      <AnimatePresence>
        {isRecording && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="absolute left-10 bottom-full mb-2 px-3 py-1.5 bg-danger/10 border border-danger/30 rounded-[2px] text-xs text-danger">
            正在录音... <span className="animate-pulse">●</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <div className="flex-1 relative">
        {isLoggedIn ? (
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`与 ${effectiveBrain === 'personal' ? '个人脑' : effectiveBrain === 'network' ? '网络脑' : '双脑'} 对话...`}
            className="w-full bg-bg-secondary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/60 focus:bg-bg-secondary transition-all shadow-inner"
            disabled={isStreaming}
          />
        ) : (
          <button
            onClick={() => onLoginClick ? onLoginClick() : navigate('/welcome')}
            className="w-full bg-bg-secondary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-secondary text-left hover:border-info/30 hover:text-text-primary transition-colors flex items-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            请登录后使用 AI 对话
          </button>
        )}
      </div>

      {/* Attachment */}
      <div className="relative shrink-0">
        <button onClick={() => setShowAttachmentMenu(!showAttachmentMenu)} className="p-2.5 rounded-[2px] hover:bg-bg-tertiary text-text-secondary transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <AnimatePresence>
          {showAttachmentMenu && (
            <motion.div initial={{ opacity: 0, y: 5, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 5, scale: 0.95 }} className="absolute bottom-full right-0 mb-2 w-48 glass rounded-[2px] border border-border-color py-2 z-50">
              {['文件', '图片', '链接', '笔记'].map((label) => (
                <button key={label} onClick={() => handleAttachment(label)} className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors">{label}</button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Send / Stop */}
      <button
        onClick={isStreaming ? () => { abortControllerRef.current?.abort(); setIsStreaming(false); } : handleSend}
        disabled={!isLoggedIn || (!isStreaming && !message.trim() && attachments.length === 0)}
        className={`shrink-0 p-2.5 rounded-[2px] transition-all shadow-sm ${
          isStreaming ? 'bg-danger hover:bg-danger/80 text-white shadow-danger/20' :
          !isLoggedIn ? 'bg-bg-tertiary text-text-secondary cursor-not-allowed' :
          message.trim() || attachments.length > 0 ? 'bg-accent hover:bg-[var(--accent-hover)] text-white shadow-info/20' : 'bg-bg-tertiary text-text-secondary cursor-not-allowed'
        }`}
      >
        {isStreaming ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        ) : (
          <Send size={20} />
        )}
      </button>
    </div>
  );


  return (
    <footer
      className={`relative flex-shrink-0 z-[45] transition-all duration-200 ${
        showChatPanel
          ? 'bg-transparent border-transparent shadow-none'
          : 'bg-bg-secondary/80 border-t border-border-color rounded-t-[2px]'
      }`}
    >
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-[2px] border ${
              toast.type === 'success'
                ? 'bg-success/20 border-success/30 text-success'
                : 'bg-danger/20 border-danger/30 text-danger'
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span className="text-sm">{toast.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Chat Panel */}
      <AnimatePresence>
        {showChatPanel && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setShowChatPanel(false)}
            />
            {/* Popup container */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex justify-center items-center p-4 pointer-events-none"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowChatPanel(false);
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="w-11/12 sm:w-2/3 max-w-5xl h-auto max-h-[70vh] glass-strong border border-border-color rounded-[2px] overflow-hidden flex flex-col pointer-events-auto"
              >
              {/* Panel Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-color bg-black/30 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xs font-semibold text-text-primary">AI 助手</span>
                  <span className="text-[10px] text-text-secondary truncate">{modelInfo?.name || currentModel}</span>
                  <div className="hidden sm:flex items-center gap-1">
                    {modelInfo?.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-bg-secondary text-text-secondary border border-border-color">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  {/* Export */}
                  <div className="relative group">
                    <button
                      className="p-1.5 rounded-[2px] hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
                      title="导出对话"
                    >
                      <Download size={14} />
                    </button>
                    <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col gap-1 glass rounded-[2px] border border-border-color p-1 z-50 min-w-[120px]">
                      <button
                        onClick={() => handleExport('json')}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover rounded transition-colors"
                      >
                        <FileJson size={12} />
                        JSON
                      </button>
                      <button
                        onClick={() => handleExport('markdown')}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover rounded transition-colors"
                      >
                        <FileText size={12} />
                        Markdown
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setMessages([])}
                    className="p-1.5 rounded-[2px] hover:bg-bg-tertiary text-text-secondary hover:text-danger transition-colors"
                    title="清空对话"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    onClick={() => setShowChatPanel(false)}
                    className="p-1.5 rounded-[2px] hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
                    title="收起"
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    onClick={() => setShowChatPanel(false)}
                    className="p-1.5 rounded-[2px] hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
                    title="关闭"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 max-h-[45vh]">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[92%] sm:max-w-[85%] min-w-0 px-4 py-2.5 rounded-[2px] text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-accent text-white rounded-br-md'
                          : 'bg-bg-secondary border border-border-color text-text-primary rounded-bl-md shadow-sm'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-keep">{msg.content}</div>
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-3 bg-info animate-pulse ml-1 rounded-sm" />
                      )}
                      <div className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-white/60' : 'text-text-secondary'}`}>
                        {msg.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        {msg.model && msg.role === 'ai' && (
                          <span className="ml-2 opacity-70">· {LLM_MODEL_MAP[msg.model]?.name || msg.model}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Attachments preview */}
              <AnimatePresence>
                {attachments.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="flex gap-2 px-4 py-2 overflow-hidden shrink-0"
                  >
                    {attachments.map((att, i) => (
                      <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 bg-bg-secondary border border-border-color rounded-[2px] text-xs text-text-primary">
                        <span>{att}</span>
                        <button onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))} className="text-text-secondary hover:text-danger leading-none">×</button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {renderModelRow()}
              {renderInputRow()}
            </motion.div>
          </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom bar - hidden when chat panel is open */}
      {!showChatPanel && (
        <>
          {/* Centered expand/collapse toggle */}
          <div className="absolute left-1/2 -top-5 -translate-x-1/2 z-50">
            <button
              onClick={() => setIsCollapsed((prev) => !prev)}
              className="flex items-center justify-center w-10 h-10 rounded-full glass border border-border-color text-text-secondary hover:text-text-primary hover:border-border-color hover:bg-bg-tertiary transition-all"
              title={isCollapsed ? '展开输入栏' : '收起输入栏'}
            >
              <motion.div
                animate={{ rotate: isCollapsed ? 0 : 180 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronUp size={22} />
              </motion.div>
            </button>
          </div>

          {/* Collapsed hint */}
          {isCollapsed && (
            <div className="h-9 flex items-center justify-center">
              <span className="text-xs text-text-secondary">AI 输入栏已收起</span>
            </div>
          )}

          {/* Expandable content */}
          <motion.div
            initial={false}
            animate={{
              height: isCollapsed ? 0 : 'auto',
              opacity: isCollapsed ? 0 : 1,
            }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {/* Attachments preview */}
            <AnimatePresence>
              {attachments.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex gap-2 px-4 pt-2 overflow-hidden max-w-4xl mx-auto"
                >
                  {attachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 bg-bg-secondary border border-border-color rounded-[2px] text-xs text-text-primary">
                      <span>{att}</span>
                      <button onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))} className="text-text-secondary hover:text-danger leading-none">×</button>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {renderModelRow()}
            {renderInputRow(
              messages.length > 0 ? (
                <button
                  onClick={() => setShowChatPanel(true)}
                  className="p-2 rounded-[2px] hover:bg-bg-hover text-text-secondary hover:text-info transition-colors"
                  title="展开对话"
                >
                  <ChevronUp size={18} />
                </button>
              ) : undefined
            )}
          </motion.div>
        </>
      )}

      {/* LLM Connection Console - bottom right, shifted left to avoid mascot overlap */}
      <div className="absolute right-20 bottom-3">
        <LLMConnectionStatus placement="top" onLoginClick={onLoginClick} />
      </div>
    </footer>
  );
};

export default ChatInputBar;
