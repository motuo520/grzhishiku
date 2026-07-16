import { FC, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Clock, Target, Calendar, Package, Lock, Mic, Image, Type, Sparkles,
  Tag, Shield, Globe, Users, EyeOff, Check, AlertTriangle, User
} from 'lucide-react';
import { useCapsules } from '@/hooks/useCapsules';

const MOOD_TAGS = [
  { key: 'happy', label: '开心', color: '#3fb950' },
  { key: 'calm', label: '平静', color: '#58a6ff' },
  { key: 'anxious', label: '焦虑', color: '#d29922' },
  { key: 'excited', label: '兴奋', color: '#f778ba' },
  { key: 'nostalgic', label: '怀旧', color: '#a371f7' },
  { key: 'grateful', label: '感恩', color: '#d29922' },
  { key: 'confused', label: '困惑', color: '#8b949e' },
  { key: 'expectant', label: '期待', color: '#39c5cf' },
];

const PRIVACY_OPTIONS = [
  { key: 'public', label: '公开', icon: Globe, desc: '所有人可见' },
  { key: 'shared', label: '仅共享', icon: Users, desc: '仅分享的人可见' },
  { key: 'private', label: '私密', icon: EyeOff, desc: '仅自己可见' },
];

const CapsuleCreate: FC = () => {
  const navigate = useNavigate();
  const { createCapsule, isCreating } = useCapsules();
  const [step, setStep] = useState(1);
  const [contentType, setContentType] = useState<'text' | 'voice' | 'image'>('text');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState({ emotion: '', intensity: 5, energy: 5 });
  const [selectedMoodTags, setSelectedMoodTags] = useState<string[]>([]);
  const [unlockType, setUnlockType] = useState<'temporal' | 'eventual' | 'conditional'>('temporal');
  const [unlockDate, setUnlockDate] = useState('');
  const [unlockEvent, setUnlockEvent] = useState('');
  const [unlockCustom, setUnlockCustom] = useState('');
  const [privacyLevel, setPrivacyLevel] = useState('private');
  const [brainSide, setBrainSide] = useState<'personal' | 'network'>('personal');
  const [privacy, setPrivacy] = useState({ requireAuth: false, allowExport: true });

  useEffect(() => {
    setBrainSide(privacyLevel === 'private' ? 'personal' : 'network');
  }, [privacyLevel]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggleMoodTag = useCallback((tag: string) => {
    setSelectedMoodTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const validate = useCallback(() => {
    const errs: Record<string, string> = {};
    if (!content.trim()) errs.content = '内容不能为空';
    if (unlockType === 'temporal') {
      if (!unlockDate) errs.unlock = '请选择解锁时间';
      else if (new Date(unlockDate).getTime() <= Date.now()) errs.unlock = '解锁时间必须是将来的某个时刻';
    }
    if (unlockType === 'eventual' && !unlockEvent.trim()) errs.unlock = '请输入事件名称';
    if (unlockType === 'conditional' && !unlockCustom.trim()) errs.unlock = '请输入自定义条件';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [content, unlockType, unlockDate, unlockEvent, unlockCustom]);

  const handleSubmit = async () => {
    if (!validate()) return;

    const unlockConfig: Record<string, any> = { type: unlockType };
    if (unlockType === 'temporal') unlockConfig.unlock_date = unlockDate;
    if (unlockType === 'eventual') unlockConfig.event = unlockEvent;
    if (unlockType === 'conditional') unlockConfig.condition = unlockCustom;

    try {
      await createCapsule({
        content_type: contentType,
        content_body: content,
        brain_side: brainSide,
        mood_emotion: mood.emotion || undefined,
        mood_intensity: mood.intensity || undefined,
        mood_energy_level: mood.energy || undefined,
        mood_tags: selectedMoodTags.length > 0 ? selectedMoodTags : undefined,
        unlock_type: unlockType,
        unlock_config: unlockConfig,
        privacy_level: privacyLevel,
        privacy_require_auth: privacy.requireAuth,
        privacy_allow_export: privacy.allowExport,
      });
      navigate('/capsules/my');
    } catch (error) {
      console.error('Failed to create capsule:', error);
    }
  };

  const steps = [
    { id: 1, label: '内容', icon: Type },
    { id: 2, label: '心情', icon: Sparkles },
    { id: 3, label: '解锁', icon: Lock },
    { id: 4, label: '确认', icon: Package },
  ];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate('/capsules')}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回列表
      </button>

      <h1 className="text-2xl font-bold text-text-primary mb-2">创建时间胶囊</h1>
      <p className="text-sm text-text-secondary mb-6">封存一段记忆，在未来某个时刻开启</p>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <button
              onClick={() => setStep(s.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                step === s.id
                  ? 'bg-info/10 text-info'
                  : step > s.id
                    ? 'bg-success/10 text-success'
                    : 'bg-bg-tertiary text-text-muted'
              }`}
            >
              <s.icon className="w-4 h-4" />
              {s.label}
            </button>
            {i < steps.length - 1 && (
              <div className={`w-8 h-0.5 ${step > s.id ? 'bg-success' : 'bg-border-color'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-text-primary mb-2 block">内容类型</label>
              <div className="flex gap-3">
                {[
                  { type: 'text' as const, icon: Type, label: '文字', soon: false },
                  { type: 'voice' as const, icon: Mic, label: '语音', soon: true },
                  { type: 'image' as const, icon: Image, label: '图片', soon: true },
                ].map((item) => (
                  <button
                    key={item.type}
                    onClick={() => !item.soon && setContentType(item.type)}
                    disabled={item.soon}
                    title={item.soon ? '即将支持' : undefined}
                    className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                      contentType === item.type
                        ? 'border-info bg-info/10 text-info'
                        : 'border-border-color bg-white/[0.03] backdrop-blur text-text-secondary hover:border-text-muted'
                    } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border-color`}
                  >
                    <item.icon className="w-6 h-6" />
                    <span className="text-sm">{item.label}</span>
                    {item.soon && <span className="text-[10px] text-text-muted -mt-1">即将支持</span>}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-text-primary mb-2 block">
                胶囊内容 <span className="text-danger">*</span>
              </label>
              <textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setErrors((e) => ({ ...e, content: '' })); }}
                placeholder="写下你想封存的内容..."
                rows={6}
                className="w-full bg-white/[0.03] backdrop-blur border border-white/[0.08] rounded-lg px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 transition-colors resize-none"
              />
              {errors.content && (
                <div className="flex items-center gap-1 text-xs text-danger mt-1">
                  <AlertTriangle className="w-3 h-3" /> {errors.content}
                </div>
              )}
              <div className="text-xs text-text-muted mt-1 text-right">{content.length} 字</div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-text-primary mb-2 block">当前心情</label>
              <input
                type="text"
                value={mood.emotion}
                onChange={(e) => setMood({ ...mood, emotion: e.target.value })}
                placeholder="例如：平静、兴奋、期待..."
                className="w-full bg-white/[0.03] backdrop-blur border border-white/[0.08] rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 transition-colors"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text-primary mb-2 block">
                情绪强度: <span className="text-info">{mood.intensity}</span>/10
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={mood.intensity}
                onChange={(e) => setMood({ ...mood, intensity: parseInt(e.target.value) })}
                className="w-full accent-info"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text-primary mb-2 block">
                能量水平: <span className="text-success">{mood.energy}</span>/10
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={mood.energy}
                onChange={(e) => setMood({ ...mood, energy: parseInt(e.target.value) })}
                className="w-full accent-success"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
                <Tag className="w-4 h-4" /> 心情标签
              </label>
              <div className="flex flex-wrap gap-2">
                {MOOD_TAGS.map((tag) => {
                  const selected = selectedMoodTags.includes(tag.key);
                  return (
                    <button
                      key={tag.key}
                      onClick={() => toggleMoodTag(tag.key)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                        selected
                          ? 'border-white/20 text-white'
                          : 'border-white/[0.08] text-text-secondary hover:border-white/20'
                      }`}
                      style={selected ? { backgroundColor: tag.color + '33', borderColor: tag.color } : {}}
                    >
                      <span className="flex items-center gap-1">
                        {selected && <Check className="w-3 h-3" style={{ color: tag.color }} />}
                        <span style={selected ? { color: tag.color } : {}}>{tag.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-text-primary mb-2 block">解锁方式 <span className="text-danger">*</span></label>
              <div className="grid grid-cols-1 gap-3">
                {[
                  { type: 'temporal' as const, icon: Calendar, label: '时间解锁', desc: '到达指定日期自动解锁' },
                  { type: 'eventual' as const, icon: Target, label: '事件解锁', desc: '满足特定事件后解锁' },
                  { type: 'conditional' as const, icon: Clock, label: '自定义条件', desc: '满足自定义文本条件后解锁' },
                ].map((item) => (
                  <button
                    key={item.type}
                    onClick={() => setUnlockType(item.type)}
                    className={`flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                      unlockType === item.type
                        ? 'border-info bg-info/10 text-info'
                        : 'border-border-color bg-white/[0.03] backdrop-blur text-text-secondary'
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                    <div>
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="text-xs text-text-muted">{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {unlockType === 'temporal' && (
              <div>
                <label className="text-sm font-medium text-text-primary mb-2 block">解锁日期</label>
                <input
                  type="datetime-local"
                  value={unlockDate}
                  onChange={(e) => { setUnlockDate(e.target.value); setErrors((e) => ({ ...e, unlock: '' })); }}
                  className="w-full bg-white/[0.03] backdrop-blur border border-white/[0.08] rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-info/50 transition-colors"
                />
              </div>
            )}
            {unlockType === 'eventual' && (
              <div>
                <label className="text-sm font-medium text-text-primary mb-2 block">事件名称</label>
                <input
                  type="text"
                  value={unlockEvent}
                  onChange={(e) => { setUnlockEvent(e.target.value); setErrors((e) => ({ ...e, unlock: '' })); }}
                  placeholder="例如：完成项目、毕业、旅行..."
                  className="w-full bg-white/[0.03] backdrop-blur border border-white/[0.08] rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 transition-colors"
                />
              </div>
            )}
            {unlockType === 'conditional' && (
              <div>
                <label className="text-sm font-medium text-text-primary mb-2 block">自定义条件</label>
                <textarea
                  value={unlockCustom}
                  onChange={(e) => { setUnlockCustom(e.target.value); setErrors((e) => ({ ...e, unlock: '' })); }}
                  placeholder="描述解锁条件..."
                  rows={3}
                  className="w-full bg-white/[0.03] backdrop-blur border border-white/[0.08] rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 transition-colors resize-none"
                />
              </div>
            )}
            {errors.unlock && (
              <div className="flex items-center gap-1 text-xs text-danger">
                <AlertTriangle className="w-3 h-3" /> {errors.unlock}
              </div>
            )}

            <div className="border-t border-border-color pt-6">
              <label className="text-sm font-medium text-text-primary mb-3 block">脑侧归属</label>
              <div className="flex gap-3 mb-6">
                {[
                  { key: 'personal', label: '个人脑', icon: User },
                  { key: 'network', label: '网络脑', icon: Globe },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setBrainSide(item.key as typeof brainSide)}
                    disabled={privacyLevel !== 'private' && item.key === 'personal'}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                      brainSide === item.key
                        ? item.key === 'network'
                          ? 'border-network-primary/30 bg-network-primary/10 text-network-primary'
                          : 'border-personal-primary/30 bg-personal-primary/10 text-personal-primary'
                        : 'border-border-color bg-white/[0.03] backdrop-blur text-text-secondary'
                    } disabled:opacity-50`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                ))}
              </div>

              <label className="text-sm font-medium text-text-primary mb-3 block flex items-center gap-2">
                <Shield className="w-4 h-4" /> 隐私设置
              </label>
              <div className="grid grid-cols-1 gap-3">
                {PRIVACY_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setPrivacyLevel(opt.key)}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      privacyLevel === opt.key
                        ? 'border-info bg-info/10 text-info'
                        : 'border-border-color bg-white/[0.03] backdrop-blur text-text-secondary'
                    }`}
                  >
                    <opt.icon className="w-5 h-5" />
                    <div>
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-xs text-text-muted">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-3 text-sm text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacy.requireAuth}
                    onChange={(e) => setPrivacy({ ...privacy, requireAuth: e.target.checked })}
                    className="w-4 h-4 rounded accent-info"
                  />
                  解锁需要身份验证
                </label>
                <label className="flex items-center gap-3 text-sm text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacy.allowExport}
                    onChange={(e) => setPrivacy({ ...privacy, allowExport: e.target.checked })}
                    className="w-4 h-4 rounded accent-info"
                  />
                  允许导出内容
                </label>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-4">胶囊预览</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">内容类型</span>
                  <span className="text-text-primary">
                    {contentType === 'text' ? '文字' : contentType === 'voice' ? '语音' : '图片'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">内容长度</span>
                  <span className="text-text-primary">{content.length} 字</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">心情</span>
                  <span className="text-text-primary">{mood.emotion || '未记录'} ({mood.intensity}/10)</span>
                </div>
                {selectedMoodTags.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">心情标签</span>
                    <span className="flex gap-1 flex-wrap justify-end">
                      {selectedMoodTags.map((tag) => {
                        const t = MOOD_TAGS.find((m) => m.key === tag);
                        return t ? (
                          <span key={tag} className="text-xs px-2 py-0.5 rounded-full border" style={{ color: t.color, borderColor: t.color + '44' }}>
                            {t.label}
                          </span>
                        ) : null;
                      })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-text-muted">解锁方式</span>
                  <span className="text-text-primary">
                    {unlockType === 'temporal' ? `时间: ${unlockDate || '未设置'}` : unlockType === 'eventual' ? `事件: ${unlockEvent || '未设置'}` : `条件: ${unlockCustom || '未设置'}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">隐私级别</span>
                  <span className="text-text-primary">
                    {PRIVACY_OPTIONS.find((p) => p.key === privacyLevel)?.label}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Navigation Buttons */}
      <div className="flex justify-between mt-8">
        <button
          onClick={() => setStep(Math.max(1, step - 1))}
          disabled={step === 1}
          className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          上一步
        </button>
        {step < 4 ? (
          <button onClick={() => setStep(step + 1)} className="btn-primary">
            下一步
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isCreating || !content.trim()}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            封存胶囊
          </button>
        )}
      </div>
    </div>
  );
};

export default CapsuleCreate;
