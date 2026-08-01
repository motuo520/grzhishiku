import { FC, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Send, Lock, Unlock, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { useCapsules, useCapsuleDialogue } from '@/hooks/useCapsules';
import type { CapsuleDialogueMessage } from '@/api/capsules';
import ModelSelector from '@/components/llm/ModelSelector';

const CapsuleDialoguePage: FC = () => {
  const navigate = useNavigate();
  const { capsules, isLoading } = useCapsules('personal');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [localDialogue, setLocalDialogue] = useState<CapsuleDialogueMessage[]>([]);
  const [sendError, setSendError] = useState('');
  const [modelId, setModelId] = useState('');

  const unlockedCapsules = (capsules || []).filter((c) => c.unlock_status !== 'locked');
  const selectedCapsule = unlockedCapsules.find((c) => c.id === selectedId);

  const { dialogue: historyData, sendMessage, isSending } = useCapsuleDialogue(selectedId);

  // Load persisted dialogue history for the selected capsule
  useEffect(() => {
    if (historyData?.messages) setLocalDialogue(historyData.messages);
  }, [historyData]);

  const handleSend = async () => {
    if (!selectedId || !message.trim() || isSending) return;
    const text = message.trim();
    setSendError('');
    setLocalDialogue((prev) => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString(), is_cross_time: true }]);
    setMessage('');
    try {
      const response = await sendMessage({ message: text, preferred_model: modelId || undefined });
      if (response.data.messages) {
        setLocalDialogue(response.data.messages);
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setSendError(detail || '发送失败，请稍后重试');
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-info border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/capsules/my')} className="text-text-secondary hover:text-text-primary">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">时光对话</h1>
          <p className="text-sm text-text-secondary mt-1">选择已解锁胶囊，与过去的自己对话</p>
        </div>
      </div>

      {!selectedId ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {unlockedCapsules.length === 0 ? (
            <div className="card md:col-span-2 lg:col-span-3 flex flex-col items-center justify-center py-16 text-text-secondary">
              <Lock className="w-16 h-16 text-text-muted mb-4" />
              <p>暂无已解锁胶囊</p>
              <button onClick={() => navigate('/capsules/my')} className="btn-primary mt-4">去解锁</button>
            </div>
          ) : (
            unlockedCapsules.map((capsule, index) => (
              <motion.div
                key={capsule.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => { setSelectedId(capsule.id); setLocalDialogue([]); }}
                className="card hover:border-info/30 cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Unlock className="w-4 h-4 text-success" />
                  <span className="text-xs text-success">已解锁</span>
                </div>
                <div className="text-sm text-text-primary line-clamp-3 mb-2">{capsule.content_body}</div>
                <div className="text-xs text-text-muted">{new Date(capsule.created_at).toLocaleDateString('zh-CN')} 封存</div>
              </motion.div>
            ))
          )}
        </div>
      ) : (
        <div className="card min-h-[60vh] flex flex-col">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/[0.06]">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">与过去对话</h3>
              <p className="text-xs text-text-muted line-clamp-1">{selectedCapsule?.content_body}</p>
            </div>
            <button onClick={() => { setSelectedId(undefined); setLocalDialogue([]); }} className="text-xs text-text-muted hover:text-text-primary">
              返回选择
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto max-h-[50vh] pr-2 mb-4">
            <AnimatePresence>
              {localDialogue.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-12 text-text-muted text-sm"
                >
                  <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  发送第一条消息，开启跨时空对话
                </motion.div>
              )}
              {localDialogue.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-info/15 text-info rounded-br-md'
                      : 'bg-white/[0.05] text-text-primary rounded-bl-md'
                  }`}>
                    {msg.content}
                  </div>
                </motion.div>
              ))}
              {isSending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                  <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-white/[0.05] text-sm text-text-muted flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    过去的自己正在回忆…
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {sendError && (
            <div className="mb-3 p-2.5 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{sendError}</span>
            </div>
          )}

          <div className="space-y-3 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center justify-between gap-3">
              <ModelSelector
                value={modelId}
                onChange={setModelId}
                taskType="chat"
                className="w-56"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="对过去的自己说些什么..."
                className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
              />
              <button
                onClick={handleSend}
                disabled={!message.trim() || isSending}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                发送
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CapsuleDialoguePage;
