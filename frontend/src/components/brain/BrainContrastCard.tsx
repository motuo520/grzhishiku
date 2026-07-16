import { FC } from 'react';
import { motion } from 'framer-motion';
import { Brain, Globe, Scale, Zap, AlertCircle, Lightbulb } from 'lucide-react';
import { BrainContrastResponse, ContrastMetric } from '@/api/cognitive';

interface Props {
  data?: BrainContrastResponse;
  loading?: boolean;
}

const WINNER_BADGE: Record<string, { label: string; color: string; icon: typeof Brain }> = {
  personal: { label: '个人脑领先', color: 'text-fusion-primary', icon: Brain },
  network: { label: '网络脑领先', color: 'text-info', icon: Globe },
  balanced: { label: '势均力敌', color: 'text-warning', icon: Scale },
};

export const BrainContrastCard: FC<Props> = ({ data, loading }) => {
  if (loading) {
    return (
      <div className="glass-card p-6 animate-pulse space-y-4">
        <div className="h-6 bg-white/[0.05] rounded w-1/3" />
        <div className="h-40 bg-white/[0.03] rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  const badge = WINNER_BADGE[data.dominant_brain] || WINNER_BADGE.balanced;
  const BadgeIcon = badge.icon;

  return (
    <div className="glass-card p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-warning" />
          <h2 className="text-lg font-bold text-text-primary">双脑战力对比</h2>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.1] ${badge.color}`}>
          <BadgeIcon className="w-4 h-4" />
          <span className="text-sm font-bold">{badge.label}</span>
        </div>
      </div>

      {data.degraded && (
        <div className="p-3 rounded-lg bg-warning/5 border border-warning/20 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-warning">
            AI 对比分析暂时不可用，以下为基于内容量的本地估算结果，稍后重新扫描可获得精准对比。
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-fusion-primary/5 border border-fusion-primary/10">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-fusion-primary" />
            <span className="text-sm font-bold text-text-primary">个人脑</span>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">
            {data.personal_summary?.tagline || '来自笔记与自我反思'}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(data.personal_summary?.keywords || []).map((k) => (
              <span key={k} className="px-2 py-0.5 rounded-full text-xs bg-fusion-primary/10 text-fusion-primary border border-fusion-primary/20">
                {k}
              </span>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-info/5 border border-info/10">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-info" />
            <span className="text-sm font-bold text-text-primary">网络脑</span>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">
            {data.network_summary?.tagline || '来自外部采集与知识'}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(data.network_summary?.keywords || []).map((k) => (
              <span key={k} className="px-2 py-0.5 rounded-full text-xs bg-info/10 text-info border border-info/20">
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {data.metrics.map((m: ContrastMetric, index: number) => {
          const personalWidth = `${m.personal}%`;
          const networkWidth = `${m.network}%`;
          return (
            <motion.div
              key={m.dimension}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="space-y-1.5"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-text-primary">{m.dimension}</span>
                <span className="text-xs text-text-muted">差距 {Math.round(m.gap)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: personalWidth }}
                    transition={{ duration: 0.8, delay: index * 0.05 }}
                    className="h-full rounded-full bg-fusion-primary"
                  />
                </div>
                <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: networkWidth }}
                    transition={{ duration: 0.8, delay: index * 0.05 }}
                    className="h-full rounded-full bg-info"
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs text-text-muted">
                <span>个人 {Math.round(m.personal)}</span>
                <span>{m.winner === 'personal' ? '▲ 个人脑' : m.winner === 'network' ? '▲ 网络脑' : '● 平衡'}</span>
                <span>网络 {Math.round(m.network)}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1 text-warning">
            <Zap className="w-4 h-4" />
            <span className="text-xs font-bold">双脑互补度</span>
          </div>
          <div className="text-2xl font-bold text-text-primary">{Math.round(data.synergy_score)}</div>
          <div className="text-xs text-text-muted">/ 100</div>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1 text-danger">
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs font-bold">潜在冲突</span>
          </div>
          <div className="text-2xl font-bold text-text-primary">{data.conflict_count}</div>
          <div className="text-xs text-text-muted">处观点张力</div>
        </div>
      </div>

      {data.insights.length > 0 && (
        <div className="p-4 rounded-xl bg-warning/5 border border-warning/10">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-warning" />
            <span className="text-sm font-bold text-text-primary">双脑洞察</span>
          </div>
          <ul className="space-y-2">
            {data.insights.map((insight, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="text-warning mt-0.5">•</span>
                <span className="leading-relaxed">{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default BrainContrastCard;
