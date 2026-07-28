import { FC, useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Pause, Play, Square, AlertTriangle, Shield, Settings, List, Calendar, X, Clock, User, Globe,
} from 'lucide-react';
import { useAttention } from '@/hooks/useAttention';

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const INTERRUPTION_REASONS = [
  { key: 'notification', label: '外部通知' },
  { key: 'distraction', label: '内心杂念' },
  { key: 'noise', label: '环境噪音' },
  { key: 'other', label: '其他' },
];

type DeepWorkState = 'idle' | 'running' | 'paused' | 'completed';

const AttentionDeepWorkPage: FC = () => {
  const {
    startDeepWork, pauseDeepWork, resumeDeepWork, endDeepWork, recordInterruption,
    deepWorkSessions, isStartingDeepWork
  } = useAttention();

  const [state, setState] = useState<DeepWorkState>('idle');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [task, setTask] = useState('');
  const [duration, setDuration] = useState(25);
  const [brainSide, setBrainSide] = useState<'personal' | 'network'>('personal');
  const [showInterruption, setShowInterruption] = useState(false);
  const [interruptionReason, setInterruptionReason] = useState('other');
  const [whitelist, setWhitelist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('deepWorkWhitelist') || '[]'); } catch { return []; }
  });
  const [whitelistInput, setWhitelistInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState('');

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const handleStart = async () => {
    if (!task.trim()) return;
    setError('');
    try {
      const res = await startDeepWork({ task, planned_duration: duration, brain_side: brainSide });
      setActiveSessionId(res.id);
      setElapsed(0);
      setState('running');
      startTimer();
    } catch (err) {
      setError('启动失败');
    }
  };

  const handlePause = async () => {
    if (!activeSessionId) return;
    try {
      await pauseDeepWork(activeSessionId);
      setState('paused');
      stopTimer();
    } catch { setError('暂停失败'); }
  };

  const handleResume = async () => {
    if (!activeSessionId) return;
    try {
      await resumeDeepWork(activeSessionId);
      setState('running');
      startTimer();
    } catch { setError('恢复失败'); }
  };

  const handleEnd = async () => {
    if (!activeSessionId) return;
    try {
      await endDeepWork(activeSessionId);
      setState('completed');
      stopTimer();
    } catch { setError('结束失败'); }
  };

  const resetToIdle = () => {
    stopTimer();
    setState('idle');
    setActiveSessionId(null);
    setElapsed(0);
    setTask('');
  };

  const handleRecordInterruption = async () => {
    if (!activeSessionId) return;
    try {
      await recordInterruption({ id: activeSessionId, reason: interruptionReason });
      setShowInterruption(false);
    } catch { setError('记录干扰失败'); }
  };

  const saveWhitelist = () => {
    const items = whitelistInput.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
    const merged = [...new Set([...whitelist, ...items])];
    setWhitelist(merged);
    localStorage.setItem('deepWorkWhitelist', JSON.stringify(merged));
    setWhitelistInput('');
  };

  const removeWhitelistItem = (item: string) => {
    const next = whitelist.filter((w) => w !== item);
    setWhitelist(next);
    localStorage.setItem('deepWorkWhitelist', JSON.stringify(next));
  };

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  // 页面刷新/重进时，恢复仍在进行或暂停中的会话
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored || state !== 'idle' || !deepWorkSessions) return;
    const active = deepWorkSessions.find(
      (s) => s.completion_status === 'active' || s.completion_status === 'paused'
    );
    setRestored(true);
    if (!active) return;
    setActiveSessionId(active.id);
    setTask(active.task);
    setDuration(active.planned_duration);
    setBrainSide((active.brain_side as 'personal' | 'network') || 'personal');
    const base = (active.actual_duration || 0) * 60;
    const extra =
      active.completion_status === 'active' && active.started_at
        ? Math.max(0, Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000))
        : 0;
    setElapsed(base + extra);
    if (active.completion_status === 'active') {
      setState('running');
      startTimer();
    } else {
      setState('paused');
    }
  }, [deepWorkSessions, restored, state, startTimer]);

  const liveScore = useCallback(() => {
    if (state === 'idle') return 0;
    const minutes = elapsed / 60;
    const durationScore = Math.min(100, (minutes / duration) * 100);
    return Math.round(durationScore);
  }, [elapsed, duration, state]);

  const sessions = deepWorkSessions ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">深度工作</h1>
          <p className="text-sm text-text-secondary mt-1">个人脑专注时段管理</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-fusion-primary" />
            <h3 className="text-lg font-semibold text-text-primary">专注计时</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-lg hover:bg-white/[0.05] text-text-secondary transition-colors">
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={() => setShowHistory(!showHistory)} className="p-2 rounded-lg hover:bg-white/[0.05] text-text-secondary transition-colors">
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        <div className="flex items-center justify-center mb-6">
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${
            state === 'idle' ? 'bg-white/[0.03] text-text-muted border-white/[0.08]' :
            state === 'running' ? 'bg-info/10 text-info border-info/20' :
            state === 'paused' ? 'bg-warning/10 text-warning border-warning/20' :
            'bg-success/10 text-success border-success/20'
          }`}>
            {state === 'idle' ? '未开始' : state === 'running' ? '进行中' : state === 'paused' ? '已暂停' : '已完成'}
          </span>
        </div>

        {state === 'idle' ? (
          <div className="space-y-4 max-w-md mx-auto">
            <div>
              <label className="text-sm text-text-primary mb-2 block">任务描述</label>
              <input
                type="text"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="例如：阅读论文、编写代码..."
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-info/50 transition-colors text-text-primary placeholder-text-muted"
              />
            </div>
            <div>
              <label className="text-sm text-text-primary mb-2 block">脑侧归属</label>
              <div className="flex gap-3">
                {[
                  { key: 'personal', label: '个人脑', icon: User, color: 'text-personal-primary border-personal-primary/30 bg-personal-primary/10' },
                  { key: 'network', label: '网络脑', icon: Globe, color: 'text-network-primary border-network-primary/30 bg-network-primary/10' },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setBrainSide(item.key as typeof brainSide)}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                      brainSide === item.key ? item.color : 'bg-white/[0.03] border-white/[0.08] text-text-secondary hover:border-white/[0.12]'
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span className="text-sm">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm text-text-primary mb-2 block">时长: {duration} 分钟</label>
              <input
                type="range" min="15" max="120" step="5" value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value))}
                className="w-full accent-info"
              />
              <div className="flex justify-between text-xs text-text-muted mt-1">
                <span>15m</span><span>60m</span><span>120m</span>
              </div>
            </div>
            <button
              onClick={handleStart}
              disabled={!task.trim() || isStartingDeepWork}
              className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isStartingDeepWork ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              开始专注
            </button>
          </div>
        ) : state === 'completed' ? (
          <div className="text-center py-6">
            <div className="text-xl font-bold text-success mb-1">本次专注已完成</div>
            <div className="text-sm text-text-secondary mb-1">{task}</div>
            <div className="text-xs text-text-muted mb-6">用时 {formatTime(elapsed)}</div>
            <button onClick={resetToIdle} className="btn-primary inline-flex items-center gap-2">
              <Play className="w-4 h-4" />
              开始新专注
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-5xl font-bold text-text-primary mb-2 font-mono tracking-wider">
              {formatTime(elapsed)}
            </div>
            <div className="text-sm text-text-secondary mb-2">{task}</div>
            <div className="text-xs text-text-muted mb-6">
              目标完成度: <span className="text-info font-bold">{liveScore()}</span>%
            </div>
            <div className="flex items-center justify-center gap-3 mb-4">
              {state === 'running' ? (
                <button onClick={handlePause} className="p-3 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-text-secondary transition-colors border border-white/[0.08]">
                  <Pause className="w-5 h-5" />
                </button>
              ) : (
                <button onClick={handleResume} className="p-3 rounded-full bg-info/10 hover:bg-info/20 text-info transition-colors border border-info/20">
                  <Play className="w-5 h-5" />
                </button>
              )}
              <button onClick={handleEnd} className="p-3 rounded-full bg-danger/10 hover:bg-danger/20 text-danger transition-colors border border-danger/20">
                <Square className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={() => setShowInterruption(true)}
              className="text-xs text-warning hover:text-danger transition-colors inline-flex items-center gap-1"
            >
              <AlertTriangle className="w-3 h-3" />
              记录干扰
            </button>
          </div>
        )}
      </div>

      {/* Interruption Modal */}
      <AnimatePresence>
        {showInterruption && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowInterruption(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-bg-secondary border border-border-color rounded-2xl p-6 max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-text-primary mb-4">记录干扰</h3>
              <div className="space-y-2 mb-4">
                {INTERRUPTION_REASONS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setInterruptionReason(r.key)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all border ${
                      interruptionReason === r.key
                        ? 'bg-info/5 border-info/30 text-info'
                        : 'bg-white/[0.02] border-white/[0.06] text-text-secondary hover:border-white/[0.12]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowInterruption(false)} className="btn-secondary flex-1">取消</button>
                <button onClick={handleRecordInterruption} className="btn-primary flex-1">确认</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-success" />
                <h3 className="text-sm font-semibold text-text-primary">白名单配置</h3>
              </div>
              <p className="text-xs text-text-muted mb-3">允许访问的应用或网站（逗号分隔）</p>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={whitelistInput}
                  onChange={(e) => setWhitelistInput(e.target.value)}
                  placeholder="例如: github.com, docs.google.com"
                  className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-success/50 text-text-primary placeholder-text-muted"
                />
                <button onClick={saveWhitelist} className="btn-secondary text-sm">添加</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {whitelist.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-success/10 text-success border border-success/20">
                    {item}
                    <button onClick={() => removeWhitelistItem(item)} className="hover:text-danger transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Panel */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-4 h-4 text-info" />
                <h3 className="text-sm font-semibold text-text-primary">深度工作历史</h3>
              </div>
              {sessions.length > 0 ? (
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <div key={session.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${
                          session.completion_status === 'completed' ? 'bg-success' :
                          session.completion_status === 'paused' ? 'bg-warning' : 'bg-info'
                        }`} />
                        <div>
                          <div className="text-sm text-text-primary">{session.task}</div>
                          <div className="text-xs text-text-muted flex items-center gap-2">
                            <span>{session.started_at ? new Date(session.started_at).toLocaleDateString('zh-CN') : '未知日期'}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                              session.brain_side === 'network'
                                ? 'border-network-primary/30 text-network-primary bg-network-primary/10'
                                : 'border-personal-primary/30 text-personal-primary bg-personal-primary/10'
                            }`}>
                              {session.brain_side === 'network' ? '网络脑' : '个人脑'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-text-primary">
                          {session.actual_duration ?? 0} / {session.planned_duration} min
                        </div>
                        <div className="text-xs text-text-muted">
                          干扰: {session.interruptions} 次
                          {session.focus_score_avg && ` · 评分: ${Math.round(session.focus_score_avg)}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-text-muted text-sm">
                  <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  暂无深度工作记录
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AttentionDeepWorkPage;
