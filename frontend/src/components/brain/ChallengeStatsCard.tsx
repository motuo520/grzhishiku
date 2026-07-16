import { FC } from 'react';
import { motion } from 'framer-motion';
import { Flame, Target, Trophy, Zap, CheckCircle2 } from 'lucide-react';
import { ChallengeStats } from '@/api/cognitive';

interface Props {
  stats?: ChallengeStats;
  loading?: boolean;
}

export const ChallengeStatsCard: FC<Props> = ({ stats, loading }) => {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 animate-pulse">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="glass-card p-4 h-24 bg-white/[0.03]" />
        ))}
      </div>
    );
  }

  const items = [
    { label: '连续打卡', value: stats.current_streak, icon: Flame, color: 'text-warning' },
    { label: '最高连胜', value: stats.longest_streak, icon: Trophy, color: 'text-fusion-primary' },
    { label: '总积分', value: stats.total_points, icon: Zap, color: 'text-info' },
    { label: '已完成', value: stats.total_completed, icon: CheckCircle2, color: 'text-success' },
    { label: '正确率', value: `${Math.round(stats.accuracy_rate * 100)}%`, icon: Target, color: 'text-danger' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="glass-card p-4 text-center"
          >
            <Icon className={`w-5 h-5 ${item.color} mx-auto mb-2`} />
            <div className="text-2xl font-bold text-text-primary">{item.value}</div>
            <div className="text-xs text-text-secondary mt-1">{item.label}</div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default ChallengeStatsCard;
