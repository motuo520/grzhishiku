import { FC } from 'react';
import { motion } from 'framer-motion';
import { Brain, HelpCircle, Lightbulb, CheckCircle2, XCircle, SkipForward } from 'lucide-react';
import { Challenge } from '@/api/cognitive';

interface Props {
  history?: Challenge[];
  loading?: boolean;
}

const TYPE_LABEL: Record<string, { label: string; color: string; icon: typeof Brain }> = {
  bias_quiz: { label: '偏差测验', color: 'text-warning', icon: HelpCircle },
  thought_experiment: { label: '思维实验', color: 'text-info', icon: Brain },
  reflection: { label: '反思练习', color: 'text-success', icon: Lightbulb },
};

export const ChallengeHistoryList: FC<Props> = ({ history, loading }) => {
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-4 h-16 bg-white/[0.03]" />
        ))}
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-text-secondary text-sm">
        还没有挑战记录，开始今日挑战吧！
      </div>
    );
  }

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-fusion-primary" />
        <h2 className="text-lg font-bold text-text-primary">挑战历史</h2>
      </div>
      <div className="space-y-3">
        {history.map((item, index) => {
          const typeInfo = TYPE_LABEL[item.type] || TYPE_LABEL.reflection;
          const Icon = typeInfo.icon;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${typeInfo.color.replace('text-', 'bg-')}/10`}>
                  <Icon className={`w-4 h-4 ${typeInfo.color}`} />
                </div>
                <div>
                  <div className="text-sm font-bold text-text-primary">{item.title}</div>
                  <div className="text-xs text-text-secondary flex items-center gap-2">
                    <span>{typeInfo.label}</span>
                    <span>·</span>
                    <span>{item.points} 积分</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {item.status === 'completed' && item.is_correct && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 正确
                  </span>
                )}
                {item.status === 'completed' && item.is_correct === false && (
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <XCircle className="w-3.5 h-3.5" /> 错误
                  </span>
                )}
                {item.status === 'skipped' && (
                  <span className="flex items-center gap-1 text-xs text-text-muted">
                    <SkipForward className="w-3.5 h-3.5" /> 已跳过
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default ChallengeHistoryList;
