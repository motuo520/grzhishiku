import { FC, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Lock, Unlock, Calendar, Clock, MessageCircle, Sparkles,
  Send, Shield, Download, Tag, Globe, Users, EyeOff, CheckCircle, XCircle,
  AlertCircle, Zap, Trash2
} from 'lucide-react';
import { useCapsules, useCapsuleDialogue } from '@/hooks/useCapsules';
import type { CapsuleDialogueMessage } from '@/api/capsules';
import ModelSelector from '@/components/llm/ModelSelector';
import LLMCostBadge from '@/components/llm/LLMCostBadge';

const MOOD_TAG_MAP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  happy: { label: '开心', color: '#3fb950', bg: 'rgba(63,185,80,0.12)', border: 'rgba(63,185,80,0.3)' },
  calm: { label: '平静', color: '#58a6ff', bg: 'rgba(88,166,255,0.12)', border: 'rgba(88,166,255,0.3)' },
  anxious: { label: '焦虑', color: '#d29922', bg: 'rgba(210,153,34,0.12)', border: 'rgba(210,153,34,0.3)' },
  excited: { label: '兴奋', color: '#f778ba', bg: 'rgba(247,120,186,0.12)', border: 'rgba(247,120,186,0.3)' },
  nostalgic: { label: '怀旧', color: '#a371f7', bg: 'rgba(163,113,247,0.12)', border: 'rgba(163,113,247,0.3)' },
  grateful: { label: '感恩', color: '#d29922', bg: 'rgba(210,153,34,0.12)', border: 'rgba(210,153,34,0.3)' },
  confused: { label: '困惑', color: '#8b949e', bg: 'rgba(139,148,158,0.12)', border: 'rgba(139,148,158,0.3)' },
  expectant: { label: '期待', color: '#39c5cf', bg: 'rgba(57,197,207,0.12)', border: 'rgba(57,197,207,0.3)' },
};

const PRIVACY_MAP: Record<string, { label: string; icon: any; color: string }> = {
  public: { label: '公开', icon: Globe, color: '#3fb950' },
  shared: { label: '共享', icon: Users, color: '#58a6ff' },
  private: { label: '私密', icon: EyeOff, color: '#a371f7' },
};

