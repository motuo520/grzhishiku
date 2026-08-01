import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  Scale, Brain, Globe, AlertCircle, Loader2, RefreshCw,
  Zap, Lightbulb, ChevronDown, ChevronUp, Sparkles, Target
} from 'lucide-react';
import { cognitiveApi, ConflictItem, BrainSide } from '@/api/cognitive';
import CognitiveHero from '@/components/brain/CognitiveHero';
import BrainContrastCard from '@/components/brain/BrainContrastCard';
import ModelSelector from '@/components/llm/ModelSelector';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const SEVERITY_CONFIG: Record<number, { color: string; bg: string; border: string; label: string }> = {
  1: { color: 'text-success', bg: 'bg-success/10', border: 'border-success/20', label: '轻微' },
  2: { color: 'text-success', bg: 'bg-success/10', border: 'border-success/20', label: '轻微' },
  3: { color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20', label: '中等' },
  4: { color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20', label: '中等' },
  5: { color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20', label: '严重' },
};

const TYPE_COLORS: Record<string, string> = {
  '观点冲突': 'text-fusion-primary',
  '证据冲突': 'text-info',
  '优先级冲突': 'text-warning',
  '价值观冲突': 'text-danger',
  '信息缺口': 'text-success',
};

const BRAIN_SIDE_OPTIONS: { value: BrainSide; label: string; icon: typeof Brain }[] = [
  { value: 'both', label: '双脑对比', icon: Scale },
  { value: 'personal', label: '个人脑', icon: Brain },
  { value: 'network', label: '网络脑', icon: Globe },
];

const CognitiveConflictPage: FC = () => {
  const [scanning, setScanning] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [brainSide, setBrainSide] = useState<BrainSide>('both');
  const [modelId, setModelId] = useState<string>('');

  const {
    data: contrastData,
    isLoading: contrastLoading,
    refetch: refetchContrast,
    error: contrastError,
  } = useQuery({
    queryKey: ['cognitive', 'brain-contrast', brainSide, modelId],
    queryFn: async () => {
      const response = await cognitiveApi.brainContrast(brainSide, modelId || undefined);
      return response.data;
    },
    // 不在挂载时自动跑 LLM（单次约需 1 分钟且计费）；点「扫描冲突」才 refetch，30 分钟内复用缓存
    enabled: false,
    staleTime: 30 * 60 * 1000,
  });

  const {
    data: conflictData,
    isLoading: conflictLoading,
    refetch: refetchConflict,
    error: conflictError,
  } = useQuery({
    queryKey: ['cognitive', 'cognitive-conflict', brainSide, modelId],
    queryFn: async () => {
      const response = await cognitiveApi.cognitiveConflict(brainSide, modelId || undefined);
      return response.data;
    },
    enabled: false,
  });

  const handleScan = async () => {
    setScanning(true);
    try {
      await refetchContrast();
      await refetchConflict();
    } finally {
      setScanning(false);
    }
  };

  const conflicts: ConflictItem[] = conflictData?.conflicts || [];
  const categories = conflictData?.categories || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <CognitiveHero
        title="脑侧冲突"
        subtitle="当个人想法遇见外部知识，让张力成为进步的燃料"
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Scale className="w-5 h-5 text-danger" />
          <div>
            <h2 className="text-lg font-bold text-text-primary">脑侧张力扫描</h2>
            <p className="text-xs text-text-secondary">发现 {conflicts.length} 处认知冲突</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <ModelSelector value={modelId} onChange={setModelId} taskType="creative" className="w-48" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center p-1 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              {BRAIN_SIDE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = brainSide === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setBrainSide(opt.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      active
                        ? 'bg-fusion-primary/20 text-fusion-primary border border-fusion-primary/30'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={handleScan}
              disabled={scanning || conflictLoading || contrastLoading}
              className="btn-secondary flex items-center gap-2"
            >
              {scanning || conflictLoading || contrastLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{scanning || conflictLoading || contrastLoading ? '扫描中...' : '扫描冲突'}</span>
            </button>
          </div>
        </div>
      </div>

      <AiErrorNotice error={contrastError || conflictError} />

      {/* Brain Contrast */}
      <BrainContrastCard data={contrastData} loading={contrastLoading && !contrastData} />

      {/* Conflict Categories */}
      {categories.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-info" />
            <h2 className="text-lg font-bold text-text-primary">冲突分布</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {categories.map((cat, idx) => (
              <motion.div
                key={cat.type}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] text-center"
              >
                <div className={`text-2xl font-bold ${TYPE_COLORS[cat.type] || 'text-text-primary'}`}>
                  {cat.count}
                </div>
                <div className="text-xs text-text-secondary mt-1">{cat.type}</div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Conflict List */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-5 h-5 text-danger" />
          <h2 className="text-lg font-bold text-text-primary">冲突清单</h2>
          <span className="text-sm text-text-muted">({conflicts.length})</span>
        </div>

        {conflicts.length === 0 && !conflictLoading && !scanning ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-full bg-success/10 mb-4">
              <Sparkles className="w-8 h-8 text-success" />
            </div>
            <h3 className="text-lg font-bold text-text-primary mb-2">暂无显著冲突</h3>
            <p className="text-text-secondary text-sm max-w-md">
              {brainSide === 'both'
                ? '当个人笔记与外部采集足够丰富时，点击「扫描冲突」即可发现观点张力与信息缺口。'
                : brainSide === 'personal'
                ? '个人脑笔记数量不足或观点较一致时，暂时无法发现内部冲突。'
                : '网络脑采集数量不足或观点较一致时，暂时无法发现内部冲突。'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {conflicts.map((conflict, index) => {
              const sev = SEVERITY_CONFIG[conflict.severity] || SEVERITY_CONFIG[3];
              const expanded = expandedId === conflict.id;
              return (
                <motion.div
                  key={conflict.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`p-4 rounded-xl border transition-colors ${sev.border} bg-white/[0.02] hover:bg-white/[0.04]`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${sev.bg} ${sev.color}`}>
                          {sev.label}
                        </span>
                        <span className={`text-xs font-medium ${TYPE_COLORS[conflict.conflict_type] || 'text-text-secondary'}`}>
                          {conflict.conflict_type}
                        </span>
                        <span className="text-xs text-text-muted">严重度 {conflict.severity}/5</span>
                      </div>
                      <h3 className="text-base font-bold text-text-primary mb-2">{conflict.title}</h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div className="p-3 rounded-lg bg-fusion-primary/5 border border-fusion-primary/10">
                          <div className="flex items-center gap-1.5 mb-1 text-fusion-primary text-xs font-bold">
                            <Brain className="w-3.5 h-3.5" />
                            {brainSide === 'network' ? '观点 A' : '个人脑'}
                          </div>
                          <p className="text-text-secondary leading-relaxed">{conflict.personal_position}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-info/5 border border-info/10">
                          <div className="flex items-center gap-1.5 mb-1 text-info text-xs font-bold">
                            <Globe className="w-3.5 h-3.5" />
                            {brainSide === 'personal' ? '观点 B' : '网络脑'}
                          </div>
                          <p className="text-text-secondary leading-relaxed">{conflict.network_position}</p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setExpandedId(expanded ? null : conflict.id)}
                      className="text-text-muted hover:text-text-primary transition-colors"
                    >
                      {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>

                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      className="mt-3 pt-3 border-t border-white/[0.05]"
                    >
                      <div className="flex items-start gap-2">
                        <Lightbulb className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-text-primary mb-1">建议调和方式</div>
                          <p className="text-sm text-text-secondary leading-relaxed">{conflict.suggested_resolution}</p>
                        </div>
                      </div>
                      {conflict.source_ids.length > 0 && (
                        <div className="mt-2 text-xs text-text-muted">
                          涉及源 ID: {conflict.source_ids.join(', ')}
                        </div>
                      )}
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="glass-card p-6 border-fusion-primary/10">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-warning" />
          <h3 className="font-bold text-text-primary">为什么要关注脑侧冲突？</h3>
        </div>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-info mt-0.5">•</span>
            个人脑容易被既有信念困住，网络脑能引入外部视角。
          </li>
          <li className="flex items-start gap-2">
            <span className="text-info mt-0.5">•</span>
            发现冲突不是找错，而是找到下一步学习与验证的方向。
          </li>
          <li className="flex items-start gap-2">
            <span className="text-info mt-0.5">•</span>
            定期扫描能让你的知识体系更坚韧、更少盲区。
          </li>
        </ul>
      </div>
    </div>
  );
};

export default CognitiveConflictPage;