const CountdownTimer: FC<{ targetDate: string; isUnlocked: boolean }> = ({ targetDate, isUnlocked }) => {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    if (isUnlocked) return;
    const interval = setInterval(() => {
      const now = new Date().getTime();
      const target = new Date(targetDate).getTime();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        clearInterval(interval);
      } else {
        setTimeLeft({
          days: Math.floor(diff / (1000 * 60 * 60 * 24)),
          hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((diff % (1000 * 60)) / 1000),
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate, isUnlocked]);

  if (isUnlocked) {
    return (
      <div className="p-6 flex items-center gap-2 text-success">
        <Unlock className="w-5 h-5" />
        <span className="text-sm font-medium">已解锁</span>
      </div>
    );
  }

  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    <div className="flex items-center gap-3">
      <Lock className="w-5 h-5 text-warning" />
      <div className="flex items-center gap-1">
        <div className="bg-bg-tertiary border border-border-color rounded-lg px-2 py-1 text-center min-w-[48px]">
          <div className="text-lg font-bold text-text-primary">{pad(timeLeft.days)}</div>
          <div className="text-[10px] text-text-muted">天</div>
        </div>
        <span className="text-text-muted font-bold">:</span>
        <div className="bg-bg-tertiary border border-border-color rounded-lg px-2 py-1 text-center min-w-[48px]">
          <div className="text-lg font-bold text-text-primary">{pad(timeLeft.hours)}</div>
          <div className="text-[10px] text-text-muted">时</div>
        </div>
        <span className="text-text-muted font-bold">:</span>
        <div className="bg-bg-tertiary border border-border-color rounded-lg px-2 py-1 text-center min-w-[48px]">
          <div className="text-lg font-bold text-text-primary">{pad(timeLeft.minutes)}</div>
          <div className="text-[10px] text-text-muted">分</div>
        </div>
        <span className="text-text-muted font-bold">:</span>
        <div className="bg-bg-tertiary border border-border-color rounded-lg px-2 py-1 text-center min-w-[48px]">
          <div className="text-lg font-bold text-text-primary">{pad(timeLeft.seconds)}</div>
          <div className="text-[10px] text-text-muted">秒</div>
        </div>
      </div>
    </div>
  );
};

const CapsuleDetail: FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { capsules, isLoading, unlockCapsule, isUnlocking, deleteCapsule } = useCapsules();
  const { dialogue: historyData, sendMessage, isSending } = useCapsuleDialogue(id);
  const [message, setMessage] = useState('');
  const [dialogue, setDialogue] = useState<CapsuleDialogueMessage[]>([]);
  const [isDialogueOpen, setIsDialogueOpen] = useState(false);
  const [error, setError] = useState('');
  const [dialogueError, setDialogueError] = useState('');
  const [modelId, setModelId] = useState('');

  const capsule = useMemo(() => capsules?.find((c) => c.id === id), [capsules, id]);

  // Load persisted dialogue history once it arrives
  useEffect(() => {
    if (historyData?.messages) setDialogue(historyData.messages);
  }, [historyData]);

  const parseUnlockConfig = useCallback(() => {
    if (!capsule?.unlock_config) return {};
    try {
      return JSON.parse(capsule.unlock_config);
    } catch { return {}; }
  }, [capsule?.unlock_config]);

  const parseMoodTags = useCallback(() => {
    if (!capsule?.mood_tags) return [];
    try {
      const parsed = JSON.parse(capsule.mood_tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }, [capsule?.mood_tags]);

  const unlockConfig = useMemo(() => parseUnlockConfig(), [parseUnlockConfig]);
  const moodTags = useMemo(() => parseMoodTags(), [parseMoodTags]);

  const isLocked = !capsule || capsule.unlock_status === 'locked';

  const unlockConditions = useMemo(() => {
    const conditions = [];
    if (unlockConfig.unlock_date) {
      const target = new Date(unlockConfig.unlock_date);
      const met = target <= new Date();
      conditions.push({ label: `时间到达 ${target.toLocaleString('zh-CN')}`, met });
    }
    if (unlockConfig.event) {
      conditions.push({ label: `事件: ${unlockConfig.event}`, met: false }); // manual check
    }
    if (unlockConfig.condition) {
      conditions.push({ label: `自定义: ${unlockConfig.condition}`, met: false });
    }
    return conditions;
  }, [unlockConfig]);

  const handleUnlock = async () => {
    if (!id) return;
    try {
      setError('');
      await unlockCapsule(id);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '解锁失败，条件未满足');
    }
  };

  const handleSendMessage = async () => {
    if (!id || !message.trim() || isLocked || isSending) return;
    const userMessage = message.trim();
    setDialogueError('');
    setDialogue((prev) => [...prev, { role: 'user', content: userMessage, timestamp: new Date().toISOString(), is_cross_time: true }]);
    setMessage('');
    try {
      const response = await sendMessage({ message: userMessage, preferred_model: modelId || undefined });
      const msgs = response.data.messages || [];
      setDialogue(msgs);
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      setDialogueError(status === 402 ? (detail || '余额不足，请先充值') : (detail || '发送失败，请稍后重试'));
    }
  };

  const handleDelete = async () => {
    if (!id || !window.confirm('确定删除这个时间胶囊吗？删除后不可恢复。')) return;
    try {
      await deleteCapsule(id);
      navigate('/capsules/my');
    } catch {
      setError('删除失败，请稍后重试');
    }
  };

  const privacyInfo = capsule ? PRIVACY_MAP[capsule.privacy_level] || PRIVACY_MAP.private : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-info border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!capsule) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <p className="text-text-secondary">胶囊未找到</p>
        <button onClick={() => navigate('/capsules')} className="btn-primary mt-4">
          返回列表
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={() => navigate('/capsules')}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回列表
      </button>

      {/* Capsule Header */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isLocked ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
            }`}>
              {isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">
                {isLocked ? '已封存' : '已解锁'}
              </div>
              <div className="text-xs text-text-muted">
                创建于 {new Date(capsule.created_at).toLocaleDateString('zh-CN')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {privacyInfo && (
              <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs border" style={{ color: privacyInfo.color, borderColor: privacyInfo.color + '30', backgroundColor: privacyInfo.color + '10' }}>
                <privacyInfo.icon className="w-3 h-3" />
                {privacyInfo.label}
              </span>
            )}
            {capsule.privacy_allow_export && (
              <button className="p-2 rounded-lg hover:bg-white/[0.05] text-text-secondary transition-colors" title="导出">
                <Download className="w-4 h-4" />
              </button>
            )}
            {capsule.privacy_require_auth && (
              <div className="p-2 text-text-secondary" title="需要验证">
                <Shield className="w-4 h-4" />
              </div>
            )}
            <button
              onClick={handleDelete}
              className="p-2 rounded-lg hover:bg-danger/10 text-text-secondary hover:text-danger transition-colors"
              title="删除胶囊"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mood Tags */}
        {moodTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {moodTags.map((tag: string) => {
              const info = MOOD_TAG_MAP[tag];
              return info ? (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border" style={{ color: info.color, borderColor: info.border, backgroundColor: info.bg }}>
                  <Tag className="w-3 h-3" />
                  {info.label}
                </span>
              ) : (
                <span key={tag} className="inline-flex items-center px-2 py-1 rounded-md text-xs border border-white/[0.08] bg-white/[0.03] text-text-muted">
                  {tag}
                </span>
              );
            })}
          </div>
        )}

        {/* Content */}
        <div className="bg-white/[0.02] rounded-xl p-4 mb-4 border border-white/[0.06]">
          <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{capsule.content_body}</p>
        </div>

        {/* Meta Info */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {capsule.unlock_type === 'temporal' ? '时间解锁' : '事件解锁'}
          </span>
          {capsule.mood_emotion && (
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              {capsule.mood_emotion} ({capsule.mood_intensity}/10)
            </span>
          )}
        </div>
      </div>

      {/* Unlock Countdown & Conditions */}
      <div className="card mb-6">
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-info" />
          解锁状态
        </h3>
        <div className="mb-4">
          {capsule.unlock_type === 'temporal' ? (
            unlockConfig.unlock_date ? (
              <CountdownTimer targetDate={unlockConfig.unlock_date} isUnlocked={!isLocked} />
            ) : (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Lock className="w-4 h-4 text-warning" />
                未设置解锁时间
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              {isLocked ? <Lock className="w-4 h-4 text-warning" /> : <Unlock className="w-4 h-4 text-success" />}
              {isLocked ? '条件达成后由你手动确认解锁' : '已解锁'}
            </div>
          )}
        </div>
        {unlockConditions.length > 0 && (
          <div className="space-y-2">
            {unlockConditions.map((cond, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {cond.met ? (
                  <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-text-muted flex-shrink-0" />
                )}
                <span className={cond.met ? 'text-success' : 'text-text-muted'}>{cond.label}</span>
              </div>
            ))}
          </div>
        )}
        {isLocked && (
          <button
            onClick={handleUnlock}
            disabled={isUnlocking}
            className="mt-4 w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isUnlocking ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Unlock className="w-4 h-4" />
            )}
            {capsule.unlock_type === 'temporal' ? '尝试解锁' : '确认条件已达成，解锁'}
          </button>
        )}
        {error && (
          <div className="mt-3 p-2 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}
      </div>

      {/* Cross-time Dialogue */}
      {!isLocked && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-fusion-primary" />
              <h3 className="text-lg font-semibold text-text-primary">跨时空对话</h3>
            </div>
            <button
              onClick={() => setIsDialogueOpen(!isDialogueOpen)}
              className="text-sm text-info hover:text-network-secondary transition-colors"
            >
              {isDialogueOpen ? '收起' : '展开'}
            </button>
          </div>

          <AnimatePresence>
            {isDialogueOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                {/* Cross-time hint */}
                <div className="mb-4 p-3 rounded-lg bg-fusion-primary/5 border border-fusion-primary/20 flex items-start gap-2">
                  <Zap className="w-4 h-4 text-fusion-primary flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-text-secondary">
                    这是与过去的自己对话的珍贵时刻。你可以向过去的自己提问，分享现在的感悟。
                  </p>
                </div>

                {/* Dialogue Messages */}
                <div className="space-y-4 mb-4 max-h-96 overflow-y-auto px-1">
                  {dialogue.length === 0 && (
                    <div className="text-center py-8 text-text-muted text-sm">
                      <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      开启与过去自己的对话
                    </div>
                  )}
                  {dialogue.map((msg, index) => (
                    <div
                      key={index}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[80%] ${msg.role === 'user' ? 'mr-1' : 'ml-1'}`}>
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-sm ${
                            msg.role === 'user'
                              ? 'bg-info text-white rounded-br-md'
                              : 'bg-white/[0.03] text-text-primary rounded-bl-md border border-white/[0.08]'
                          }`}
                        >
                          {msg.content}
                        </div>
                        <div className={`text-[10px] text-text-muted mt-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                          {msg.is_cross_time && (
                            <span className="inline-flex items-center gap-1 mr-1">
                              <Zap className="w-3 h-3 text-fusion-primary" />
                              跨时空
                            </span>
                          )}
                          {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                  {isSending && (
                    <div className="flex justify-start">
                      <div className="ml-1 px-4 py-2.5 rounded-2xl rounded-bl-md bg-white/[0.03] border border-white/[0.08] text-sm text-text-muted flex items-center gap-2">
                        <div className="w-3.5 h-3.5 border-2 border-info border-t-transparent rounded-full animate-spin" />
                        过去的自己正在回忆…
                      </div>
                    </div>
                  )}
                </div>

                {dialogueError && (
                  <div className="mb-3 p-2.5 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{dialogueError}</span>
                    {dialogueError.includes('余额不足') && (
                      <a href="/topup" className="underline ml-1 hover:opacity-80">去充值</a>
                    )}
                  </div>
                )}

                {/* Model selector & cost */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <ModelSelector
                    value={modelId}
                    onChange={setModelId}
                    taskType="chat"
                    className="w-56"
                  />
                  <LLMCostBadge
                    modelId={modelId}
                    inputText={message}
                    outputTokenEstimate={200}
                  />
                </div>

                {/* Input */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="对过去的自己说点什么..."
                    className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-info/50 transition-colors text-text-primary placeholder-text-muted"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!message.trim() || isSending}
                    className="p-2.5 bg-info rounded-xl hover:bg-network-secondary transition-colors disabled:opacity-50"
                  >
                    <Send className="w-4 h-4 text-white" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default CapsuleDetail;
